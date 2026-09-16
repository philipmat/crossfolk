// Platform-neutral OpenRouter logic. No `process`, no platform imports, no `node:` imports:
// callers pass an `env` object and (optionally) a `fetch` implementation.
import {logger as defaultLogger} from './logger.js';

export const DEFAULT_MODELS = [
  'nvidia/nemotron-3-nano-30b-a3b:nitro', 'openai/gpt-oss-20b', 'google/gemini-2.5-flash-lite:nitro',
  'deepseek/deepseek-v4-flash', 'openai/gpt-4.1-mini', 'openai/gpt-5.6-luna'];
// Some providers begin streaming immediately but take longer than a minute to finish
// schema-constrained reasoning. Keep a bounded shared budget without prematurely
// cancelling a completion that has already started.
export const MAX_GENERATION_TIMEOUT_MS = 120_000;
export const MAX_MODEL_TIMEOUT_MS = 60_000;
export const MAX_PROVIDER_RESPONSE_BODY = 256 * 1024;
export const PROMPT_VERSION = 'crossfolk-words-v3-style-profiles';
// Bumping this (independently of PROMPT_VERSION) forces a fresh generation whenever the
// server-owned word profiles below change shape, even if the prompt text itself did not.
export const WORD_PROFILE_VERSION = 'layout-word-profiles-v1';
const SIZES = {small: 5, medium: 9, large: 13};
const MAX_DIAGNOSTIC_TEXT = 4096;

// Server-owned candidate-pool policy per layout style. The client asks for a profile id;
// it never tells the server which UI style is asking, and it cannot influence counts or
// thresholds. `american-anchors`' `themeSlotSignatures` is a deliberate, hand-copied record
// of `themeSlotSignatures(9)` from `public/layouts/american-patterns.js` (not an import),
// so a catalog change forces a conscious update here rather than silently drifting.
export const WORD_PROFILES = Object.freeze({
  // `freeform-bank`'s minimumUsable is recorded but NOT enforced: Free form keeps its
  // legacy three-usable-word floor until raising it is separately approved. The number is
  // the calibration target for that decision, not the current contract.
  'freeform-bank': Object.freeze({
    minAnswerLength: 2,
    sizes: Object.freeze({
      5: Object.freeze({requested: 40, minimumUsable: 24, minItems: 8}),
      9: Object.freeze({requested: 72, minimumUsable: 48, minItems: 8}),
      13: Object.freeze({requested: 84, minimumUsable: 56, minItems: 8}),
    }),
  }),
  'american-anchors': Object.freeze({
    minAnswerLength: 3,
    sizes: Object.freeze({
      9: Object.freeze({requested: 36, minimumUsable: 24, minItems: 12}),
    }),
    themeSlotSignatures: Object.freeze([Object.freeze([5]), Object.freeze([6])]),
  }),
});

const FREEFORM_LENGTH_BAND_TEXT = {
  5: 'All answers should be 3 to 5 letters long.',
  9: 'Aim for roughly 60% of answers 3-5 letters, 30% 6-7 letters, and 10% 8-9 letters.',
  13: 'Aim for roughly 55% of answers 3-5 letters, 30% 6-8 letters, and 15% 9-13 letters.',
};

const SHARED_SYSTEM_INSTRUCTIONS = 'Create accurate, family-friendly American crossword entries that are strongly related to the '
  + 'given theme. Difficulty should change how directly the clue points to the answer, not how obscure the answer itself is. Do '
  + 'not coin new words, pad answers, repeat duplicate answers, or list trivial inflections of the same root (plurals, -ing, -ed) '
  + 'as separate entries. Do not use proper names unless they are central to the theme. Return only data matching the JSON schema.';

