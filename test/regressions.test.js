import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openApplicationDatabase, applyMigrations} from '../server/sqlite-database.js';
import {SqliteGenerationStore, MAX_RESPONSE_BODY} from '../server/sqlite-generation-store.js';
import {D1GenerationStore} from '../worker/d1-generation-store.js';
import {handleWords, requestFingerprint} from '../server/handler.js';
import {isWordsPath} from '../server/index.js';
import {MAX_PROVIDER_RESPONSE_BODY, readCappedProviderBody, readUsage} from '../server/words.js';
import worker from '../worker/index.js';

async function tempDatabase(t) {
  const directory = await mkdtemp(join(tmpdir(), 'crossfolk-regression-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const database = openApplicationDatabase(join(directory, 'crossfolk.sqlite'));
  t.after(() => database.close());
  return database;
}

function details(id, fingerprint, expires = Date.now() + 60_000) {
  return {id, startedAtMs: Date.now(), runtime: 'local', requesterKey: 'local', requesterKeyVersion: 'v1', theme: 'ocean', themeKey: 'ocean',
    size: 5, difficulty: 'easy', excludeCount: 0, requestJson: '{}', requestFingerprint: fingerprint, promptVersion: 'crossfolk-words-v2',
    configuredModelsJson: '["first/model","second/model"]', leaseExpiresAtMs: expires};
}

test('reclaimed request lease prevents old owner writes', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = '10101010-1010-4101-8101-101010101010';
  const old = await store.claimRequest(details(id, 'lease-fingerprint'));
  const originalStartedAt = (await store.getRequest(id)).started_at_ms;
  database.connection.prepare('UPDATE ai_generation_requests SET lease_expires_at_ms = 0 WHERE id = ?').run(id);
  const current = await store.claimRequest(details(id, 'lease-fingerprint'));
  assert.notEqual(old.leaseToken, current.leaseToken);
  assert.equal((await store.getRequest(id)).started_at_ms, originalStartedAt);
  await store.beginAttempt({requestId: id, attemptNumber: 1, model: 'first/model', requestJson: '{}', leaseToken: current.leaseToken});
  await assert.rejects(() => store.checkpointAttemptResponse({requestId: id, attemptNumber: 1, leaseToken: old.leaseToken, providerResponseBody: 'old', providerHttpStatus: 200}));
  await store.checkpointAttemptResponse({requestId: id, attemptNumber: 1, leaseToken: current.leaseToken, providerResponseBody: 'current', providerHttpStatus: 200});
  await store.finishAttempt({requestId: id, attemptNumber: 1, leaseToken: old.leaseToken, outcome: 'old', errorMessage: 'old'});
  const attempt = (await store.getRequest(id)).attempts[0];
  assert.equal(attempt.outcome, 'response_received');
  await store.finishRequest({id, leaseToken: old.leaseToken, outcome: 'succeeded', httpStatus: 200, responseJson: '{"old":true}'});
  assert.equal((await store.getRequest(id)).outcome, 'in_progress');
});

test('migration application takes an immediate write lock before reading versions', () => {
  const calls = [];
  const connection = {
    exec(sql) { calls.push(`exec:${sql}`); },
    prepare(sql) { calls.push(`prepare:${sql}`); return {all: () => [], run: () => ({changes: 1})}; }
  };
  applyMigrations({connection, migrationsDir: join(process.cwd(), 'migrations')});
  const readIndex = calls.findIndex((call) => call.includes('prepare:SELECT version'));
  const lockIndex = calls.findIndex((call) => call.includes('BEGIN IMMEDIATE'));
  assert.ok(lockIndex >= 0 && lockIndex < readIndex, calls.join('\n'));
});

test('replay responses have a separate larger bound than diagnostic fields', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = '20202020-2020-4202-8202-202020202020';
  const claim = await store.claimRequest(details(id, 'replay-fingerprint'));
  const responseJson = JSON.stringify({requestId: id, words: [{answer: 'OCEAN', clue: 'x'.repeat(20_000)}]});
  await store.finishRequest({id, leaseToken: claim.leaseToken, outcome: 'succeeded', httpStatus: 200, responseJson});
  assert.equal((await store.getRequest(id)).response_json, responseJson);
  assert.ok(responseJson.length > 16 * 1024);
});

