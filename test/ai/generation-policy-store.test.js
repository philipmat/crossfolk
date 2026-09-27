import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openApplicationDatabase} from '../../server/sqlite-database.js';
import {SqliteGenerationStore} from '../../server/sqlite-generation-store.js';
import {createGenerationPolicy, parsePolicy, POLICY_KEY} from '../../server/generation-policy.js';
import {handleWords} from '../../server/handler.js';
import {createLogger} from '../../server/logger.js';

const WORDS_URL = 'http://localhost/api/words';
const silent = createLogger({log: () => {}});

async function tempDatabase(t) {
  const directory = await mkdtemp(join(tmpdir(), 'crossfolk-policy-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const database = openApplicationDatabase(join(directory, 'crossfolk.sqlite'));
  t.after(() => database.close());
  return database;
}

function seed(connection, {id, requesterKey = 'local', startedAtMs, outcome = 'succeeded'}) {
  connection.prepare(`INSERT INTO ai_generation_requests
    (id, started_at_ms, runtime, requester_key, requester_key_version, theme_key, exclude_count, request_json,
     request_fingerprint, prompt_version, configured_models_json, outcome)
    VALUES (?, ?, 'local', ?, 'v1', 'ocean', 0, '{}', 'fingerprint', 'v1', '[]', ?)`).run(id, startedAtMs, requesterKey, outcome);
}

function post(body) {
  return new Request(WORDS_URL, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
}

function setPolicy(connection, policy) {
  parsePolicy(policy);
  connection.prepare('UPDATE app_settings SET value_json = ?, updated_at_ms = ? WHERE key = ?').run(policy, Date.now(), POLICY_KEY);
}

test('the migrations leave AI generation disabled by default', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const row = await store.readSetting(POLICY_KEY);
  assert.equal(parsePolicy(row.value_json).mode, 'off');
  assert.equal(await store.readSetting('missing-key'), null);
});

test('usage counts respect the window, the requester, the excluded row and throttled outcomes', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const now = 10_000_000_000;
  seed(database.connection, {id: 'a', startedAtMs: now - 7_200_000});
  seed(database.connection, {id: 'b', startedAtMs: now - 1_800_000});
  seed(database.connection, {id: 'c', startedAtMs: now - 60_000});
  seed(database.connection, {id: 'd', startedAtMs: now - 30_000, outcome: 'throttled'});
  seed(database.connection, {id: 'e', startedAtMs: now - 10_000, requesterKey: 'other'});
  seed(database.connection, {id: 'f', startedAtMs: now});

  const window = {sinceMs: now - 3_600_000, windowStartMs: now - 3_600_000};
  const scoped = await store.usageSince({...window, requesterKey: 'local', excludeId: 'f'});
  assert.deepEqual(scoped, {count: 2, oldestStartedAtMs: now - 1_800_000, latestStartedAtMs: now - 60_000});

  const everyone = await store.usageSince({...window, excludeId: 'f'});
  assert.equal(everyone.count, 3);
  assert.equal(everyone.latestStartedAtMs, now - 10_000);

  // An interval-only read scans a shorter span and counts nothing.
  const interval = await store.usageSince({sinceMs: now - 120_000, windowStartMs: Number.MAX_SAFE_INTEGER, requesterKey: 'local', excludeId: 'f'});
  assert.deepEqual(interval, {count: 0, oldestStartedAtMs: null, latestStartedAtMs: now - 60_000});
});

test('a live policy edit throttles the next request and the denial replays for its requestId', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const policy = createGenerationPolicy({cacheMs: 0, logger: silent});
  const options = {env: {OPENROUTER_API_KEY: 'test', RUNTIME: 'local', REQUESTER_KEY: 'local'}, generationStore: store, generationPolicy: policy, logger: silent};
  setPolicy(database.connection, '{"mode":"limited","perRequester":{"limit":1,"windowSec":3600}}');
  seed(database.connection, {id: 'earlier', startedAtMs: Date.now() - 60_000});

  const id = '33333333-3333-4333-8333-333333333333';
  const denied = await handleWords(post({theme: 'ocean', size: 5, difficulty: 'easy', requestId: id}), options);
  assert.equal(denied.status, 429);
  const body = await denied.json();
  assert.match(body.error, /AI puzzle limit/);

  const stored = await store.getRequest(id);
  assert.equal(stored.outcome, 'throttled');
  assert.equal(stored.lease_token, null);

  // The browser retries the same requestId: it must replay the denial, not hang pending.
  const replay = await handleWords(post({theme: 'ocean', size: 5, difficulty: 'easy', requestId: id}), options);
  assert.equal(replay.status, 429);
  assert.deepEqual(await replay.json(), body);

  // The throttled row itself must not consume the quota it was denied by.
  const usage = await store.usageSince({sinceMs: 0, windowStartMs: 0, requesterKey: 'local'});
  assert.equal(usage.count, 1);
});

test('turning generation off stops new requests without touching stored results', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const options = {env: {OPENROUTER_API_KEY: 'test', RUNTIME: 'local', REQUESTER_KEY: 'local'}, generationStore: store,
    generationPolicy: createGenerationPolicy({cacheMs: 0, logger: silent}), logger: silent};
  setPolicy(database.connection, '{"mode":"off","message":"Puzzles are resting. Try a preset theme."}');

  const response = await handleWords(post({theme: 'ocean', size: 5, difficulty: 'easy', requestId: '44444444-4444-4444-8444-444444444444'}), options);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'Puzzles are resting. Try a preset theme.');
});