// Per-profile guidance about the shape of the answers themselves: how long they should be,
// how many are wanted, and whether multiword phrases are acceptable.
function answerFormGuidance(wordProfile, size) {
  if (wordProfile === 'american-anchors') {
    const lengths = [...new Set(WORD_PROFILES['american-anchors'].themeSlotSignatures.flat())].sort((a, b) => a - b);
    return `Provide a smaller set of strong, distinctive feature entries for the long, symmetric slots of a ${size}x${size} `
      + `American-style grid. This puzzle's eligible theme-slot lengths are ${lengths.join(', ')} letters. Provide several `
      + 'candidate answers at each of those exact lengths so rotationally symmetric slot pairs are possible. Familiar multiword '
      + 'phrases are allowed; encode the answer as letters A-Z only, with spaces and punctuation omitted. Do not design or fill '
      + 'the grid yourself — only supply candidate answers and clues.';
  }

  return `Each answer must be a single word containing only letters A-Z. ${FREEFORM_LENGTH_BAND_TEXT[size]} Generate many short, `
    + 'varied, highly interlockable theme words.';
}

export class GenerationError extends Error {
  constructor(status, message, usage = null, metadata = {}) {
    super(message);
    this.status = status;
    this.usage = usage;
    Object.assign(this, metadata);
  }
}

// OpenRouter reports token counts alongside the completion. Surfacing them shows the player
// what the AI call cost, including tokens burned by an attempt that then failed.
export function readUsage(payload) {
  const usage = payload?.usage;
  if (!usage) return null;
  const number = (value) => value == null || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
  const input = number(usage.prompt_tokens);
  const output = number(usage.completion_tokens);
  const reportedTotal = number(usage.total_tokens);
  return {input, output, total: reportedTotal};
}

// Wall-clock cost of one OpenRouter attempt, reported on the server console so operators can see
// which model was tried and how long it held the shared request budget.
function elapsedSeconds(startedAt) {
  return ((Date.now() - startedAt) / 1000).toFixed(1);
}

function addUsage(first, second) {
  if (!first) return second ?? null;
  if (!second) return first;
  const add = (a, b) => a == null || b == null ? null : a + b;
  return {input: add(first.input, second.input), output: add(first.output, second.output), total: add(first.total, second.total)};
}

function safeDiagnostic(value) {
  if (value == null) return null;
  return String(value).slice(0, MAX_DIAGNOSTIC_TEXT);
}

function safeProviderRequestId(response) {
  return safeDiagnostic(response.headers.get('x-request-id') || response.headers.get('x-openrouter-request-id'));
}

export async function readCappedProviderBody(response) {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_PROVIDER_RESPONSE_BODY) throw new GenerationError(502, 'Theme generation response was too large.', null, {category: 'oversized_response'});
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_PROVIDER_RESPONSE_BODY) {
      await reader.cancel();
      throw new GenerationError(502, 'Theme generation response was too large.', null, {category: 'oversized_response'});
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

// `wordProfile` is optional so a checkpoint written before profiles existed can still be
// replayed under the legacy contract (2-letter minimum, 3 usable words is enough, no
// per-length histogram check).
function parseProviderResponse(responseText, {size, providerHttpStatus = 200, wordProfile}) {
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new GenerationError(502, 'The AI returned malformed JSON.', null, {category: 'malformed_json'});
  }
  const usage = readUsage(payload);
  if (providerHttpStatus < 200 || providerHttpStatus >= 300) {
    throw new GenerationError(502, safeDiagnostic(payload?.error?.message) || 'Theme generation failed.', usage, {category: 'upstream_error', providerHttpStatus});
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' && !Array.isArray(content)) {
    if (!payload?.choices?.length) throw new GenerationError(502, safeDiagnostic(payload?.error?.message) || 'Theme generation failed.', usage, {category: 'empty_response'});
  }
  const output = Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text).join('') : content;
  if (typeof output !== 'string' || !output.trim()) throw new GenerationError(502, 'The AI returned an empty response.', usage, {category: 'empty_response'});
  let parsed;
  try {
    parsed = JSON.parse(output.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    throw new GenerationError(502, 'The AI returned malformed JSON.', usage, {category: 'malformed_json'});
  }

  const profile = wordProfile ? WORD_PROFILES[wordProfile] : null;
  const minAnswerLength = profile?.minAnswerLength ?? 2;

  // Normalize to A-Z uppercase, then drop anything too short, too long for the grid, or
  // missing a clue, before any deduplication or count check runs.
  const usable = (Array.isArray(parsed?.words) ? parsed.words : [])
    .map(({answer, clue}) => ({answer: String(answer).toUpperCase().replace(/[^A-Z]/g, ''), clue: String(clue)}))
    .filter(({answer, clue}) => answer.length >= minAnswerLength && answer.length <= size && clue);

  // Deduplicate by answer, keeping the first occurrence, before any count is evaluated.
  const seenAnswers = new Set();
  const words = usable.filter(({answer}) => {
    if (seenAnswers.has(answer)) return false;
    seenAnswers.add(answer);
    return true;
  });

  if (wordProfile === 'american-anchors') {
    if (words.length < profile.minimumUsable) throw new GenerationError(502, 'The AI did not return enough usable words.', usage, {category: 'insufficient_words', usableWordCount: words.length});

    // A signature is satisfied only when at least two distinct answers share every length
    // in it, so a rotationally symmetric pair of slots at each of those lengths is fillable.
    const countsByLength = new Map();
    for (const {answer} of words) countsByLength.set(answer.length, (countsByLength.get(answer.length) || 0) + 1);
    const hasUsableSignature = profile.themeSlotSignatures.some((signature) => signature.every((length) => (countsByLength.get(length) || 0) >= 2));
    if (!hasUsableSignature) throw new GenerationError(502, 'This theme did not produce enough same-length anchor words to fill the grid. Try a broader theme.', usage, {category: 'insufficient_theme_anchors'});
  } else if (words.length < 3) {
    throw new GenerationError(502, 'The AI did not return enough usable words.', usage, {category: 'insufficient_words', usableWordCount: words.length});
  }

  return {words, usage};
}