test('SQLite store measures response limits in UTF-8 bytes', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = '30303030-3030-4303-8303-303030303030';
  const claim = await store.claimRequest(details(id, 'utf8-fingerprint'));
  await store.beginAttempt({requestId: id, attemptNumber: 1, model: 'model', requestJson: '{}', leaseToken: claim.leaseToken});
  await assert.rejects(() => store.checkpointAttemptResponse({requestId: id, attemptNumber: 1, leaseToken: claim.leaseToken, providerResponseBody: 'é'.repeat(MAX_RESPONSE_BODY), providerHttpStatus: 200}), /storage limit/);
});

test('stale recovery advances after a finalized failed attempt and classifies checkpointed non-2xx before fallback', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection, {leaseMs: 100});
  const id = '40404040-4040-4404-8404-404040404040';
  const clean = {theme: 'ocean', themeKey: 'ocean', size: 5, difficulty: 'easy', exclude: [], count: 40, promptVersion: 'crossfolk-words-v2', models: ['first/model', 'second/model']};
  const claim = await store.claimRequest({...details(id, requestFingerprint(clean), 0), configuredModelsJson: '["first/model","second/model"]'});
  await store.beginAttempt({requestId: id, attemptNumber: 1, model: 'first/model', requestJson: '{}', leaseToken: claim.leaseToken});
  const failedRaw = JSON.stringify({error: {message: 'first failed'}, usage: {prompt_tokens: 6, completion_tokens: 2, total_tokens: 8}});
  await store.checkpointAttemptResponse({requestId: id, attemptNumber: 1, leaseToken: claim.leaseToken, providerResponseBody: failedRaw, providerHttpStatus: 500, providerRequestId: 'provider-failed'});
  await store.finishAttempt({requestId: id, attemptNumber: 1, leaseToken: claim.leaseToken, outcome: 'upstream_error', errorCategory: 'upstream_error', inputTokens: 6, outputTokens: 2, totalTokens: 8});
  database.connection.prepare('UPDATE ai_generation_requests SET lease_expires_at_ms = 0 WHERE id = ?').run(id);
  const called = [];
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme: 'ocean'})}), {
    env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'first/model,second/model'}, generationStore: store,
    fetchImpl: async (url, init) => { const model = JSON.parse(init.body).model; called.push(model); return model === 'second/model' ? new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({words: [{answer: 'reef', clue: 'x'}, {answer: 'tide', clue: 'y'}, {answer: 'wave', clue: 'z'}]})}}], usage: {prompt_tokens: 3, completion_tokens: 4, total_tokens: 7}}), {status: 200}) : new Response(failedRaw, {status: 500}); }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.requestId, id);
  assert.deepEqual(called, ['second/model']);
  const row = await store.getRequest(id);
  assert.equal(row.known_total_tokens, 15);
  assert.equal(row.attempts[0].provider_http_status, 500);
  assert.equal(row.attempts[0].provider_request_id, 'provider-failed');
  assert.equal(row.attempts[0].input_tokens, 6);
  assert.equal(row.attempts[0].output_tokens, 2);
  assert.equal(row.attempts[0].total_tokens, 8);
  assert.equal(row.attempts[0].outcome, 'upstream_error');
  assert.equal(JSON.parse(row.response_json).requestId, id);
});

