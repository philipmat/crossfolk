import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};
const PUBLIC_FILES = new Set(['index.html', 'app.js', 'engine.js', 'style.css', 'dense.js', 'fill-words.js', 'puzzle-worker.js', 'theme-fill.js', 'wordnet-words.js', 'WORDNET-LICENSE.txt', 'mini-patterns.js', 'theme-plurals.js', 'theme-clues.js', 'dense-fallbacks.js']);
// Tried in order; the next model is used when the previous one fails. Every model must support structured JSON schema output.
const DEFAULT_MODELS = ['deepseek/deepseek-v4-flash', 'openai/gpt-5.6-luna', 'openai/gpt-4.1-mini'];
const MODELS = (process.env.OPENROUTER_MODELS || process.env.OPENROUTER_MODEL || '').split(',').map((model) => model.trim()).filter(Boolean);
if (!MODELS.length) MODELS.push(...DEFAULT_MODELS);

function json(response, status, body) {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  response.end(JSON.stringify(body));
}

async function bodyJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 32_000) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

class GenerationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function requestThemeWords(model, {theme, size, difficulty, exclude, count}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let apiResponse;
  try {
    apiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'content-type': 'application/json',
        'http-referer': process.env.OPENROUTER_SITE_URL || `http://localhost:${PORT}`,
        'x-title': 'Crossfolk',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Create accurate, family-friendly American crossword entries. Return only data matching the JSON schema. Answers must be single words containing A-Z only, with no proper names unless central to the theme. Clues must match the requested difficulty.'
          },
          {
            role: 'user',
            content: `Theme: ${theme}\nMaximum answer length: ${size}\nDifficulty: ${difficulty}\nAvoid these answers: ${exclude.join(', ')}\nGenerate ${count} varied, strongly theme-related entries with intersecting letter patterns.`
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'crossword_words',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                words: {
                  type: 'array',
                  minItems: 8,
                  maxItems: count,
                  items: {
                    type: 'object',
                    properties: {answer: {type: 'string'}, clue: {type: 'string'}},
                    required: ['answer', 'clue'],
                    additionalProperties: false
                  }
                },
              },
              required: ['words'],
              additionalProperties: false,
            },
          },
        },
        provider: {require_parameters: true},
      }),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new GenerationError(504, 'Theme generation timed out.');
    throw new GenerationError(502, 'Could not reach theme generation.');
  } finally {
    clearTimeout(timeout);
  }
  const payload = await apiResponse.json().catch(() => null);
  if (!apiResponse.ok) throw new GenerationError(502, payload?.error?.message || 'Theme generation failed.');
  const content = payload?.choices?.[0]?.message?.content;
  const output = Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text).join('') : content;
  if (typeof output !== 'string' || !output.trim()) throw new GenerationError(502, 'The AI returned an empty response.');
  let parsed;
  try {
    parsed = JSON.parse(output.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    throw new GenerationError(502, 'The AI returned malformed JSON.');
  }
  const words = (Array.isArray(parsed?.words) ? parsed.words : [])
    .map(({answer, clue}) => ({answer: String(answer).toUpperCase().replace(/[^A-Z]/g, ''), clue: String(clue)}))
    .filter(({answer, clue}) => answer.length >= 2 && answer.length <= size && clue);
  if (words.length < 3) throw new GenerationError(502, 'The AI did not return enough usable words.');
  return words;
}

async function createWords(request, response) {
  if (!process.env.OPENROUTER_API_KEY) return json(response, 503, {error: 'AI theme generation is not configured.'});
  try {
    const {theme, size = 5, difficulty = 'easy', exclude = []} = await bodyJson(request);
    const cleanTheme = String(theme ?? '').trim();
    const cleanDifficulty = String(difficulty).toLowerCase();
    if (!cleanTheme) return json(response, 400, {error: 'A theme is required.'});
    if (cleanTheme.length > 160) return json(response, 400, {error: 'Theme must be 160 characters or fewer.'});
    if (!['easy', 'medium', 'hard'].includes(cleanDifficulty)) return json(response, 400, {error: 'Difficulty must be easy, medium, or hard.'});
    if (!Array.isArray(exclude) || exclude.length > 100 || exclude.some((word) => typeof word !== 'string' || word.length > 32)) {
      return json(response, 400, {error: 'Exclude must be an array of at most 100 short answer strings.'});
    }
    const numericSize = ({small: 5, medium: 9, large: 13})[String(size).toLowerCase()] ?? Number(size);
    if (![5, 9, 13].includes(numericSize)) return json(response, 400, {error: 'Size must be small (5), medium (9), or large (13).'});
    const count = numericSize <= 5 ? 60 : 90;
    const options = {theme: cleanTheme, size: numericSize, difficulty: cleanDifficulty, exclude, count};
    let lastError;
    for (const model of MODELS) {
      try {
        const words = await requestThemeWords(model, options);
        return json(response, 200, {words});
      } catch (error) {
        if (!(error instanceof GenerationError)) throw error;
        lastError = error;
        console.warn(`Theme generation with ${model} failed: ${error.message}`);
      }
    }
    return json(response, lastError.status, {error: lastError.message});
  } catch (error) {
    return json(response, 400, {error: error.message || 'Invalid request.'});
  }
}

async function staticFile(request, response) {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (!PUBLIC_FILES.has(relative)) return json(response, 404, {error: 'Not found.'});
    const path = resolve(ROOT, relative);
    if (!(path === ROOT || path.startsWith(`${ROOT}${sep}`))) return json(response, 403, {error: 'Forbidden.'});
    if (!(await stat(path)).isFile()) throw new Error('Not found');
    const content = await readFile(path);
    response.writeHead(200, {'content-type': TYPES[extname(path)] || 'application/octet-stream'});
    response.end(content);
  } catch {
    json(response, 404, {error: 'Not found.'});
  }
}

createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/api/words') return createWords(request, response);
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, {error: 'Method not allowed.'});
  return staticFile(request, response);
}).listen(PORT, () => console.log(`Crosswords is running at http://localhost:${PORT}`));