// Returns either `{error: {status, body}}` or the normalised options for `requestThemeWords`.
// `wordProfile` selects the server-owned candidate-pool policy (see `WORD_PROFILES`); the
// caller never supplies a count directly, so a client cannot inflate or shrink the request.
export function validateOptions(input) {
  const {theme, size = 5, difficulty = 'easy', exclude = [], wordProfile} = input ?? {};
  const cleanTheme = String(theme ?? '').trim();
  if (!cleanTheme) return {error: {status: 400, body: {error: 'A theme is required.'}}};
  if (cleanTheme.length > 160) return {error: {status: 400, body: {error: 'Theme must be 160 characters or fewer.'}}};
  const cleanDifficulty = String(difficulty).toLowerCase();
  if (!['easy', 'medium', 'hard'].includes(cleanDifficulty)) return {error: {status: 400, body: {error: 'Difficulty must be easy, medium, or hard.'}}};
  if (!Array.isArray(exclude) || exclude.length > 100 || exclude.some((word) => typeof word !== 'string' || word.length > 32)) {
    return {error: {status: 400, body: {error: 'Exclude must be an array of at most 100 short answer strings.'}}};
  }
  const numericSize = SIZES[String(size).toLowerCase()] ?? Number(size);
  if (![5, 9, 13].includes(numericSize)) return {error: {status: 400, body: {error: 'Size must be small (5), medium (9), or large (13).'}}};

  // An omitted or empty profile is the legacy Free-form bank. An unknown profile, or one
  // with no entry for this size, is refused here, before any provider call is made.
  const cleanProfile = String(wordProfile ?? '').trim() || 'freeform-bank';
  const sizeLimits = WORD_PROFILES[cleanProfile]?.sizes[numericSize];
  if (!sizeLimits) return {error: {status: 400, body: {error: `Word profile "${cleanProfile}" does not support size ${numericSize}.`}}};

  // The requested count always comes from the server-owned profile; a client-supplied
  // count is ignored so it cannot inflate the request or under-fill the schema.
  return {theme: cleanTheme, size: numericSize, difficulty: cleanDifficulty, exclude, count: sizeLimits.requested, wordProfile: cleanProfile};
}