test('stale recovery replays a checkpoint whose attempt finalization succeeded', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = '41414141-4141-4414-8414-414141414141';
  const clean = {theme: 'ocean', themeKey: 'ocean', size: 5, difficulty: 'easy', exclude: [], count: 40, promptVersion: 'crossfolk-words-v2', models: ['only/model']};
  const claim = await store.claimRequest({...details(id, requestFingerprint(clean), 0), configuredModelsJson: '["only/model"]'});
  await store.beginAttempt({requestId: id, attemptNumber: 1, model: 'only/model', requestJson: '{}', leaseToken: claim.leaseToken});
  const raw = JSON.stringify({choices: [{message: {content: JSON.stringify({words: [{answer: 'reef', clue: 'x'}, {answer: 'tide', clue: 'y'}, {answer: 'wave', clue: 'z'}]})}}], usage: {prompt_tokens: 2, completion_tokens: 3, total_tokens: 5}});
  await store.checkpointAttemptResponse({requestId: id, attemptNumber: 1, leaseToken: claim.leaseToken, providerResponseBody: raw, providerHttpStatus: 200});
  await store.finishAttempt({requestId: id, attemptNumber: 1, leaseToken: claim.leaseToken, outcome: 'success', inputTokens: 2, outputTokens: 3, totalTokens: 5, usableWordCount: 3});
  database.connection.prepare('UPDATE ai_generation_requests SET lease_expires_at_ms = 0 WHERE id = ?').run(id);
  let calls = 0;
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme: 'ocean'})}), {env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'only/model'}, generationStore: store, fetchImpl: async () => { calls += 1; throw new Error('must recover'); }});
  assert.equal(response.status, 200);
  assert.equal(calls, 0);
  assert.equal((await store.getRequest(id)).outcome, 'succeeded');
});

test('stale recovery selects the highest-ordinal checkpoint', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = '42424242-4242-4424-8424-424242424242';
  const clean = {theme: 'ocean', themeKey: 'ocean', size: 5, difficulty: 'easy', exclude: [], count: 40, promptVersion: 'crossfolk-words-v2', models: ['first/model', 'second/model']};
  const claim = await store.claimRequest({...details(id, requestFingerprint(clean), 0), configuredModelsJson: '["first/model","second/model"]'});
  await store.beginAttempt({requestId: id, attemptNumber: 1, model: 'first/model', requestJson: '{}', leaseToken: claim.leaseToken});
  await store.checkpointAttemptResponse({requestId: id, attemptNumber: 1, leaseToken: claim.leaseToken, providerResponseBody: JSON.stringify({error: {message: 'first failed'}}), providerHttpStatus: 500});
  await store.beginAttempt({requestId: id, attemptNumber: 2, model: 'second/model', requestJson: '{}', leaseToken: claim.leaseToken});
  const raw = JSON.stringify({choices: [{message: {content: JSON.stringify({words: [{answer: 'reef', clue: 'x'}, {answer: 'tide', clue: 'y'}, {answer: 'wave', clue: 'z'}]})}}], usage: {prompt_tokens: 2, completion_tokens: 3, total_tokens: 5}});
  await store.checkpointAttemptResponse({requestId: id, attemptNumber: 2, leaseToken: claim.leaseToken, providerResponseBody: raw, providerHttpStatus: 200});
  database.connection.prepare('UPDATE ai_generation_requests SET lease_expires_at_ms = 0 WHERE id = ?').run(id);
  let calls = 0;
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme: 'ocean'})}), {env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'first/model,second/model'}, generationStore: store, fetchImpl: async () => { calls += 1; throw new Error('must recover'); }});
  assert.equal(response.status, 200);
  assert.equal(calls, 0);
  assert.equal((await store.getRequest(id)).outcome, 'succeeded');
});

test('known request totals sum reported fields while remaining incomplete for missing usage', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = '50505050-5050-4505-8505-505050505050';
  let call = 0;
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme: 'ocean'})}), {
    env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'first/model,second/model'}, generationStore: store,
    fetchImpl: async () => { call += 1; return call === 1 ? new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({words: [{answer: 'one', clue: 'one'}]})}}], usage: {prompt_tokens: 7}}), {status: 200}) : new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({words: [{answer: 'reef', clue: 'x'}, {answer: 'tide', clue: 'y'}, {answer: 'wave', clue: 'z'}]})}}], usage: {prompt_tokens: 3, completion_tokens: 4, total_tokens: 7}}), {status: 200}); }
  });
  assert.equal(response.status, 200);
  const row = await store.getRequest(id);
  assert.equal(row.known_input_tokens, 10);
  assert.equal(row.known_output_tokens, 4);
  assert.equal(row.known_total_tokens, 7);
  assert.equal(row.usage_complete, 0);
});

