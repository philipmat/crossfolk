const MAX_DIAGNOSTIC_JSON = 16 * 1024;
const MAX_RESPONSE_BODY = 256 * 1024;
const MAX_REPLAY_JSON = 512 * 1024;

function bounded(value, limit = MAX_DIAGNOSTIC_JSON) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  if (new TextEncoder().encode(text).byteLength > limit) throw new Error('Diagnostic data exceeds the storage limit.');
  return text;
}

function value(value) {
  return value === undefined ? null : value;
}

function diagnostic(value) {
  return value == null ? null : String(value).slice(0, 4096);
}

async function first(statement) {
  if (typeof statement.first === 'function') return statement.first();
  if (typeof statement.get === 'function') return statement.get();
  const result = await statement.all();
  return result.results?.[0] || result[0] || null;
}

async function changed(statement) {
  const result = await statement.run();
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function retry(operation, attempts = 3) {
  let error;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); } catch (failure) { error = failure; if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1))); }
  }
  throw error;
}

export class D1GenerationStore {
  constructor(database, {runtime = 'cloudflare', leaseMs = 120_000, requesterKey = 'unknown', requesterKeyVersion = 'hmac-v1'} = {}) {
    this.database = database;
    this.runtime = runtime;
    this.leaseMs = leaseMs;
    this.requesterKey = requesterKey;
    this.requesterKeyVersion = requesterKeyVersion;
  }

  async getRequest(id) {
    const request = await first(this.database.prepare('SELECT * FROM ai_generation_requests WHERE id = ?').bind(id));
    if (!request) return null;
    const result = await this.database.prepare('SELECT * FROM ai_generation_attempts WHERE request_id = ? ORDER BY attempt_number').bind(id).all();
    request.attempts = result.results || result;
    return request;
  }

  async claimRequest(details) {
    const now = details.startedAtMs ?? Date.now();
    const expires = details.leaseExpiresAtMs ?? now + this.leaseMs;
    const leaseToken = details.leaseToken || crypto.randomUUID();
    const inserted = await retry(() => changed(this.database.prepare(`INSERT OR IGNORE INTO ai_generation_requests
      (id, started_at_ms, runtime, requester_key, requester_key_version, theme, theme_key, size, difficulty,
       exclude_count, request_json, request_fingerprint, prompt_version, configured_models_json, outcome,
       lease_token, lease_expires_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, ?)`)
      .bind(details.id, now, details.runtime ?? this.runtime, details.requesterKey ?? this.requesterKey,
        details.requesterKeyVersion ?? this.requesterKeyVersion, value(details.theme), details.themeKey ?? '', value(details.size),
        value(details.difficulty), details.excludeCount ?? 0, bounded(details.requestJson), details.requestFingerprint,
        details.promptVersion ?? 'v1', bounded(details.configuredModelsJson), leaseToken, expires)));
    if (inserted) return {created: true, acquired: true, leaseToken, request: await this.getRequest(details.id)};

    let request = await this.getRequest(details.id);
    if (!request) throw new Error('Request claim disappeared.');
    if (request.request_fingerprint !== details.requestFingerprint) return {created: false, acquired: false, conflict: true, request};
    if (request.outcome === 'in_progress' && Number(request.lease_expires_at_ms || 0) <= now) {
      const reclaimed = await retry(() => changed(this.database.prepare(`UPDATE ai_generation_requests SET lease_token = ?, lease_expires_at_ms = ?, recovery_count = recovery_count + 1, last_reclaimed_at_ms = ?
        WHERE id = ? AND request_fingerprint = ? AND outcome = 'in_progress' AND lease_expires_at_ms <= ?`)
        .bind(leaseToken, expires, now, details.id, details.requestFingerprint, now)));
      if (reclaimed) return {created: false, acquired: true, reclaimed: true, leaseToken, request: await this.getRequest(details.id)};
      request = await this.getRequest(details.id);
    }
    const acquired = request.outcome === 'in_progress' && request.lease_token === leaseToken;
    return {created: false, acquired, leaseToken: acquired ? leaseToken : null, request};
  }

