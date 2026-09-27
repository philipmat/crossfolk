import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenerationPolicy, DEFAULT_POLICY, evaluatePolicy, parsePolicy, POLICY_KEY, spanFor, usageQuery} from '../server/generation-policy.js';
import {handleGenerationStatus, handleWords} from '../server/handler.js';
import {createLogger} from '../server/logger.js';
import worker from '../worker/index.js';

const WORDS_URL = 'http://localhost/api/words';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const silent = createLogger({log: () => {}});

function post(body) {
  return new Request(WORDS_URL, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
}

test('generation status reports off without reading quota usage', async () => {
  const store = stubStore({setting: {value_json: '{"mode":"off"}'}});
  const generationPolicy = createGenerationPolicy({logger: silent});
  const response = await handleGenerationStatus(new Request('http://localhost/api/generation-status'), {generationStore: store, generationPolicy, logger: silent});

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {enabled: false});
  assert.deepEqual(store.calls, [['readSetting', POLICY_KEY]]);
});

test('generation status defaults to enabled and rejects other methods', async () => {
  const enabled = await handleGenerationStatus(new Request('http://localhost/api/generation-status'));
  const wrongMethod = await handleGenerationStatus(new Request('http://localhost/api/generation-status', {method: 'POST'}));

  assert.deepEqual(await enabled.json(), {enabled: true});
  assert.equal(wrongMethod.status, 405);
});

test('the Cloudflare adapter exposes the disabled policy status', async () => {
  const appDb = {
    prepare() {
      return {
        bind() { return this; },
        async first() { return {value_json: '{"mode":"off"}'}; }
      };
    }
  };
  const response = await worker.fetch(new Request('https://crossfolk.example/api/generation-status'), {APP_DB: appDb});

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {enabled: false});
});

function stubStore({setting, usage = {count: 0, oldestStartedAtMs: null, latestStartedAtMs: null}, request} = {}) {
  const calls = [];
  return {
    calls,
    async readSetting(key) { calls.push(['readSetting', key]); return setting === undefined ? null : setting; },
    async usageSince(span) { calls.push(['usageSince', span]); return typeof usage === 'function' ? usage(span) : usage; },
    async claimRequest() { calls.push(['claimRequest']); return request || {created: true, acquired: true, leaseToken: 'lease', request: null}; },
    async getRequest() { return null; },
    async finishRequest(details) { calls.push(['finishRequest', details]); }
  };
}

test('parsePolicy accepts the documented shapes', () => {
  assert.deepEqual(parsePolicy('{"mode":"unrestricted"}'), {mode: 'unrestricted', perRequester: null, global: null, message: null});
  assert.equal(parsePolicy('{"mode":"off"}').mode, 'off');

  const limited = parsePolicy('{"mode":"limited","perRequester":{"limit":5,"windowSec":3600,"minIntervalSec":600},"global":{"limit":500,"windowSec":86400}}');
  assert.deepEqual(limited.perRequester, {limit: 5, windowMs: 3_600_000, minIntervalMs: 600_000});
  assert.deepEqual(limited.global, {limit: 500, windowMs: 86_400_000, minIntervalMs: null});
});

test('parsePolicy rejects policies it cannot honour exactly', () => {
  assert.throws(() => parsePolicy('{"mode":"sometimes"}'), /Unknown generation policy mode/);
  assert.throws(() => parsePolicy('{"mode":"limited"}'), /needs a perRequester or global rule/);
  assert.throws(() => parsePolicy('{"mode":"limited","perRequester":{"limit":5}}'), /needs a positive perRequester.windowSec/);
  assert.throws(() => parsePolicy('{"mode":"limited","perRequester":{"limit":-1,"windowSec":60}}'), /non-negative integer/);
  assert.throws(() => parsePolicy('{"mode":"limited","perRequester":{"limit":1.5,"windowSec":60}}'), /non-negative integer/);
  assert.throws(() => parsePolicy('[]'), /must be a JSON object/);
});

test('an unrestricted policy allows generation without reading usage', () => {
  assert.deepEqual(evaluatePolicy(DEFAULT_POLICY), {allowed: true});
});