test('D1 mutation predicates include the current lease token', async () => {
  const calls = [];
  const database = {prepare(sql) { calls.push(sql); return {bind() { return this; }, async run() { return {meta: {changes: 1}}; }, async first() { return {id: 'id', lease_token: 'lease', outcome: 'in_progress', attempts: []}; }, async all() { return {results: []}; }}; }};
  const store = new D1GenerationStore(database);
  await store.checkpointAttemptResponse({requestId: 'id', attemptNumber: 1, leaseToken: 'lease', providerResponseBody: '{}'});
  await store.finishAttempt({requestId: 'id', attemptNumber: 1, leaseToken: 'lease', outcome: 'success'});
  await store.finishRequest({id: 'id', leaseToken: 'lease', outcome: 'succeeded'});
  assert.ok(calls.filter((sql) => /UPDATE ai_generation_(attempts|requests)/.test(sql)).every((sql) => sql.includes('lease_token')));
});

test('D1 correctness-critical writes retry transient failures a bounded number of times', async () => {
  let failures = 0;
  const database = {prepare(sql) { return {bind() { return this; }, async run() { if (failures++ < 2) throw new Error('busy'); return {meta: {changes: 1}}; }, async first() { return {lease_token: 'lease'}; }, async all() { return {results: []}; }}; }};
  const store = new D1GenerationStore(database);
  await store.checkpointAttemptResponse({requestId: 'id', attemptNumber: 1, leaseToken: 'lease', providerResponseBody: '{}'});
  assert.equal(failures, 3);
});

test('D1 lease reclamation records its recovery transition atomically', async () => {
  const calls = [];
  let reads = 0;
  const expired = {id: 'd1-id', request_fingerprint: 'fp', outcome: 'in_progress', lease_expires_at_ms: 0, lease_token: 'old', attempts: []};
  const database = {
    prepare(sql) {
      calls.push(sql);
      return {
        bind() { return this; },
        async run() { return {meta: {changes: calls.at(-1).includes('recovery_count') ? 1 : 0}}; },
        async first() { reads += 1; return reads === 1 ? expired : {...expired, lease_token: 'new', recovery_count: 1}; },
        async all() { return {results: []}; }
      };
    }
  };
  const store = new D1GenerationStore(database);
  const result = await store.claimRequest({id: 'd1-id', requestFingerprint: 'fp', requestJson: '{}', configuredModelsJson: '[]'});
  assert.equal(result.reclaimed, true);
  const reclaimSql = calls.find((sql) => sql.includes('UPDATE ai_generation_requests'));
  assert.match(reclaimSql, /recovery_count\s*=\s*recovery_count\s*\+\s*1/);
  assert.match(reclaimSql, /last_reclaimed_at_ms/);
});

test('post-checkpoint finalization failures are correlated in logs', async () => {
  const messages = [];
  const id = '60606060-6060-4606-8606-606060606060';
  const store = {
    async claimRequest(details) { return {created: true, acquired: true, leaseToken: 'lease', request: {id: details.id, attempts: [], started_at_ms: details.startedAtMs}}; },
    async beginAttempt() { return {acquired: true}; },
    async checkpointAttemptResponse() {},
    async finishAttempt() { throw new Error('diagnostic database unavailable'); },
    async getRequest() { return {attempts: []}; },
    async finishRequest() {}
  };
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme: 'ocean'})}), {
    env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'only/model'}, generationStore: store,
    logger: {info() {}, warn() {}, error(...args) { messages.push(args.join(' ')); }},
    fetchImpl: async () => new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({words: [{answer: 'reef', clue: 'x'}, {answer: 'tide', clue: 'y'}, {answer: 'wave', clue: 'z'}]})}}]}), {status: 200})
  });
  assert.equal(response.status, 200);
  assert.ok(messages.some((message) => message.includes(id) && message.includes('finalize')));
});

