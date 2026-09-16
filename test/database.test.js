import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openApplicationDatabase} from '../server/sqlite-database.js';
import {SqliteGenerationStore} from '../server/sqlite-generation-store.js';
import {handleWords, requestFingerprint} from '../server/handler.js';
import {PROMPT_VERSION, WORD_PROFILE_VERSION} from '../server/words.js';

async function tempDatabase(t) {
  const directory = await mkdtemp(join(tmpdir(), 'crossfolk-db-'));
  t.after(async () => rm(directory, {recursive: true, force: true}));
  const database = openApplicationDatabase(join(directory, 'crossfolk.sqlite'));
  t.after(() => database.close());
  return database;
}

test('application database applies the AI logging migration and can replay it', async (t) => {
  const database = await tempDatabase(t);

  const tables = database.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ['ai_generation_attempts', 'ai_generation_requests', 'schema_migrations']);
  assert.equal(database.connection.prepare('SELECT count(*) AS count FROM schema_migrations').get().count, 1);

  database.applyMigrations();
  assert.equal(database.connection.prepare('SELECT count(*) AS count FROM schema_migrations').get().count, 1);

  const indexes = database.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_ai_generation_%' ORDER BY name").all().map((row) => row.name);
  assert.ok(indexes.includes('idx_ai_generation_requests_requester_started'));
  assert.ok(indexes.includes('idx_ai_generation_attempts_model_started'));
});

test('SQLite generation store atomically claims and records a request and attempt', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection, {runtime: 'local'});
  const details = {
    id: '11111111-1111-4111-8111-111111111111', startedAtMs: 1000, runtime: 'local', requesterKey: 'local',
    theme: ' Ocean  Storm ', themeKey: 'ocean storm', size: 5, difficulty: 'easy', excludeCount: 2,
    requestJson: '{"theme":"Ocean Storm"}', requestFingerprint: 'fingerprint', promptVersion: 'v1',
    configuredModelsJson: '["model"]', leaseExpiresAtMs: 91_000
  };
  const claim = await store.claimRequest(details);
  assert.equal(claim.created, true);
  assert.equal(claim.request.id, details.id);
  const replay = await store.claimRequest(details);
  assert.equal(replay.created, false);
  assert.equal(replay.request.id, details.id);

  const attempt = await store.beginAttempt({requestId: details.id, attemptNumber: 1, model: 'model', startedAtMs: 1001, requestJson: '{}', leaseToken: claim.leaseToken});
  assert.equal(attempt.acquired, true);
  await store.checkpointAttemptResponse({requestId: details.id, leaseToken: claim.leaseToken, attemptNumber: 1, providerResponseBody: '{"ok":true}', providerHttpStatus: 200, responseReceivedAtMs: 1002, providerRequestId: 'req-1'});
  await store.finishAttempt({requestId: details.id, leaseToken: claim.leaseToken, attemptNumber: 1, completedAtMs: 1003, durationMs: 2, outcome: 'success', inputTokens: 4, outputTokens: 5, totalTokens: 9, usableWordCount: 3});
  await store.finishRequest({id: details.id, leaseToken: claim.leaseToken, completedAtMs: 1004, durationMs: 4, outcome: 'succeeded', httpStatus: 200, selectedModel: 'model', attemptCount: 1, resultWordCount: 3, responseJson: '{"words":[]}', knownInputTokens: 4, knownOutputTokens: 5, knownTotalTokens: 9, usageComplete: true});

  const row = await store.getRequest(details.id);
  assert.equal(row.outcome, 'succeeded');
  assert.equal(row.known_total_tokens, 9);
  assert.equal(row.attempts[0].provider_response_body, '{"ok":true}');
});

test('handler replays a successful UUID without another provider call', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const requestId = '22222222-2222-4222-8222-222222222222';
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({words: [
      {answer: 'reef', clue: 'Coral ridge'}, {answer: 'tide', clue: 'Ocean rise'}, {answer: 'wave', clue: 'Ocean motion'}
    ]})}}], usage: {prompt_tokens: 4, completion_tokens: 5, total_tokens: 9}}), {status: 200});
  };
  const input = {requestId, theme: 'ocean', size: 5, difficulty: 'easy', exclude: []};
  const first = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input)}), {
    env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'only/model'}, generationStore: store, fetchImpl
  });
  assert.equal(first.status, 200);
  const expected = await first.json();
  const second = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input)}), {
    env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'only/model'}, generationStore: store, fetchImpl
  });
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), expected);
  assert.equal(calls, 1);

  const row = await store.getRequest(requestId);
  assert.equal(row.attempts.length, 1);
  assert.ok(row.attempts[0].provider_response_body);
  assert.ok(row.response_json);
});

