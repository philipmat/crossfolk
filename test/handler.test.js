import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateWords, validateOptions} from '../server/words.js';
import {handleWords} from '../server/handler.js';
import server, {PUBLIC_FILES} from '../server/index.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const WORDS_URL = 'http://localhost/api/words';

function post(body, {headers = {}, ...init} = {}) {
  return new Request(WORDS_URL, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init
  });
}

function aiResponse(words) {
  return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({words})}}]}), {
    status: 200,
    headers: {'content-type': 'application/json'}
  });
}

const neverFetch = async () => {
  throw new Error('the AI should not have been called');
};

test('rejects non-POST requests', async () => {
  const response = await handleWords(new Request(WORDS_URL), {env: {OPENROUTER_API_KEY: 'test'}});
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), {error: 'Method not allowed.'});
});

test('rejects oversized bodies before parsing them', async () => {
  const response = await handleWords(post({theme: 'ocean'}, {headers: {'content-length': String(40_000)}}), {env: {OPENROUTER_API_KEY: 'test'}});
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {error: 'Request body is too large.'});
});

test('rejects malformed JSON as a bad request', async () => {
  const response = await handleWords(post('{"theme":'), {env: {OPENROUTER_API_KEY: 'test'}});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {error: 'Invalid request.'});
});

test('applies an injected rate limit before parsing the request', async () => {
  const seen = [];
  const rateLimit = async (request) => {
    seen.push(request.headers.get('content-type'));
    return false;
  };
  const response = await handleWords(post('{"theme":'), {env: {OPENROUTER_API_KEY: 'test'}, rateLimit});
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {error: 'Too many puzzles. Try again shortly.'});
  assert.deepEqual(seen, ['application/json']);
});

test('reports 503 when AI generation is unconfigured', async () => {
  const {status, body} = await generateWords({theme: 'ocean'}, {}, {fetchImpl: neverFetch});
  assert.equal(status, 503);
  assert.deepEqual(body, {error: 'AI theme generation is not configured.'});
});

test('rejects each invalid option before calling the AI', async () => {
  const cases = [
    [{}, 'A theme is required.'],
    [{theme: '   '}, 'A theme is required.'],
    [{theme: 'x'.repeat(161)}, 'Theme must be 160 characters or fewer.'],
    [{theme: 'ocean', difficulty: 'impossible'}, 'Difficulty must be easy, medium, or hard.'],
    [{theme: 'ocean', size: 7}, 'Size must be small (5), medium (9), or large (13).'],
    [{theme: 'ocean', exclude: 'REEF'}, 'Exclude must be an array of at most 100 short answer strings.'],
    [{theme: 'ocean', exclude: Array.from({length: 101}, (_, index) => `word${index}`)}, 'Exclude must be an array of at most 100 short answer strings.'],
    [{theme: 'ocean', exclude: ['x'.repeat(33)]}, 'Exclude must be an array of at most 100 short answer strings.']
  ];
  for (const [input, message] of cases) {
    const {status, body} = await generateWords(input, {OPENROUTER_API_KEY: 'test'}, {fetchImpl: neverFetch});
    assert.equal(status, 400, JSON.stringify(input));
    assert.equal(body.error, message);
  }
  assert.equal(validateOptions({theme: 'ocean', size: 'medium'}).count, 90);
  assert.equal(validateOptions({theme: 'ocean', size: 5}).count, 60);
});

test('falls back to the next model when one fails', async () => {
  const called = [];
  const fetchImpl = async (url, {body}) => {
    const {model} = JSON.parse(body);
    called.push(model);
    if (called.length === 1) return new Response('upstream is down', {status: 500});
    return aiResponse([{answer: 'reef', clue: 'Coral ridge'}, {answer: 'tide', clue: 'Ocean rise'}, {answer: 'wave', clue: 'Ocean motion'}]);
  };
  const {status, body} = await generateWords({theme: 'ocean'}, {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'first/model,second/model'}, {fetchImpl});
  assert.equal(status, 200);
  assert.deepEqual(body.words, [{answer: 'REEF', clue: 'Coral ridge'}, {answer: 'TIDE', clue: 'Ocean rise'}, {answer: 'WAVE', clue: 'Ocean motion'}]);
  assert.deepEqual(called, ['first/model', 'second/model']);
});

test('reports the failure when every model fails', async () => {
  const fetchImpl = async () => {
    throw new Error('offline');
  };
  const {status, body} = await generateWords({theme: 'ocean'}, {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'only/model'}, {fetchImpl});
  assert.equal(status, 502);
  assert.equal(body.error, 'Could not reach theme generation.');
});

test('reports 500 instead of crashing when the AI response is malformed in an unexpected way', async () => {
  const fetchImpl = async () => aiResponse([null]);
  const response = await handleWords(post({theme: 'ocean'}), {env: {OPENROUTER_API_KEY: 'test'}, fetchImpl});
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {error: 'Something went wrong generating words.'});
});

test('normalises answers and drops unusable ones', async () => {
  const fetchImpl = async () => aiResponse([
    {answer: 'Reef!', clue: 'Coral ridge'},
    {answer: ' coral-reef ', clue: 'Too long for a mini'},
    {answer: 'tIde', clue: 'Ocean rise'},
    {answer: 'a', clue: 'Too short'},
    {answer: 'wav3', clue: 'Ocean motion'}
  ]);
  const {status, body} = await generateWords({theme: 'ocean', size: 5}, {OPENROUTER_API_KEY: 'test'}, {fetchImpl});
  assert.equal(status, 200);
  assert.deepEqual(body.words, [{answer: 'REEF', clue: 'Coral ridge'}, {answer: 'TIDE', clue: 'Ocean rise'}, {answer: 'WAV', clue: 'Ocean motion'}]);
});

test('public/ holds exactly the allowlisted files', async () => {
  const present = (await readdir(resolve(ROOT, 'public'))).filter((name) => name !== '.DS_Store');
  assert.deepEqual([...present].sort(), [...PUBLIC_FILES].sort());
});

test('the local server bridges /api/words through the same handler', async (t) => {
  const savedKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  t.after(() => {
    if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
  });

  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const unconfigured = await fetch(`${base}/api/words`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({theme: 'an obscure theme', size: 5, difficulty: 'easy', exclude: []})
  });
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await unconfigured.json(), {error: 'AI theme generation is not configured.'});

  // Only `POST /api/words` is routed; other methods fall through to static serving.
  const wrongMethod = await fetch(`${base}/api/words`);
  assert.equal(wrongMethod.status, 404);

  const malformed = await fetch(`${base}/api/words`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{"theme":'});
  assert.equal(malformed.status, 400);

  const oversized = await fetch(`${base}/api/words`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({theme: 'x'.repeat(40_000)})
  });
  assert.equal(oversized.status, 413);

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /^text\/html/);

  const dictionary = await fetch(`${base}/wordnet-words.js`);
  assert.equal(dictionary.status, 200);

  const privatePath = await fetch(`${base}/server/index.js`);
  assert.equal(privatePath.status, 404);
});