export function parseModels(env) {
  const models = String(env.OPENROUTER_MODELS || env.OPENROUTER_MODEL || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return models.length ? models : [...DEFAULT_MODELS];
}

async function requestThemeWords(model, {theme, size, difficulty, exclude, count, wordProfile}, env, fetchImpl, timeoutMs, parentSignal, lifecycle = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, {once: true});
  let apiResponse;
  let responseText;
  const {generationStore, requestId, leaseToken, attemptNumber, logger = defaultLogger} = lifecycle;
  const startedAtMs = Date.now();
  const minItems = WORD_PROFILES[wordProfile].sizes[size].minItems;
  const requestBody = JSON.stringify({
    model,
    messages: [
      {
        role: 'system',
        content: `${SHARED_SYSTEM_INSTRUCTIONS} ${answerFormGuidance(wordProfile, size)}`
      },
      {
        role: 'user',
        content: `Theme: ${theme}\nMaximum answer length: ${size}\nDifficulty: ${difficulty}\nAvoid these answers: ${exclude.join(', ')}\nGenerate ${count} varied, strongly theme-related entries with intersecting letter patterns.`
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'crossword_words',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            words: {
              type: 'array',
              minItems,
              maxItems: count,
              items: {
                type: 'object',
                properties: {answer: {type: 'string'}, clue: {type: 'string'}},
                required: ['answer', 'clue'],
                additionalProperties: false
              }
            },
          },
          required: ['words'],
          additionalProperties: false,
        },
      },
    },
    provider: {require_parameters: true},
  });

  if (generationStore) {
    try {
      const begun = await generationStore.beginAttempt({requestId, attemptNumber, model, startedAtMs, requestJson: requestBody, leaseToken});
      if (!begun?.acquired) throw new GenerationError(202, 'Theme generation is still in progress.', null, {category: 'pending', retryable: true});
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof GenerationError) throw error;
      throw new GenerationError(503, 'Theme generation storage is temporarily unavailable.', null, {category: 'storage_unavailable', retryable: true, cause: error});
    }
  }
  try {
    apiResponse = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'content-type': 'application/json',
        ...(env.OPENROUTER_SITE_URL ? {'http-referer': env.OPENROUTER_SITE_URL} : {}),
        'x-openrouter-title': 'Crossfolk'
      },
      body: requestBody,
    });
    // Read the body within the timeout: clearing the timer after the headers alone would
    // let a slow model stream for minutes past the abort deadline.
    responseText = await readCappedProviderBody(apiResponse);
  } catch (error) {
    const classified = error instanceof GenerationError ? error : error.name === 'AbortError'
      ? new GenerationError(504, 'Theme generation timed out.', null, {category: 'timeout'})
      : new GenerationError(502, 'Could not reach theme generation.', null, {category: 'network_error'});
    if (generationStore) {
      try { await generationStore.finishAttempt({requestId, leaseToken, attemptNumber, completedAtMs: Date.now(), durationMs: Date.now() - startedAtMs, outcome: classified.category || 'internal_error', errorCategory: classified.category, errorMessage: classified.message}); } catch (finalizationError) { logger.error(`Request ${requestId} attempt ${attemptNumber}: failed to finalize attempt:`, finalizationError); }
    }
    throw classified;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
  try {
    if (generationStore) {
      try {
        await generationStore.checkpointAttemptResponse({requestId, leaseToken, attemptNumber, providerResponseBody: responseText, providerHttpStatus: apiResponse.status, providerRequestId: safeProviderRequestId(apiResponse), responseReceivedAtMs: Date.now()});
      } catch (error) {
        throw new GenerationError(503, 'Theme generation storage is temporarily unavailable.', null, {category: 'storage_unavailable', retryable: true, cause: error});
      }
    }
    let payload;
    try { payload = JSON.parse(responseText); } catch { payload = null; }
    if (!apiResponse.ok) throw new GenerationError(502, safeDiagnostic(payload?.error?.message) || 'Theme generation failed.', readUsage(payload), {category: 'upstream_error', providerHttpStatus: apiResponse.status, providerRequestId: safeProviderRequestId(apiResponse)});
    const parsed = parseProviderResponse(responseText, {size, wordProfile});
    if (generationStore) {
      try { await generationStore.finishAttempt({requestId, leaseToken, attemptNumber, completedAtMs: Date.now(), durationMs: Date.now() - startedAtMs, outcome: 'success', providerHttpStatus: apiResponse.status, providerRequestId: safeProviderRequestId(apiResponse), inputTokens: parsed.usage?.input, outputTokens: parsed.usage?.output, totalTokens: parsed.usage?.total, usableWordCount: parsed.words.length}); } catch (finalizationError) { logger.error(`Request ${requestId} attempt ${attemptNumber}: failed to finalize attempt:`, finalizationError); }
    }
    return parsed;
  } catch (error) {
    if (generationStore && !(error instanceof GenerationError && error.category === 'storage_unavailable')) {
      try {
        await generationStore.finishAttempt({requestId, leaseToken, attemptNumber, completedAtMs: Date.now(), durationMs: Date.now() - startedAtMs, outcome: error.category || 'internal_error', providerHttpStatus: apiResponse.status, providerRequestId: safeProviderRequestId(apiResponse), inputTokens: error.usage?.input, outputTokens: error.usage?.output, totalTokens: error.usage?.total, usableWordCount: error.usableWordCount, errorCategory: error.category, errorMessage: error.message});
      } catch (finalizationError) { logger.error(`Request ${requestId} attempt ${attemptNumber}: failed to finalize attempt:`, finalizationError); }
    }
    throw error;
  }
}