test('a quota denial reports when the oldest request in the window expires', () => {
  const policy = parsePolicy('{"mode":"limited","perRequester":{"limit":5,"windowSec":3600}}');
  const now = 10_000_000;
  const decision = evaluatePolicy(policy, {perRequester: {count: 5, oldestStartedAtMs: now - 3_000_000, latestStartedAtMs: now - 1000}}, now);

  assert.equal(decision.allowed, false);
  assert.equal(decision.scope, 'perRequester');
  assert.equal(decision.reason, 'quota');
  assert.equal(decision.retryAfterMs, 600_000);
  assert.match(decision.message, /10 minutes/);
});

test('a minimum interval denies a second request inside the gap and allows it after', () => {
  const policy = parsePolicy('{"mode":"limited","perRequester":{"minIntervalSec":600}}');
  const now = 10_000_000;
  const inside = evaluatePolicy(policy, {perRequester: {count: 0, oldestStartedAtMs: null, latestStartedAtMs: now - 60_000}}, now);
  assert.equal(inside.reason, 'interval');
  assert.equal(inside.retryAfterMs, 540_000);

  const after = evaluatePolicy(policy, {perRequester: {count: 0, oldestStartedAtMs: null, latestStartedAtMs: now - 600_001}}, now);
  assert.deepEqual(after, {allowed: true});
});

test('the per-requester rule is checked before the shared global rule', () => {
  const policy = parsePolicy('{"mode":"limited","perRequester":{"limit":1,"windowSec":60},"global":{"limit":1,"windowSec":60}}');
  const now = 10_000_000;
  const usage = {count: 4, oldestStartedAtMs: now - 30_000, latestStartedAtMs: now - 1000};
  assert.equal(evaluatePolicy(policy, {perRequester: usage, global: usage}, now).scope, 'perRequester');
  assert.equal(evaluatePolicy(policy, {perRequester: {count: 0}, global: usage}, now).scope, 'global');
});

test('a zero limit blocks a scope outright', () => {
  const policy = parsePolicy('{"mode":"limited","global":{"limit":0,"windowSec":60}}');
  const decision = evaluatePolicy(policy, {global: {count: 0, oldestStartedAtMs: null, latestStartedAtMs: null}}, 10_000_000);
  assert.equal(decision.reason, 'quota');
  assert.equal(decision.retryAfterMs, 60_000);
});

test('an interval-only rule scans by interval and counts nothing', () => {
  const span = spanFor({limit: null, windowMs: null, minIntervalMs: 600_000}, 10_000_000);
  assert.equal(span.sinceMs, 9_400_000);
  assert.equal(span.windowStartMs, Number.MAX_SAFE_INTEGER);

  const {sql, params} = usageQuery({...span, requesterKey: 'abc', excludeId: REQUEST_ID});
  assert.match(sql, /outcome != 'throttled'/);
  assert.match(sql, /requester_key = \?/);
  assert.match(sql, /id != \?/);
  assert.deepEqual(params, [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'abc', 9_400_000, REQUEST_ID]);
});

test('the global query drops the requester filter', () => {
  const {sql, params} = usageQuery({sinceMs: 5, windowStartMs: 5});
  assert.doesNotMatch(sql, /requester_key/);
  assert.doesNotMatch(sql, /id != /);
  assert.deepEqual(params, [5, 5, 5]);
});

test('the policy row is cached and re-read once the cache expires', async () => {
  let clock = 0;
  const store = stubStore({setting: {value_json: '{"mode":"off"}'}});
  const policy = createGenerationPolicy({cacheMs: 30_000, now: () => clock, logger: silent});

  assert.equal((await policy.check({store})).allowed, false);
  clock = 29_999;
  await policy.check({store});
  clock = 30_000;
  await policy.check({store});

  assert.equal(store.calls.filter(([name]) => name === 'readSetting').length, 2);
});