  async beginAttempt(details) {
    const inserted = await retry(() => changed(this.database.prepare(`INSERT OR IGNORE INTO ai_generation_attempts
      (request_id, attempt_number, model, started_at_ms, outcome, request_json)
      SELECT ?, ?, ?, ?, 'in_progress', ? WHERE EXISTS
      (SELECT 1 FROM ai_generation_requests WHERE id = ? AND lease_token = ?)`)
      .bind(details.requestId, details.attemptNumber, details.model, details.startedAtMs ?? Date.now(), bounded(details.requestJson), details.requestId, details.leaseToken)));
    const restarted = !inserted ? await retry(() => changed(this.database.prepare(`UPDATE ai_generation_attempts SET model = ?, started_at_ms = ?, completed_at_ms = NULL, duration_ms = NULL,
      outcome = 'in_progress', request_json = ?, provider_response_body = NULL, response_received_at_ms = NULL, error_category = NULL, error_message = NULL
      WHERE request_id = ? AND attempt_number = ? AND outcome = 'in_progress' AND EXISTS
      (SELECT 1 FROM ai_generation_requests WHERE id = ? AND lease_token = ?)`).bind(details.model, details.startedAtMs ?? Date.now(), bounded(details.requestJson), details.requestId, details.attemptNumber, details.requestId, details.leaseToken))) : 0;
    return {acquired: Boolean(inserted || restarted), attempt: await first(this.database.prepare('SELECT * FROM ai_generation_attempts WHERE request_id = ? AND attempt_number = ?').bind(details.requestId, details.attemptNumber))};
  }

  async checkpointAttemptResponse(details) {
    const body = String(details.providerResponseBody ?? '');
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BODY) throw new Error('Provider response exceeded the storage limit.');
    const updated = await retry(() => changed(this.database.prepare(`UPDATE ai_generation_attempts SET provider_response_body = ?, provider_http_status = ?,
      provider_request_id = ?, response_received_at_ms = ?, outcome = 'response_received'
      WHERE request_id = ? AND attempt_number = ? AND provider_response_body IS NULL
      AND EXISTS (SELECT 1 FROM ai_generation_requests WHERE id = ? AND lease_token = ?)`)
      .bind(body, value(details.providerHttpStatus), diagnostic(details.providerRequestId), details.responseReceivedAtMs ?? Date.now(), details.requestId, details.attemptNumber, details.requestId, details.leaseToken)));
    if (!updated) throw new Error('Provider response checkpoint was not accepted.');
  }

  async finishAttempt(details) {
    await this.database.prepare(`UPDATE ai_generation_attempts SET completed_at_ms = ?, duration_ms = ?, outcome = ?, provider_http_status = COALESCE(?, provider_http_status),
      provider_request_id = COALESCE(?, provider_request_id), input_tokens = ?, output_tokens = ?, total_tokens = ?, usable_word_count = ?, error_category = ?, error_message = ?
      WHERE request_id = ? AND attempt_number = ? AND EXISTS (SELECT 1 FROM ai_generation_requests WHERE id = ? AND lease_token = ?)`).bind(details.completedAtMs ?? Date.now(), value(details.durationMs), details.outcome,
      value(details.providerHttpStatus), diagnostic(details.providerRequestId), value(details.inputTokens), value(details.outputTokens), value(details.totalTokens),
      value(details.usableWordCount), value(details.errorCategory), details.errorMessage == null ? null : bounded(details.errorMessage), details.requestId, details.attemptNumber, details.requestId, details.leaseToken).run();
  }

  async finishRequest(details) {
    await this.database.prepare(`UPDATE ai_generation_requests SET completed_at_ms = ?, duration_ms = ?, outcome = ?, http_status = ?, error_category = ?, error_message = ?,
      selected_model = ?, attempt_count = ?, result_word_count = ?, response_json = ?, known_input_tokens = ?, known_output_tokens = ?, known_total_tokens = ?, usage_complete = ?,
      lease_token = NULL, lease_expires_at_ms = NULL WHERE id = ? AND lease_token = ?`).bind(
      value(details.completedAtMs ?? Date.now()), value(details.durationMs), details.outcome, value(details.httpStatus), details.errorCategory == null ? null : bounded(details.errorCategory), details.errorMessage == null ? null : bounded(details.errorMessage),
      value(details.selectedModel), value(details.attemptCount ?? 0), value(details.resultWordCount), details.responseJson == null ? null : bounded(details.responseJson, MAX_REPLAY_JSON),
      value(details.knownInputTokens), value(details.knownOutputTokens), value(details.knownTotalTokens), details.usageComplete ? 1 : 0, details.id, details.leaseToken).run();
  }
}

export {MAX_DIAGNOSTIC_JSON, MAX_RESPONSE_BODY, MAX_REPLAY_JSON};
