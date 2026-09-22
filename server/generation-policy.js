// Runtime-tunable throttle for AI generation. The entire policy lives in one
// `app_settings` row, so an operator retunes limits or stops generation outright with a
// single SQL statement and no redeploy. Each isolate re-reads that row at most once per
// POLICY_CACHE_MS, so an edit takes effect within roughly half a minute.
import {logger as defaultLogger} from './logger.js';

export const POLICY_KEY = 'ai_generation_policy';
export const POLICY_CACHE_MS = 30_000;
// Denied requests are recorded with this outcome and excluded from the usage counts, so
// a denial can be replayed for its requestId without consuming quota of its own.
export const THROTTLED_OUTCOME = 'throttled';
export const DEFAULT_POLICY = Object.freeze({mode: 'unrestricted', perRequester: null, global: null, message: null});

const MODES = new Set(['unrestricted', 'off', 'limited']);

function count(value, label) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} must be a non-negative integer.`);
  return number;
}

function rule(raw, label) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object.`);
  const limit = count(raw.limit, `${label}.limit`);
  const windowSec = count(raw.windowSec, `${label}.windowSec`);
  const minIntervalSec = count(raw.minIntervalSec, `${label}.minIntervalSec`);
  if (limit != null && !windowSec) throw new Error(`${label}.limit needs a positive ${label}.windowSec.`);
  if (limit == null && !minIntervalSec) return null;

  return Object.freeze({
    limit,
    windowMs: windowSec == null ? null : windowSec * 1000,
    minIntervalMs: minIntervalSec ? minIntervalSec * 1000 : null
  });
}

/** Parse and validate the stored policy JSON. Throws on anything it cannot honour exactly. */
export function parsePolicy(value) {
  const raw = typeof value === 'string' ? JSON.parse(value) : value;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The generation policy must be a JSON object.');
  const mode = String(raw.mode ?? 'unrestricted').trim().toLowerCase();
  if (!MODES.has(mode)) throw new Error(`Unknown generation policy mode "${raw.mode}".`);

  const policy = {
    mode,
    perRequester: rule(raw.perRequester, 'perRequester'),
    global: rule(raw.global, 'global'),
    message: raw.message == null ? null : String(raw.message).slice(0, 240)
  };
  if (mode === 'limited' && !policy.perRequester && !policy.global) throw new Error('A limited policy needs a perRequester or global rule.');

  return Object.freeze(policy);
}

/** The scan span a rule needs: `windowStartMs` bounds the count, `sinceMs` bounds the whole read. */
export function spanFor(rule, now) {
  // MAX_SAFE_INTEGER keeps the counting branch of the query empty for an interval-only rule.
  const windowStartMs = rule.windowMs == null ? Number.MAX_SAFE_INTEGER : now - rule.windowMs;
  return {windowStartMs, sinceMs: Math.min(windowStartMs, rule.minIntervalMs == null ? windowStartMs : now - rule.minIntervalMs)};
}

function formatWait(ms) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 90) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

function denial(rule, usage, now) {
  if (!rule || !usage) return null;
  if (rule.minIntervalMs != null && usage.latestStartedAtMs != null) {
    const wait = Number(usage.latestStartedAtMs) + rule.minIntervalMs - now;
    if (wait > 0) return {reason: 'interval', retryAfterMs: wait};
  }
  if (rule.limit != null && usage.count >= rule.limit) {
    const oldest = usage.oldestStartedAtMs == null ? now : Number(usage.oldestStartedAtMs);
    return {reason: 'quota', retryAfterMs: Math.max(1000, oldest + rule.windowMs - now)};
  }
  return null;
}

function describe(scope, found, policy) {
  if (policy.message) return policy.message;
  const wait = `Try again in about ${formatWait(found.retryAfterMs)}.`;
  if (scope === 'global') return `AI theme generation has reached its shared limit for now. ${wait}`;
  return found.reason === 'interval' ? `New AI puzzles are spaced out right now. ${wait}` : `You have reached the AI puzzle limit for now. ${wait}`;
}

/**
 * Decide on already-read usage. `usage.perRequester` and `usage.global` are
 * `{count, oldestStartedAtMs, latestStartedAtMs}` for the matching rule, or null.
 */
export function evaluatePolicy(policy, usage = {}, now = Date.now()) {
  if (policy.mode === 'unrestricted') return {allowed: true};
  if (policy.mode === 'off') return {allowed: false, scope: 'service', reason: 'disabled', retryAfterMs: null, message: policy.message || 'AI theme generation is temporarily turned off.'};

  for (const scope of ['perRequester', 'global']) {
    const found = denial(policy[scope], usage[scope], now);
    if (found) return {allowed: false, scope, reason: found.reason, retryAfterMs: found.retryAfterMs, message: describe(scope, found, policy)};
  }

  return {allowed: true};
}

/**
 * Holds the cached policy across requests, so it belongs at module scope in an adapter
 * rather than being rebuilt per request. The store is supplied per check because it is
 * bound to the requester.
 */
export function createGenerationPolicy({cacheMs = POLICY_CACHE_MS, now = Date.now, logger = defaultLogger} = {}) {
  let cached = null;

  async function current(store) {
    const at = now();
    if (cached && at - cached.readAtMs < cacheMs) return cached.policy;
    const row = await store.readSetting(POLICY_KEY);

    let policy;
    try {
      policy = row?.value_json == null ? DEFAULT_POLICY : parsePolicy(row.value_json);
    } catch (error) {
      // An operator typo must not silently rewrite the limits: keep the last policy this
      // isolate read successfully, and only fall back to the default when there is none.
      logger.error(`Ignoring an unreadable ${POLICY_KEY} setting:`, error);
      policy = cached?.policy ?? DEFAULT_POLICY;
    }
    cached = {policy, readAtMs: at};
    return policy;
  }

  return {
    async check({store, requesterKey = null, excludeId = null} = {}) {
      const policy = await current(store);
      if (policy.mode === 'unrestricted') return {allowed: true};
      if (policy.mode === 'off') return evaluatePolicy(policy);

      const at = now();
      const usage = {
        perRequester: policy.perRequester ? await store.usageSince({...spanFor(policy.perRequester, at), requesterKey, excludeId}) : null,
        global: policy.global ? await store.usageSince({...spanFor(policy.global, at), excludeId}) : null
      };
      return evaluatePolicy(policy, usage, at);
    }
  };
}

/**
 * The one usage query both storage adapters run, kept here so they cannot drift apart.
 * The conditional aggregates let a single scan answer the window count and the
 * minimum-interval check even when those two spans differ.
 */
export function usageQuery({sinceMs, windowStartMs, requesterKey = null, excludeId = null}) {
  const filters = [
    requesterKey == null ? null : 'requester_key = ?',
    'started_at_ms >= ?',
    `outcome != '${THROTTLED_OUTCOME}'`,
    excludeId == null ? null : 'id != ?'
  ].filter(Boolean);
  const sql = `SELECT COUNT(CASE WHEN started_at_ms >= ? THEN 1 END) AS count,
      MIN(CASE WHEN started_at_ms >= ? THEN started_at_ms END) AS oldest,
      MAX(started_at_ms) AS latest
    FROM ai_generation_requests WHERE ${filters.join(' AND ')}`;
  const params = [windowStartMs, windowStartMs, ...(requesterKey == null ? [] : [requesterKey]), sinceMs, ...(excludeId == null ? [] : [excludeId])];
  return {sql, params};
}

export function usageRow(row) {
  return {count: Number(row?.count ?? 0), oldestStartedAtMs: row?.oldest ?? null, latestStartedAtMs: row?.latest ?? null};
}
