import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWords, MAX_GENERATION_TIMEOUT_MS, MAX_MODEL_TIMEOUT_MS, validateOptions} from '../../server/words.js';
import {handleWords} from '../../server/handler.js';

const WORDS_URL = 'http://localhost/api/words';

function post(body, {headers = {}, ...init} = {}) {
  return new Request(WORDS_URL, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init
  });
}

function aiResponse(words, usage) {
  return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({words})}}], ...(usage ? {usage} : {})}), {
    status: 200,
    headers: {'content-type': 'application/json'}
  });
}

const neverFetch = async () => {
  throw new Error('the AI should not have been called');
};

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
  // Medium moved from 60 to 72 when the Free-form bank profile took over the requested
  // count (see server/words.js WORD_PROFILES['freeform-bank'].sizes[9]).
  assert.equal(validateOptions({theme: 'ocean', size: 'medium'}).count, 72);
  assert.equal(validateOptions({theme: 'ocean', size: 5}).count, 40);
});

test('identifies Crossfolk to OpenRouter and sends its configured URL', async () => {
  let seenHeaders;
  const fetchImpl = async (url, init) => {
    seenHeaders = init.headers;
    return aiResponse([{answer: 'reef', clue: 'Coral ridge'}, {answer: 'tide', clue: 'Ocean rise'}, {answer: 'wave', clue: 'Ocean motion'}]);
  };

  await generateWords({theme: 'ocean'}, {OPENROUTER_API_KEY: 'test'}, {fetchImpl});
  assert.equal('http-referer' in seenHeaders, false);
  assert.equal(seenHeaders['x-openrouter-title'], 'Crossfolk');
  assert.equal(new Headers(seenHeaders).get('x-openrouter-title'), 'Crossfolk');

  await generateWords({theme: 'ocean'}, {OPENROUTER_API_KEY: 'test', OPENROUTER_SITE_URL: 'https://crossfolk.example'}, {fetchImpl});
  assert.equal(seenHeaders['http-referer'], 'https://crossfolk.example');
  assert.equal(new Headers(seenHeaders).get('http-referer'), 'https://crossfolk.example');
  assert.equal(seenHeaders['x-openrouter-title'], 'Crossfolk');
});

test('gives the preferred model a full attempt instead of splitting the budget across fallbacks', async () => {
  const called = [];
  const fetchImpl = async (url, {body, signal}) => {
    called.push(JSON.parse(body).model);
    return new Promise((resolve, reject) => {
      const response = setTimeout(() => resolve(aiResponse([
        {answer: 'reef', clue: 'Coral ridge'}, {answer: 'tide', clue: 'Ocean rise'}, {answer: 'wave', clue: 'Ocean motion'}
      ])), 24);
      signal.addEventListener('abort', () => {
        clearTimeout(response);
        reject(new DOMException('Aborted', 'AbortError'));
      }, {once: true});
    });
  };

  const {status} = await generateWords(
    {theme: 'ocean'},
    {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'first/model,second/model,third/model'},
    {fetchImpl, timeoutMs: 50}
  );

  assert.equal(status, 200);
  assert.deepEqual(called, ['first/model']);
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

test('falls back after a model timeout within the shared generation budget', async () => {
  const called = [];
  let firstSignal;
  const fetchImpl = async (url, {body, signal}) => {
    const {model} = JSON.parse(body);
    called.push(model);
    if (model === 'first/model') {
      firstSignal = signal;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      }, {once: true}));
    }
    return aiResponse([{answer: 'reef', clue: 'Coral ridge'}, {answer: 'tide', clue: 'Ocean rise'}, {answer: 'wave', clue: 'Ocean motion'}]);
  };

  const {status, body} = await generateWords(
    {theme: 'ocean'},
    {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'first/model,second/model'},
    {fetchImpl, timeoutMs: 50, maxModelTimeoutMs: 20}
  );

  assert.equal(status, 200);
  assert.equal(firstSignal.aborted, true);
  assert.deepEqual(called, ['first/model', 'second/model']);
  assert.equal(MAX_GENERATION_TIMEOUT_MS, 120_000);
  assert.equal(MAX_MODEL_TIMEOUT_MS, 60_000);
  assert.equal(body.words.length, 3);
});

test('stops provider retries when the caller disconnects', async () => {
  const caller = new AbortController();
  const called = [];
  let providerSignal;
  const fetchImpl = async (url, {body, signal}) => {
    called.push(JSON.parse(body).model);
    providerSignal = signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once: true});
      caller.abort();
    });
  };

  const {status, body} = await generateWords(
    {theme: 'ocean'},
    {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'first/model,second/model'},
    {fetchImpl, signal: caller.signal}
  );

  assert.equal(status, 504);
  assert.equal(body.error, 'Theme generation timed out.');
  assert.equal(providerSignal.aborted, true);
  assert.deepEqual(called, ['first/model']);
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

test('reports which model answered and the tokens the call used', async () => {
  const fetchImpl = async () => aiResponse(
    [{answer: 'reef', clue: 'Coral ridge'}, {answer: 'tide', clue: 'Ocean rise'}, {answer: 'wave', clue: 'Ocean motion'}],
    {prompt_tokens: 412, completion_tokens: 128, total_tokens: 540}
  );
  const {status, body} = await generateWords({theme: 'ocean'}, {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'only/model'}, {fetchImpl});
  assert.equal(status, 200);
  assert.deepEqual(body.source, {model: 'only/model', usage: {input: 412, output: 128, total: 540}});
});

test('counts the tokens burned by an attempt it had to discard', async () => {
  const fetchImpl = async (url, {body}) => {
    const {model} = JSON.parse(body);
    if (model === 'first/model') {
      return aiResponse([{answer: 'one', clue: 'Too few entries to use'}], {prompt_tokens: 300, completion_tokens: 40, total_tokens: 340});
    }
    return aiResponse(
      [{answer: 'reef', clue: 'Coral ridge'}, {answer: 'tide', clue: 'Ocean rise'}, {answer: 'wave', clue: 'Ocean motion'}],
      {prompt_tokens: 100, completion_tokens: 60, total_tokens: 160}
    );
  };
  const {status, body} = await generateWords({theme: 'ocean'}, {OPENROUTER_API_KEY: 'test', OPENROUTER_MODELS: 'first/model,second/model'}, {fetchImpl});
  assert.equal(status, 200);
  assert.deepEqual(body.source, {model: 'second/model', usage: {input: 400, output: 100, total: 500}});
});
