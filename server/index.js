import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleGenerationStatus, handleWords, MAX_BODY} from './handler.js';
import {logger} from './logger.js';
import {parseModels} from './words.js';
import {createGenerationPolicy} from './generation-policy.js';
import {openApplicationDatabase} from './sqlite-database.js';
import {SqliteGenerationStore} from './sqlite-generation-store.js';

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
export const PUBLIC_FILES = new Set(['index.html', 'favicon.svg', 'app.js', 'engine.js', 'style.css', 'dense.js', 'fill-words.js', 'puzzle-worker.js', 'theme-fill.js', 'themes.js', 'wordnet-words.js', 'WORDNET-LICENSE.txt', 'mini-patterns.js', 'theme-plurals.js', 'theme-clues.js', 'dense-fallbacks.js', 'layouts/mask-analysis.js', 'layouts/american-patterns.js', 'layouts/freeform.js', 'layouts/american.js', 'layouts/american-fill-words.js', 'layouts/american-theme-words.js', 'layouts/errors.js', 'layouts/registry.js', 'layouts/styles.js']);

export function isWordsPath(url) {
  return new URL(url, 'http://localhost').pathname === '/api/words';
}

export function isGenerationStatusPath(url) {
  return new URL(url, 'http://localhost').pathname === '/api/generation-status';
}

function json(response, status, body) {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  response.end(JSON.stringify(body));
}

// Local-only bridge: build a Web `Request` so the same `handleWords` runs here and in a
// Worker. The body is buffered while capped, because a Node
// stream body would require `duplex: 'half'` and buys nothing at 32 KB.
async function toWebRequest(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY) {
      const error = new Error('Request body is too large.');
      error.tooLarge = true;
      throw error;
    }
    chunks.push(chunk);
  }
  const headers = new Headers();
  for (let index = 0; index < request.rawHeaders.length; index += 2) headers.append(request.rawHeaders[index], request.rawHeaders[index + 1]);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  return new Request(new URL(request.url, `http://localhost:${PORT}`), {
    method: request.method,
    headers,
    ...(hasBody ? {body: Buffer.concat(chunks).toString('utf8')} : {})
  });
}

function createLocalRequestHandler({env = process.env, generationStore, generationPolicy} = {}) {
  return async function apiWords(request, response) {
  let webRequest;
  try {
    webRequest = await toWebRequest(request);
  } catch (error) {
    request.resume();
    if (error.tooLarge) return json(response, 413, {error: 'Request body is too large.'});
    return json(response, 400, {error: 'Invalid request.'});
  }
  const webResponse = await handleWords(webRequest, {env: {...env, RUNTIME: 'local', REQUESTER_KEY: 'local', REQUESTER_KEY_VERSION: 'v1'}, generationStore, generationPolicy});
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
  response.end(Buffer.from(await webResponse.arrayBuffer()));
  };
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

export function createLocalServer({env = process.env, database, generationStore, generationPolicy} = {}) {
  const store = generationStore || (database ? new SqliteGenerationStore(database.connection, {runtime: 'local'}) : undefined);
  // One policy instance per server so the cached `app_settings` row is shared by requests.
  const localPolicy = store ? (generationPolicy || createGenerationPolicy()) : undefined;
  const apiWords = createLocalRequestHandler({env, generationStore: store, generationPolicy: localPolicy});
  const apiGenerationStatus = async (request, response) => {
    const webResponse = await handleGenerationStatus(new Request(new URL(request.url, `http://localhost:${PORT}`), {method: request.method}), {
      generationStore: store,
      generationPolicy: localPolicy
    });
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    response.end(Buffer.from(await webResponse.arrayBuffer()));
  };
  return createServer(async (request, response) => {
    if (isWordsPath(request.url)) return apiWords(request, response);
    if (isGenerationStatusPath(request.url)) return apiGenerationStatus(request, response);
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, {error: 'Method not allowed.'});
    return staticFile(request, response);
  });
}

// Kept as a no-database instance for importers and tests. Production startup below
// explicitly owns both the database and this server's lifecycle.
const server = createLocalServer();

export default server;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const database = openApplicationDatabase(process.env.APP_DB_PATH);
  const runnable = createLocalServer({database});
  const shutdown = () => { runnable.close(() => database.close()); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  runnable.listen(PORT, () => {
    const configured = process.env.OPENROUTER_MODELS || process.env.OPENROUTER_MODEL;
    logger.info(`Crosswords is running at http://localhost:${PORT}`);
    logger.info(`OpenRouter models (${configured ? 'OPENROUTER_MODELS' : 'built-in defaults'}): ${parseModels(process.env).join(', ')}`);
  });
}
