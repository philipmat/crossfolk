import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROMPT_VERSION,
  WORD_PROFILES,
  WORD_PROFILE_VERSION,
  generateWords,
  parseStoredProviderResponse,
  validateOptions,
} from '../../server/words.js';
import {handleWords, requestFingerprint} from '../../server/handler.js';
import {themeSlotSignatures} from '../../public/layouts/american-patterns.js';

function aiResponse(words) {
  return new Response(JSON.stringify({
    choices: [{message: {content: JSON.stringify({words})}}],
    usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20},
  }), {status: 200, headers: {'content-type': 'application/json'}});
}

function anchors(count, length) {
  return Array.from({length: count}, (_, index) => ({
    answer: `${'A'.repeat(length - 2)}${String.fromCharCode(66 + Math.floor(index / 26))}${String.fromCharCode(67 + (index % 26))}`,
    clue: `Anchor ${index}`,
  }));
}

test('an omitted word profile is the legacy Free-form bank', () => {
  const options = validateOptions({theme: 'ocean', size: 9, difficulty: 'easy'});
  assert.equal(options.wordProfile, 'freeform-bank');
  assert.equal(typeof options.count, 'number');
});

test('an unknown word profile is refused before any provider call', async () => {
  let calls = 0;
  const fetchImpl = () => { calls += 1; return aiResponse([]); };
  const {status, body} = await generateWords(
    {theme: 'ocean', size: 9, difficulty: 'easy', wordProfile: 'creative-shape-bank'},
    {OPENROUTER_API_KEY: 'test'},
    {fetchImpl}
  );

  assert.equal(status, 400);
  assert.match(body.error, /profile/i);
  assert.equal(calls, 0);
});

test('American anchors are invalid at the sizes their generator does not support', async () => {
  for (const size of [5, 13]) {
    let calls = 0;
    const fetchImpl = () => { calls += 1; return aiResponse([]); };
    const {status} = await generateWords(
      {theme: 'ocean', size, difficulty: 'easy', wordProfile: 'american-anchors'},
      {OPENROUTER_API_KEY: 'test'},
      {fetchImpl}
    );

    assert.equal(status, 400, `size ${size} should be refused`);
    assert.equal(calls, 0, `size ${size} should not reach the provider`);
  }
});

test('each profile and size maps to server-owned counts the client cannot influence', () => {
  assert.equal(typeof WORD_PROFILE_VERSION, 'string');

  for (const [profile, sizes] of Object.entries(WORD_PROFILES)) {
    for (const [size, limits] of Object.entries(sizes.sizes)) {
      assert.ok(limits.requested > 0, `${profile}/${size} requested`);
      assert.ok(limits.minimumUsable > 0, `${profile}/${size} minimumUsable`);
      assert.ok(limits.minItems > 0 && limits.minItems <= limits.requested, `${profile}/${size} minItems`);
    }
  }

  assert.ok(WORD_PROFILES['american-anchors'].sizes[9]);
  assert.equal(WORD_PROFILES['american-anchors'].sizes[5], undefined);
  assert.equal(WORD_PROFILES['american-anchors'].sizes[13], undefined);

  // A client-supplied count is ignored: the server maps the validated profile and size.
  const options = validateOptions({theme: 'ocean', size: 9, difficulty: 'easy', wordProfile: 'american-anchors', count: 999});
  assert.equal(options.count, WORD_PROFILES['american-anchors'].sizes[9].requested);
});

test('the server-owned theme-slot signatures match the admitted catalog', () => {
  assert.deepEqual(WORD_PROFILES['american-anchors'].themeSlotSignatures, themeSlotSignatures(9));
});

test('American normalization drops short answers and duplicates before counting', async () => {
  const words = [
    ...anchors(26, 6),
    {answer: 'IT', clue: 'Too short for American'},
    {answer: 'AAAABC', clue: 'Duplicate of the first anchor'},
  ];
  const fetchImpl = () => aiResponse(words);
  const {status, body} = await generateWords(
    {theme: 'ocean', size: 9, difficulty: 'easy', wordProfile: 'american-anchors'},
    {OPENROUTER_API_KEY: 'test'},
    {fetchImpl}
  );

  assert.equal(status, 200);
  assert.ok(body.words.every(({answer}) => answer.length >= 3), 'a two-letter answer survived');
  assert.equal(new Set(body.words.map(({answer}) => answer)).size, body.words.length);
});

