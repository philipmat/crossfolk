// The Web-standard handler every deployment target mounts. `env` is passed in by the
// adapter; `rateLimit` is an optional `(request) => Promise<boolean>` "allowed" check.
import {generateWords, parseModels, parseStoredProviderResponse, PROMPT_VERSION, validateOptions, WORD_PROFILE_VERSION} from './words.js';
import {logger as defaultLogger} from './logger.js';

export const MAX_BODY = 32_000;

const json = (status, body, extraHeaders = {}) => Response.json(body, {status, headers: {'cache-control': 'no-store', ...extraHeaders}});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LEASE_MS = 120_000;

export function canonicalThemeKey(theme) {
  return String(theme ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function requestFingerprint(value) {
  const text = JSON.stringify(value);
  let first = 2166136261;
  let second = 2654435761;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619) >>> 0;
    second = Math.imul(second ^ (code + index), 2246822519) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

function requestDetails(input, env, requestId, now = Date.now()) {
  const options = validateOptions(input);
  const normalized = options.error ? {
    theme: String(input?.theme ?? '').trim(), size: Number(input?.size) || 5,
    difficulty: String(input?.difficulty ?? 'easy').toLowerCase(), exclude: Array.isArray(input?.exclude) ? input.exclude : [], count: 40,
    wordProfile: String(input?.wordProfile ?? '').trim() || 'freeform-bank'
  } : options;
  const models = parseModels(env);
  const clean = {
    theme: normalized.theme,
    themeKey: canonicalThemeKey(normalized.theme),
    size: options.error ? null : normalized.size,
    difficulty: options.error ? null : normalized.difficulty,
    exclude: normalized.exclude,
    count: normalized.count,
    promptVersion: PROMPT_VERSION,
    models,
    wordProfile: options.error ? null : normalized.wordProfile,
    wordProfileVersion: WORD_PROFILE_VERSION
  };
  // Keep invalid requests auditable without allowing an untrusted exclude array to
  // exceed the diagnostic row limit. The count remains the original count and the
  // fingerprint still uses the complete normalized input above.
  const requestExclude = options.error
    ? normalized.exclude.slice(0, 100).map((word) => typeof word === 'string' ? word.slice(0, 32) : typeof word)
    : normalized.exclude;
  return {
    id: requestId,
    startedAtMs: now,
    runtime: env.RUNTIME || 'local',
    requesterKey: env.REQUESTER_KEY || 'local',
    requesterKeyVersion: env.REQUESTER_KEY_VERSION || 'v1',
    theme: options.error ? null : (normalized.theme || null),
    themeKey: clean.themeKey,
    size: normalized.size,
    difficulty: normalized.difficulty,
    excludeCount: normalized.exclude.length,
    wordProfile: clean.wordProfile,
    requestJson: JSON.stringify({theme: normalized.theme.slice(0, 160), size: String(normalized.size).slice(0, 32), difficulty: String(normalized.difficulty).slice(0, 160), exclude: requestExclude, excludeCount: normalized.exclude.length, wordProfile: normalized.wordProfile.slice(0, 160), count: String(normalized.count).slice(0, 32)}),
    requestFingerprint: requestFingerprint(clean),
    promptVersion: PROMPT_VERSION,
    configuredModelsJson: JSON.stringify(models),
    leaseExpiresAtMs: now + LEASE_MS,
    validation: options.error
  };
}

function pendingResponse(requestId) {
  return json(202, {error: 'Theme generation is still in progress.', retryable: true, requestId, retryAfterMs: 1000}, {'retry-after': '1'});
}

function aggregateAttemptUsage(attempts = []) {
  if (!attempts.length) return null;
  const fields = ['input_tokens', 'output_tokens', 'total_tokens'];
  if (!attempts.some((attempt) => fields.some((field) => attempt[field] != null))) return null;
  const sum = (field) => {
    const known = attempts.filter((attempt) => attempt[field] != null);
    return known.length ? known.reduce((total, attempt) => total + Number(attempt[field]), 0) : null;
  };
  return {
    input: sum('input_tokens'), output: sum('output_tokens'), total: sum('total_tokens')
  };
}

// Reads the real body stream up to MAX_BODY rather than trusting the client-supplied
// Content-Length header, which a request can omit (chunked/HTTP2) or understate.
// Returns the decoded text, or `undefined` if the stream exceeds the cap.
async function readCappedBody(request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

export async function handleWords(request, {env = {}, rateLimit, fetchImpl, logger = defaultLogger, generationStore} = {}) {
  if (request.method !== 'POST') return json(405, {error: 'Method not allowed.'});
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return json(413, {error: 'Request body is too large.'});

  if (rateLimit && !(await rateLimit(request))) return json(429, {error: 'Too many puzzles. Try again shortly.'});

  const raw = await readCappedBody(request);
  if (raw === undefined) return json(413, {error: 'Request body is too large.'});

  let input;
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    return json(400, {error: 'Invalid request.'});
  }

  try {
    // Keep old direct-handler consumers working without a store, while adapters that
    // enable persistence require the browser idempotency contract.
    const requestId = input?.requestId;
    if (!generationStore) {
      const {status, body} = await generateWords(input, env, {fetchImpl, signal: request.signal, logger});
      return json(status, body);
    }
    if (typeof requestId !== 'string' || !UUID.test(requestId) || requestId !== requestId.toLowerCase()) {
      return json(400, {error: 'A canonical requestId UUID is required.'});
    }

    const details = requestDetails(input, env, requestId);
    let claim;
    try {
      claim = await generationStore.claimRequest(details);
    } catch (error) {
      logger.error(`Request ${requestId}: failed to claim generation request:`, error);
      return json(503, {error: 'Theme generation storage is temporarily unavailable.', retryable: true, requestId});
    }
    if (claim?.conflict) return json(409, {error: 'This requestId was already used for different generation inputs.', requestId});

    const current = claim?.request;
    if (!claim?.created && !claim?.acquired) {
      if (current?.outcome === 'succeeded' && current.response_json) {
        try { return json(Number(current.http_status) || 200, JSON.parse(current.response_json)); } catch {}
      }
      if (current?.outcome && ['failed', 'aborted', 'invalid', 'unconfigured'].includes(current.outcome)) {
        if (current.response_json) {
          try { return json(Number(current.http_status) || 502, JSON.parse(current.response_json)); } catch {}
        }
        return json(Number(current.http_status) || 502, {error: current.error_message || 'Theme generation failed.', requestId});
      }
      return pendingResponse(requestId);
    }

    const startedAt = Number(current?.started_at_ms || details.startedAtMs);
    const attempts = current?.attempts || [];
    const incomplete = attempts.find((attempt) => attempt.outcome === 'in_progress' && attempt.provider_response_body == null);
    let startAttemptIndex = incomplete ? Math.max(0, Number(incomplete.attempt_number) - 1) : attempts.reduce((max, attempt) => Math.max(max, Number(attempt.attempt_number)), 0);
    // A worker can terminate after the raw checkpoint and before finalization. Recover
    // that response without spending another provider call.
    const checkpoint = attempts
      .filter((attempt) => attempt.provider_response_body != null && ['response_received', 'success'].includes(attempt.outcome))
      .at(-1);
    if (checkpoint) {
      try {
        const parsed = parseStoredProviderResponse(checkpoint.provider_response_body, details.size, Number(checkpoint.provider_http_status) || 200, {wordProfile: details.wordProfile});
        const recoveryUsage = current.attempts.map((attempt) => attempt === checkpoint ? parsed.usage : {input: attempt.input_tokens, output: attempt.output_tokens, total: attempt.total_tokens});
        const completeUsage = recoveryUsage.length > 0 && recoveryUsage.every((item) => item && item.input != null && item.output != null && item.total != null);
        const sumUsage = (field) => { const known = recoveryUsage.filter((item) => item && item[field] != null); return known.length ? known.reduce((sum, item) => sum + Number(item[field]), 0) : null; };
        const aggregateUsage = {input: sumUsage('input'), output: sumUsage('output'), total: sumUsage('total')};
        const body = {words: parsed.words, source: {model: checkpoint.model, usage: aggregateUsage}, requestId};
        try { await generationStore.finishAttempt({requestId, leaseToken: claim.leaseToken, attemptNumber: checkpoint.attempt_number, completedAtMs: Date.now(), durationMs: Date.now() - Number(checkpoint.started_at_ms), outcome: 'success', inputTokens: parsed.usage?.input, outputTokens: parsed.usage?.output, totalTokens: parsed.usage?.total, usableWordCount: parsed.words.length}); } catch (finalizationError) { logger.error(`Request ${requestId} attempt ${checkpoint.attempt_number}: failed to finalize recovery attempt:`, finalizationError); }
        try { await generationStore.finishRequest({id: requestId, leaseToken: claim.leaseToken, completedAtMs: Date.now(), durationMs: Date.now() - startedAt, outcome: 'succeeded', httpStatus: 200, selectedModel: checkpoint.model, attemptCount: current.attempts.length, resultWordCount: parsed.words.length, responseJson: JSON.stringify(body), knownInputTokens: sumUsage('input'), knownOutputTokens: sumUsage('output'), knownTotalTokens: sumUsage('total'), usageComplete: completeUsage}); } catch (finalizationError) { logger.error(`Request ${requestId}: failed to finalize recovered request:`, finalizationError); }
        return json(200, body);
      } catch (error) {
        try { await generationStore.finishAttempt({requestId, leaseToken: claim.leaseToken, attemptNumber: checkpoint.attempt_number, completedAtMs: Date.now(), durationMs: Date.now() - Number(checkpoint.started_at_ms), outcome: error.category || 'malformed_output', providerHttpStatus: checkpoint.provider_http_status, providerRequestId: checkpoint.provider_request_id, inputTokens: error.usage?.input, outputTokens: error.usage?.output, totalTokens: error.usage?.total, usableWordCount: error.usableWordCount, errorCategory: error.category, errorMessage: error.message}); } catch (finalizationError) { logger.error(`Request ${requestId} attempt ${checkpoint.attempt_number}: failed to finalize recovery error:`, finalizationError); }
        startAttemptIndex = Number(checkpoint.attempt_number);
      }
    }

    if (details.validation) {
      const body = {...details.validation.body, requestId};
      try { await generationStore.finishRequest({id: requestId, leaseToken: claim.leaseToken, completedAtMs: Date.now(), durationMs: Date.now() - startedAt, outcome: 'invalid', httpStatus: details.validation.status, errorCategory: 'invalid_request', errorMessage: details.validation.body.error, responseJson: JSON.stringify(body), attemptCount: 0, usageComplete: true}); } catch (finalizationError) { logger.error(`Request ${requestId}: failed to finalize invalid request:`, finalizationError); }
      return json(details.validation.status, body);
    }

    if (!env.OPENROUTER_API_KEY) {
      const body = {error: 'AI theme generation is not configured.', requestId};
      try { await generationStore.finishRequest({id: requestId, leaseToken: claim.leaseToken, completedAtMs: Date.now(), durationMs: Date.now() - startedAt, outcome: 'unconfigured', httpStatus: 503, errorCategory: 'unconfigured', errorMessage: body.error, responseJson: JSON.stringify(body), attemptCount: 0, usageComplete: true}); } catch (finalizationError) { logger.error(`Request ${requestId}: failed to finalize unconfigured request:`, finalizationError); }
      return json(503, body);
    }

    let result;
    try {
      result = await generateWords(input, env, {fetchImpl, signal: request.signal, logger, generationStore, requestId, leaseToken: claim.leaseToken, startAttemptIndex});
    } catch (error) {
      logger.error(`Request ${requestId}: unexpected generation failure:`, error);
      result = {status: 500, body: {error: 'Something went wrong generating words.', requestId}};
    }
    const {status, body: rawBody} = result;
    const body = {...rawBody, requestId};
    if (status === 202) return pendingResponse(requestId);
    if (rawBody.retryable) return json(status, body, {'retry-after': '1'});
    const latest = await generationStore.getRequest(requestId).catch(() => null);
    const usage = aggregateAttemptUsage(latest?.attempts) || rawBody.source?.usage;
    try {
      await generationStore.finishRequest({id: requestId, completedAtMs: Date.now(), durationMs: Date.now() - startedAt,
        leaseToken: claim.leaseToken,
        outcome: status === 200 ? 'succeeded' : (status === 504 ? 'aborted' : 'failed'), httpStatus: status,
        errorCategory: status === 200 ? null : (rawBody.retryable ? 'storage_unavailable' : (latest?.attempts?.at(-1)?.error_category || rawBody.category || 'generation_failed')), errorMessage: status === 200 ? null : rawBody.error,
        selectedModel: rawBody.source?.model, attemptCount: latest?.attempts?.length || 0, resultWordCount: rawBody.words?.length,
        responseJson: JSON.stringify(body), knownInputTokens: usage?.input, knownOutputTokens: usage?.output, knownTotalTokens: usage?.total,
        usageComplete: usage != null && (latest?.attempts || []).every((attempt) => attempt.input_tokens != null && attempt.output_tokens != null && attempt.total_tokens != null)});
    } catch (error) { logger.error(`Request ${requestId}: failed to finalize generation request:`, error); }
    return json(status, body);
  } catch (error) {
    logger.error('Unexpected error generating words:', error);
    return json(500, {error: 'Something went wrong generating words.', ...(input?.requestId ? {requestId: input.requestId} : {})});
  }
}