test('an unreadable policy row keeps the last good policy instead of silently unlimiting', async () => {
  let clock = 0;
  let setting = {value_json: '{"mode":"off"}'};
  const errors = [];
  const store = {async readSetting() { return setting; }, async usageSince() { return {count: 0}; }};
  const policy = createGenerationPolicy({cacheMs: 1, now: () => clock, logger: createLogger({log: (...args) => errors.push(args)})});

  assert.equal((await policy.check({store})).allowed, false);
  setting = {value_json: '{"mode":"limted"}'};
  clock = 10_000;
  assert.equal((await policy.check({store})).allowed, false);
  assert.equal(errors.length, 1);
});

test('a missing policy row leaves generation unrestricted', async () => {
  const policy = createGenerationPolicy({logger: silent});
  assert.deepEqual(await policy.check({store: stubStore({setting: null})}), {allowed: true});
});

test('the policy reads the key it documents', async () => {
  const store = stubStore({setting: null});
  await createGenerationPolicy({logger: silent}).check({store});
  assert.deepEqual(store.calls[0], ['readSetting', POLICY_KEY]);
});

test('a disabled policy answers 503 so the browser falls back to local words', async () => {
  const store = stubStore({setting: {value_json: '{"mode":"off"}'}});
  const response = await handleWords(post({theme: 'ocean', size: 5, difficulty: 'easy', requestId: REQUEST_ID}), {
    env: {OPENROUTER_API_KEY: 'test'}, generationStore: store, generationPolicy: createGenerationPolicy({logger: silent}), logger: silent
  });

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.retryable, undefined);
  assert.equal(body.requestId, REQUEST_ID);
  assert.match(body.error, /temporarily turned off/);

  const [, finished] = store.calls.find(([name]) => name === 'finishRequest');
  assert.equal(finished.outcome, 'throttled');
  assert.equal(finished.httpStatus, 503);
  assert.equal(finished.errorCategory, 'generation_disabled');
  assert.equal(finished.leaseToken, 'lease');
});

test('an exhausted quota answers 429 with a retry-after header', async () => {
  const now = 10_000_000;
  const store = stubStore({
    setting: {value_json: '{"mode":"limited","perRequester":{"limit":2,"windowSec":3600}}'},
    usage: {count: 2, oldestStartedAtMs: now - 3_000_000, latestStartedAtMs: now}
  });
  const response = await handleWords(post({theme: 'ocean', size: 5, difficulty: 'easy', requestId: REQUEST_ID}), {
    env: {OPENROUTER_API_KEY: 'test'}, generationStore: store, generationPolicy: createGenerationPolicy({now: () => now, logger: silent}), logger: silent
  });

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '600');
  const body = await response.json();
  assert.equal(body.retryAfterMs, 600_000);
  assert.equal((store.calls.find(([name]) => name === 'finishRequest'))[1].errorCategory, 'rate_limited_perRequester');
});

test('the throttle excludes the row just claimed and charges only new requests', async () => {
  const spans = [];
  const store = stubStore({
    setting: {value_json: '{"mode":"limited","perRequester":{"limit":9,"windowSec":3600}}'},
    usage: (span) => { spans.push(span); return {count: 0, oldestStartedAtMs: null, latestStartedAtMs: null}; }
  });
  const policy = createGenerationPolicy({logger: silent});
  const options = {env: {OPENROUTER_API_KEY: 'test'}, generationStore: store, generationPolicy: policy, logger: silent};
  await handleWords(post({theme: 'ocean', size: 5, difficulty: 'easy', requestId: REQUEST_ID}), {...options, fetchImpl: async () => new Response('{}', {status: 500})});
  assert.deepEqual(spans.map((span) => span.excludeId), [REQUEST_ID]);

  // A poll of the same requestId re-enters with an existing row and must not be charged.
  store.calls.length = 0;
  const polled = stubStore({setting: {value_json: '{"mode":"limited","perRequester":{"limit":0,"windowSec":3600}}'},
    request: {created: false, acquired: false, request: {outcome: 'in_progress'}}});
  const response = await handleWords(post({theme: 'ocean', size: 5, difficulty: 'easy', requestId: REQUEST_ID}), {...options, generationStore: polled});
  assert.equal(response.status, 202);
  assert.equal(polled.calls.some(([name]) => name === 'usageSince'), false);
});
