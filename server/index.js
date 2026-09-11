import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleWords, MAX_BODY} from './handler.js';
import {parseModels} from './words.js';

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
export const PUBLIC_FILES = new Set(['index.html', 'app.js', 'engine.js', 'style.css', 'dense.js', 'fill-words.js', 'puzzle-worker.js', 'theme-fill.js', 'themes.js', 'wordnet-words.js', 'WORDNET-LICENSE.txt', 'mini-patterns.js', 'theme-plurals.js', 'theme-clues.js', 'dense-fallbacks.js']);

function json(response, status, body) {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  response.end(JSON.stringify(body));
}

// Local-only bridge: build a Web `Request` so the same `handleWords` runs here, in a
// Worker, and in a Vercel Function. The body is buffered while capped, because a Node
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

async function apiWords(request, response) {
  let webRequest;
  try {
    webRequest = await toWebRequest(request);
  } catch (error) {
    request.resume();
    if (error.tooLarge) return json(response, 413, {error: 'Request body is too large.'});
    return json(response, 400, {error: 'Invalid request.'});
  }
  const webResponse = await handleWords(webRequest, {env: process.env});
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
  response.end(Buffer.from(await webResponse.arrayBuffer()));
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

const server = createServer(async (request, response) => {
  if (request.url === '/api/words') return apiWords(request, response);
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, {error: 'Method not allowed.'});
  return staticFile(request, response);
});

export default server;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    const configured = process.env.OPENROUTER_MODELS || process.env.OPENROUTER_MODEL;
    console.log(`Crosswords is running at http://localhost:${PORT}`);
    console.log(`OpenRouter models (${configured ? 'OPENROUTER_MODELS' : 'built-in defaults'}): ${parseModels(process.env).join(', ')}`);
  });
}