test('recovered success source usage aggregates earlier finalized attempts', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = '70707070-7070-4707-8707-707070707070';
  const clean = {theme: 'ocean', themeKey: 'ocean', size: 5, difficulty: 'easy', exclude: [], count: 40, promptVersion: 'crossfolk-words-v2', models: ['first/model', 'second/model']};
  const claim = await store.claimRequest({...details(id, requestFingerprint(clean), 0), configuredModelsJson: '["first/model","second/model"]'});
  await store.beginAttempt({requestId: id, attemptNumber: 1, model: 'first/model', requestJson: '{}', leaseToken: claim.leaseToken});
  await store.finishAttempt({requestId: id, attemptNumber: 1, model: 'first/model', leaseToken: claim.leaseToken, outcome: 'network_error', inputTokens: 5, outputTokens: 6, totalTokens: 11});
  await store.beginAttempt({requestId: id, attemptNumber: 2, model: 'second/model', requestJson: '{}', leaseToken: claim.leaseToken});
  const raw = JSON.stringify({choices: [{message: {content: JSON.stringify({words: [{answer: 'reef', clue: 'x'}, {answer: 'tide', clue: 'y'}, {answer: 'wave', clue: 'z'}]})}}], usage: {prompt_tokens: 2, completion_tokens: 3, total_tokens: 5}});
  await store.checkpointAttemptResponse({requestId: id, attemptNumber: 2, leaseToken: claim.leaseToken, providerResponseBody: raw, providerHttpStatus: 200});
  database.connection.prepare('UPDATE ai_generation_requests SET lease_expires_at_ms = 0 WHERE id = ?').run(id);
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme: 'ocean'})}), {env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'first/model,second/model'}, generationStore: store, fetchImpl: async () => { throw new Error('must recover'); }});
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).source.usage, {input: 7, output: 9, total: 16});
  assert.deepEqual(JSON.parse((await store.getRequest(id)).response_json).source.usage, {input: 7, output: 9, total: 16});
});

test('exhausted recovery finalizes a terminal failure without dereferencing a missing model', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = '80808080-8080-4808-8808-808080808080';
  const clean = {theme: 'ocean', themeKey: 'ocean', size: 5, difficulty: 'easy', exclude: [], count: 40, promptVersion: 'crossfolk-words-v2', models: ['only/model']};
  const claim = await store.claimRequest({...details(id, requestFingerprint(clean), 0), configuredModelsJson: '["only/model"]'});
  await store.beginAttempt({requestId: id, attemptNumber: 1, model: 'only/model', requestJson: '{}', leaseToken: claim.leaseToken});
  await store.finishAttempt({requestId: id, attemptNumber: 1, leaseToken: claim.leaseToken, outcome: 'network_error', errorCategory: 'network_error', errorMessage: 'offline', inputTokens: 4, outputTokens: 2, totalTokens: 6});
  database.connection.prepare('UPDATE ai_generation_requests SET lease_expires_at_ms = 0 WHERE id = ?').run(id);
  let calls = 0;
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme: 'ocean'})}), {env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'only/model'}, generationStore: store, fetchImpl: async () => { calls += 1; throw new Error('must not call'); }});
  assert.equal(response.status, 502);
  assert.equal(calls, 0);
  assert.match((await response.json()).error, /all configured models/i);
  assert.equal((await store.getRequest(id)).outcome, 'failed');
});

test('readUsage keeps null and empty token fields unknown', () => {
  assert.deepEqual(readUsage({usage: {prompt_tokens: null, completion_tokens: '', total_tokens: null}}), {input: null, output: null, total: null});
  assert.deepEqual(readUsage({usage: {prompt_tokens: 3, completion_tokens: 4, total_tokens: ''}}), {input: 3, output: 4, total: null});
});