test('Free form keeps its existing two-letter acceptance until that change is approved', async () => {
  const fetchImpl = () => aiResponse([
    {answer: 'go', clue: 'Depart'},
    {answer: 'reef', clue: 'Coral ridge'},
    {answer: 'tide', clue: 'Ocean rise'},
  ]);
  const {status, body} = await generateWords(
    {theme: 'ocean', size: 9, difficulty: 'easy', wordProfile: 'freeform-bank'},
    {OPENROUTER_API_KEY: 'test'},
    {fetchImpl}
  );

  assert.equal(status, 200);
  assert.ok(body.words.some(({answer}) => answer === 'GO'));
});

test('an anchor pool that matches no catalog signature is rejected', async () => {
  // Plenty of answers, but only one at any single admitted theme-slot length, so no
  // rotational pair is possible. An aggregate pair count would wrongly accept this.
  const words = [
    ...anchors(1, 5),
    ...anchors(1, 6),
    ...anchors(1, 7),
    ...anchors(24, 4),
  ];
  const fetchImpl = () => aiResponse(words);
  const {status, body} = await generateWords(
    {theme: 'ocean', size: 9, difficulty: 'easy', wordProfile: 'american-anchors'},
    {OPENROUTER_API_KEY: 'test'},
    {fetchImpl}
  );

  assert.equal(status, 502);
  assert.match(body.error, /theme/i);
});

test('the prompt version and profile take part in the request fingerprint', () => {
  assert.equal(PROMPT_VERSION, 'crossfolk-words-v3-style-profiles');

  const base = {theme: 'ocean', themeKey: 'ocean', size: 9, difficulty: 'easy', exclude: [], count: 36, promptVersion: PROMPT_VERSION, models: ['a']};
  const american = requestFingerprint({...base, wordProfile: 'american-anchors', wordProfileVersion: WORD_PROFILE_VERSION});
  const freeform = requestFingerprint({...base, wordProfile: 'freeform-bank', wordProfileVersion: WORD_PROFILE_VERSION});

  assert.notEqual(american, freeform);
});

test('reusing one request id with a different profile is a conflict', async () => {
  const seen = new Map();
  const store = {
    async claimRequest(record) {
      const prior = seen.get(record.id);
      if (prior && prior !== record.requestFingerprint) return {conflict: true};
      seen.set(record.id, record.requestFingerprint);
      return {status: 'claimed', leaseToken: 'lease'};
    },
    async beginAttempt() { return {acquired: true}; },
    async checkpointAttemptResponse() {},
    async finishAttempt() {},
    async loadRequest() { return null; },
  };

  const post = (wordProfile) => handleWords(new Request('http://localhost/api/words', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({theme: 'ocean', size: 9, difficulty: 'easy', wordProfile, requestId: '11111111-1111-4111-8111-111111111111'}),
  }), {env: {OPENROUTER_API_KEY: 'test'}, generationStore: store, fetchImpl: () => aiResponse(anchors(24, 6))});

  await post('freeform-bank');
  const second = await post('american-anchors');
  assert.equal(second.status, 409);
});

test('a stored response replays under the profile it was produced with', () => {
  const stored = JSON.stringify({
    choices: [{message: {content: JSON.stringify({words: [{answer: 'go', clue: 'Depart'}, {answer: 'reef', clue: 'Ridge'}, {answer: 'tide', clue: 'Rise'}]})}}],
  });

  // A row written before profiles existed keeps the legacy contract, so an old checkpoint
  // stays recoverable instead of failing the new American thresholds.
  const legacy = parseStoredProviderResponse(stored, 9);
  assert.ok(legacy.words.some(({answer}) => answer === 'GO'));

  const freeform = parseStoredProviderResponse(stored, 9, 200, {wordProfile: 'freeform-bank'});
  assert.ok(freeform.words.some(({answer}) => answer === 'GO'));

  assert.throws(() => parseStoredProviderResponse(stored, 9, 200, {wordProfile: 'american-anchors'}));
});