test('handler rejects UUID reuse with a different fingerprint and logs invalid requests', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const requestId = '33333333-3333-4333-8333-333333333333';
  const make = (body) => new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  const first = await handleWords(make({requestId, theme: 'ocean'}), {env: {}, generationStore: store});
  assert.equal(first.status, 503);
  const conflict = await handleWords(make({requestId, theme: 'space'}), {env: {}, generationStore: store});
  assert.equal(conflict.status, 409);
  assert.match((await conflict.json()).error, /different generation inputs/);
  const invalidId = '44444444-4444-4444-8444-444444444444';
  const invalid = await handleWords(make({requestId: invalidId, theme: ''}), {env: {OPENROUTER_API_KEY: 'test'}, generationStore: store});
  assert.equal(invalid.status, 400);
  const row = await store.getRequest(invalidId);
  assert.equal(row.outcome, 'invalid');
  assert.equal(row.attempts.length, 0);
});

test('a stale request resumes from its durable raw response without calling the provider', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection, {leaseMs: 100});
  const requestId = '55555555-5555-4555-8555-555555555555';
  const input = {requestId, theme: 'ocean', size: 5, difficulty: 'easy', exclude: []};
  const details = {
    id: requestId, startedAtMs: 1, runtime: 'local', requesterKey: 'local', requesterKeyVersion: 'v1', theme: 'ocean', themeKey: 'ocean',
    size: 5, difficulty: 'easy', excludeCount: 0, requestJson: JSON.stringify(input), requestFingerprint: requestFingerprint({theme: 'ocean', themeKey: 'ocean', size: 5, difficulty: 'easy', exclude: [], count: 40, promptVersion: PROMPT_VERSION, models: ['only/model'], wordProfile: 'freeform-bank', wordProfileVersion: WORD_PROFILE_VERSION}),
    promptVersion: PROMPT_VERSION, configuredModelsJson: '["only/model"]', leaseExpiresAtMs: 2
  };
  const claim = await store.claimRequest(details);
  await store.beginAttempt({requestId, attemptNumber: 1, model: 'only/model', startedAtMs: 2, requestJson: '{}', leaseToken: claim.leaseToken});
  const raw = JSON.stringify({choices: [{message: {content: JSON.stringify({words: [
    {answer: 'reef', clue: 'Coral ridge'}, {answer: 'tide', clue: 'Ocean rise'}, {answer: 'wave', clue: 'Ocean motion'}
  ]})}}], usage: {prompt_tokens: 2, completion_tokens: 3, total_tokens: 5}});
  await store.checkpointAttemptResponse({requestId, leaseToken: claim.leaseToken, attemptNumber: 1, providerResponseBody: raw, providerHttpStatus: 200, responseReceivedAtMs: 3});
  database.connection.prepare("UPDATE ai_generation_requests SET lease_expires_at_ms = 0 WHERE id = ?").run(requestId);
  let calls = 0;
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input)}), {
    env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'only/model'}, generationStore: store, fetchImpl: async () => { calls += 1; throw new Error('must recover'); }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.words.length, 3);
  assert.equal(body.requestId, requestId);
  assert.equal(calls, 0);
  assert.equal(JSON.parse((await store.getRequest(requestId)).response_json).requestId, requestId);
});