// Returns plain `{status, body}` data rather than a `Response`, so this layer stays
// testable and reusable off any HTTP runtime.
export async function generateWords(input, env, {fetchImpl = fetch, timeoutMs = MAX_GENERATION_TIMEOUT_MS, maxModelTimeoutMs = MAX_MODEL_TIMEOUT_MS, signal, logger = defaultLogger, generationStore, requestId, leaseToken, startAttemptIndex = 0} = {}) {
  if (!env.OPENROUTER_API_KEY) return {status: 503, body: {error: 'AI theme generation is not configured.'}};

  const options = validateOptions(input);
  if (options.error) return options.error;

  const models = parseModels(env);
  const budgetMs = Math.max(10, Math.min(Number(timeoutMs) || MAX_GENERATION_TIMEOUT_MS, MAX_GENERATION_TIMEOUT_MS));
  const modelBudgetMs = Math.max(1, Math.min(Number(maxModelTimeoutMs) || MAX_MODEL_TIMEOUT_MS, MAX_MODEL_TIMEOUT_MS));
  const deadline = Date.now() + budgetMs;
  let lastError;
  let usage = null;

  if (startAttemptIndex >= models.length) {
    lastError = new GenerationError(502, 'All configured models have already failed.', null, {category: 'all_models_failed'});
  }

  for (let index = startAttemptIndex; index < models.length; index += 1) {
    if (signal?.aborted) {
      lastError = new GenerationError(504, 'Theme generation timed out.', null, {category: 'abort'});
      break;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      lastError = new GenerationError(504, 'Theme generation timed out.', null, {category: 'timeout'});
      break;
    }

    // Give the preferred model a useful window. Equal-splitting a short total budget
    // across a long fallback list aborts every otherwise-successful completion.
    const modelTimeoutMs = Math.min(modelBudgetMs, remainingMs);
    const model = models[index];
    logger.info(`Requesting theme words from OpenRouter model ${model}`);
    const startedAt = Date.now();
    try {
      const attempt = await requestThemeWords(model, options, env, fetchImpl, modelTimeoutMs, signal, {
        generationStore,
        requestId,
        leaseToken,
        logger,
        attemptNumber: index + 1
      });
      logger.info(`OpenRouter model ${model} answered in ${elapsedSeconds(startedAt)}s`);
      return {status: 200, body: {words: attempt.words, source: {model, usage: addUsage(usage, attempt.usage)}}};
    } catch (error) {
      if (!(error instanceof GenerationError)) throw error;
      usage = addUsage(usage, error.usage);
      lastError = error;
      logger.warn(`Request ${requestId || 'untracked'}: OpenRouter model ${model} failed after ${elapsedSeconds(startedAt)}s: ${error.message}`);
      if (error.retryable) break;
    }
  }

  return {status: lastError.status, body: {error: lastError.message, ...(requestId ? {requestId} : {}), ...(lastError.retryable ? {retryable: true} : {})}};
}

// `options.wordProfile` is absent for a row written before profiles existed, so that
// stored response keeps replaying under the legacy contract instead of the new thresholds.
export function parseStoredProviderResponse(responseText, size, providerHttpStatus = 200, options = {}) {
  return parseProviderResponse(responseText, {size, providerHttpStatus, wordProfile: options.wordProfile});
}