test('provider body fallback enforces UTF-8 byte limits', async () => {
  await assert.rejects(() => readCappedProviderBody({body: null, text: async () => 'é'.repeat(MAX_PROVIDER_RESPONSE_BODY)}), /too large/);
});

test('Worker fails closed when the application D1 binding is missing', async () => {
  const response = await worker.fetch(new Request('https://crossfolk.example/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: '90909090-9090-4909-8909-909090909090', theme: 'ocean'})}), {OPENROUTER_API_KEY: 'test'});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).retryable, true);
});

test('local API routing matches Worker pathname handling', () => {
  assert.equal(isWordsPath('/api/words?retry=1'), true);
  assert.equal(isWordsPath('/api/words-extra?retry=1'), false);
});

test('oversized invalid exclude input still creates a bounded invalid request row', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const input = {requestId: id, theme: 'ocean', exclude: Array.from({length: 500}, () => 'x'.repeat(32))};
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input)}), {env: {OPENROUTER_API_KEY: 'test'}, generationStore: store});
  assert.equal(response.status, 400);
  const row = await store.getRequest(id);
  assert.equal(row.outcome, 'invalid');
  assert.equal(row.exclude_count, 500);
});

test('oversized invalid scalar diagnostics still create an invalid request row', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = 'abababab-abab-4aba-8aba-abababababab';
  const difficulty = 'invalid-' + 'x'.repeat(30_000);
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme: 'ocean', difficulty})}), {env: {OPENROUTER_API_KEY: 'test'}, generationStore: store});
  assert.equal(response.status, 400);
  const row = await store.getRequest(id);
  assert.equal(row.outcome, 'invalid');
  assert.ok(new TextEncoder().encode(row.request_json).byteLength < 16 * 1024);
  assert.match((await response.json()).error, /Difficulty/);
});

test('oversized invalid themes retain a bounded audit row and validation result', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd';
  const theme = 'theme-' + 'x'.repeat(30_000);
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme})}), {env: {OPENROUTER_API_KEY: 'test'}, generationStore: store});
  assert.equal(response.status, 400);
  const row = await store.getRequest(id);
  assert.equal(row.outcome, 'invalid');
  assert.ok(new TextEncoder().encode(row.request_json).byteLength < 16 * 1024);
  assert.match((await response.json()).error, /160/);
});

test('provider diagnostics are bounded and cannot strand the request', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const huge = 'provider detail '.repeat(2_000);
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme: 'ocean'})}), {env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'only/model'}, generationStore: store, fetchImpl: async () => new Response(JSON.stringify({error: {message: huge}, usage: {prompt_tokens: 1, completion_tokens: 2, total_tokens: 3}}), {status: 500, headers: {'x-request-id': huge}})});
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.ok(body.error.length < 16 * 1024);
  const row = await store.getRequest(id);
  assert.equal(row.outcome, 'failed');
  assert.ok(row.error_message.length < 16 * 1024);
  assert.ok(row.attempts[0].provider_request_id.length < 16 * 1024);
});

test('lease reclamation is durably counted', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const first = await store.claimRequest(details(id, 'reclaim-fingerprint'));
  database.connection.prepare('UPDATE ai_generation_requests SET lease_expires_at_ms = 0 WHERE id = ?').run(id);
  const second = await store.claimRequest(details(id, 'reclaim-fingerprint'));
  assert.equal(second.reclaimed, true);
  const row = await store.getRequest(id);
  assert.equal(row.recovery_count, 1);
  assert.ok(row.last_reclaimed_at_ms >= row.started_at_ms);
  assert.notEqual(first.leaseToken, second.leaseToken);
});

test('request failure retains the stable final attempt category', async (t) => {
  const database = await tempDatabase(t);
  const store = new SqliteGenerationStore(database.connection);
  const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const response = await handleWords(new Request('http://localhost/api/words', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId: id, theme: 'ocean'})}), {env: {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'only/model'}, generationStore: store, fetchImpl: async () => new Response('upstream down', {status: 500})});
  assert.equal(response.status, 502);
  assert.equal((await store.getRequest(id)).error_category, 'upstream_error');
});