test('provider response is checkpointed before the attempt is finalized', async () => {
  const events = [];
  const requestId = '66666666-6666-4666-8666-666666666666';
  const store = {
    async claimRequest(details) { return {created: true, acquired: true, leaseToken: 'lease', request: {id: details.id, attempts: [], started_at_ms: details.startedAtMs}}; },
    async beginAttempt() { events.push('begin'); return {acquired: true}; },
    async checkpointAttemptResponse(details) { events.push(`checkpoint:${details.providerResponseBody.length}`); },
    async finishAttempt() { assert.ok(events.some((event) => event.startsWith('checkpoint:'))); events.push('finish-attempt'); },
    async getRequest() { return {attempts: [{attempt_number: 1}]}; },
    async finishRequest() { events.push('finish-request'); }
  };
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId, theme: 'ocean'})}), {
    env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'only/model'}, generationStore: store,
    fetchImpl: async () => new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({words: [
      {answer: 'reef', clue: 'Coral ridge'}, {answer: 'tide', clue: 'Ocean rise'}, {answer: 'wave', clue: 'Ocean motion'}
    ]})}}]}), {status: 200})
  });
  assert.equal(response.status, 200);
  assert.equal(events[0], 'begin');
  assert.match(events[1], /^checkpoint:/);
  assert.equal(events[2], 'finish-attempt');
});

test('a failed attempt claim prevents an untracked provider call', async () => {
  let calls = 0;
  let finalized = false;
  const store = {
    async claimRequest(details) { return {created: true, acquired: true, leaseToken: 'lease', request: {id: details.id, attempts: [], started_at_ms: details.startedAtMs}}; },
    async beginAttempt() { throw new Error('database busy'); },
    async getRequest() { return {attempts: []}; },
    async finishRequest() { finalized = true; }
  };
  const id = '88888888-8888-4888-8888-888888888888';
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme: 'ocean'})}), {
    env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'only/model'}, generationStore: store,
    fetchImpl: async () => { calls += 1; return new Response('{}'); }
  });
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
  assert.equal((await response.json()).retryable, true);
  assert.equal(finalized, false);
});

test('fallback attempts remain ordinal and retain discarded usage', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = '99999999-9999-4999-8999-999999999999';
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({error: {message: 'try another model'}, usage: {prompt_tokens: 7, completion_tokens: 2, total_tokens: 9}}), {status: 429, headers: {'x-request-id': 'provider-a'}});
    return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({words: [
      {answer: 'reef', clue: 'Coral ridge'}, {answer: 'tide', clue: 'Ocean rise'}, {answer: 'wave', clue: 'Ocean motion'}
    ]})}}], usage: {prompt_tokens: 3, completion_tokens: 4, total_tokens: 7}}), {status: 200, headers: {'x-request-id': 'provider-b'}});
  };
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme: 'ocean'})}), {
    env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'first/model,second/model'}, generationStore: store, fetchImpl
  });
  assert.equal(response.status, 200);
  const row = await store.getRequest(id);
  assert.deepEqual(row.attempts.map((attempt) => [attempt.attempt_number, attempt.model]), [[1, 'first/model'], [2, 'second/model']]);
  assert.equal(row.known_total_tokens, 16);
  assert.equal(row.attempts[0].provider_request_id, 'provider-a');
});

test('concurrent SQLite claims yield one provider owner', async (t) => {
  const database = await tempDatabase(t);
  const firstStore = new SqliteGenerationStore(database.connection);
  const secondStore = new SqliteGenerationStore(database.connection);
  const common = {id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', startedAtMs: Date.now(), runtime: 'local', requesterKey: 'local', requesterKeyVersion: 'v1', theme: 'ocean', themeKey: 'ocean', size: 5, difficulty: 'easy', excludeCount: 0, requestJson: '{}', requestFingerprint: 'same', promptVersion: 'v1', configuredModelsJson: '["m"]', leaseExpiresAtMs: Date.now() + 10_000};
  const claims = await Promise.all([firstStore.claimRequest(common), secondStore.claimRequest(common)]);
  assert.equal(claims.filter((claim) => claim.acquired).length, 1);
  assert.equal(claims.filter((claim) => claim.created).length, 1);
});

test('oversized provider bodies are classified without being checkpointed', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme: 'ocean'})}), {
    env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'only/model'}, generationStore: store,
    fetchImpl: async () => new Response('x'.repeat(256 * 1024 + 1), {status: 200})
  });
  assert.equal(response.status, 502);
  const row = await store.getRequest(id);
  assert.equal(row.attempts[0].outcome, 'oversized_response');
  assert.equal(row.attempts[0].provider_response_body, null);
});
