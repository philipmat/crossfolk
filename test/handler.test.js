import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleWords} from '../server/handler.js';
import server, {PUBLIC_FILES} from '../server/index.js';
import {createLogger} from '../server/logger.js';

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

test('logger includes an ISO timestamp and level', () => {
  const messages = [];
  const logger = createLogger({log: (...args) => messages.push(args)}, () => new Date('2026-09-10T12:34:56.789Z'));

  logger.info('Theme generation started');
  logger.warn('Model response was slow');
  logger.error('Theme generation failed');

  assert.deepEqual(messages, [
    ['2026-09-10T12:34:56.789Z [INFO]', 'Theme generation started'],
    ['2026-09-10T12:34:56.789Z [WARN]', 'Model response was slow'],
    ['2026-09-10T12:34:56.789Z [ERROR]', 'Theme generation failed']
  ]);
});

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

test('rejects an oversized body even without a truthful Content-Length header', async () => {
  const oversized = post({theme: 'x'.repeat(40_000)});
  oversized.headers.delete('content-length');
  const response = await handleWords(oversized, {env: {OPENROUTER_API_KEY: 'test'}});
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

// A flat listing would report `layouts` as a bare directory name while the allowlist
// carries nested paths, so the comparison has to walk the tree and drop directories.
test('public/ holds exactly the allowlisted files, including nested ones', async () => {
  const entries = await readdir(resolve(ROOT, 'public'), {recursive: true, withFileTypes: true});
  const present = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(resolve(ROOT, 'public'), resolve(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((name) => !name.endsWith('.DS_Store'));

  assert.deepEqual(present.sort(), [...PUBLIC_FILES].sort());
  assert.ok([...PUBLIC_FILES].some((name) => name.includes('/')), 'expected at least one nested allowlist entry');
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

  const status = await fetch(`${base}/api/generation-status`);
  assert.equal(status.status, 200);
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await status.json(), {enabled: true});

  const nested = await fetch(`${base}/layouts/mask-analysis.js`);
  assert.equal(nested.status, 200);
  assert.equal(nested.headers.get('content-type'), 'text/javascript; charset=utf-8');

  const traversal = await fetch(`${base}/layouts/../../server/words.js`);
  assert.equal(traversal.status, 404);

  const unconfigured = await fetch(`${base}/api/words`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({theme: 'an obscure theme', size: 5, difficulty: 'easy', exclude: []})
  });
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await unconfigured.json(), {error: 'AI theme generation is not configured.'});

  // /api/words is routed regardless of method, matching the Worker adapter.
  const wrongMethod = await fetch(`${base}/api/words`);
  assert.equal(wrongMethod.status, 405);

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
