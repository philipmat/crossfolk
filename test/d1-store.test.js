import test from 'node:test';
import assert from 'node:assert/strict';
import {D1GenerationStore} from '../worker/d1-generation-store.js';

class FakeD1 {
  constructor() { this.calls = []; this.request = null; }
  prepare(sql) {
    const database = this;
    return {
      bind(...values) { database.calls.push({sql, values}); return this; },
      async run() {
        if (/INSERT OR IGNORE INTO ai_generation_requests/.test(sql)) { database.request = {id: database.calls.at(-1).values[0], outcome: 'in_progress', lease_token: database.calls.at(-1).values.at(-2), attempts: []}; return {meta: {changes: 1}}; }
        return {meta: {changes: 1}};
      },
      async first() {
        if (/lease_token FROM ai_generation_requests/.test(sql)) return {lease_token: database.request?.lease_token};
        if (/ai_generation_requests/.test(sql)) return database.request;
        return {request_id: database.request?.id, attempt_number: 1};
      },
      async all() { return {results: []}; }
    };
  }
}

test('D1 generation store uses bound values and never stores requester IP metadata', async () => {
  const database = new FakeD1();
  const store = new D1GenerationStore(database, {requesterKey: 'hmac-value'});
  const id = '77777777-7777-4777-8777-777777777777';
  const claim = await store.claimRequest({id, startedAtMs: 1, theme: 'ocean', themeKey: 'ocean', size: 5, difficulty: 'easy', excludeCount: 0,
    requestJson: '{"theme":"ocean"}', requestFingerprint: 'fingerprint', promptVersion: 'v1', configuredModelsJson: '["m"]'});
  assert.equal(claim.created, true);
  const requestCall = database.calls.find((call) => call.sql.includes('INSERT OR IGNORE INTO ai_generation_requests'));
  assert.ok(requestCall);
  assert.ok(requestCall.values.includes('hmac-value'));
  assert.ok(!requestCall.values.includes('203.0.113.9'));
  const attempt = await store.beginAttempt({requestId: id, attemptNumber: 1, model: 'm', requestJson: '{}', leaseToken: claim.leaseToken});
  assert.equal(attempt.acquired, true);
  await store.checkpointAttemptResponse({requestId: id, attemptNumber: 1, providerResponseBody: '{"safe":true}', providerHttpStatus: 200});
  assert.ok(database.calls.every(({values}) => values.every((value) => value !== 'OPENROUTER_API_KEY')));
});
