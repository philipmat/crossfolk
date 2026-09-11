// The Web-standard handler every deployment target mounts. `env` is passed in by the
// adapter; `rateLimit` is an optional `(request) => Promise<boolean>` "allowed" check.
import {generateWords} from './words.js';

export const MAX_BODY = 32_000;

const json = (status, body) => Response.json(body, {status, headers: {'cache-control': 'no-store'}});

// Reads the real body stream up to MAX_BODY rather than trusting the client-supplied
// Content-Length header, which a request can omit (chunked/HTTP2) or understate.
// Returns the decoded text, or `undefined` if the stream exceeds the cap.
async function readCappedBody(request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

export async function handleWords(request, {env = {}, rateLimit, fetchImpl} = {}) {
  if (request.method !== 'POST') return json(405, {error: 'Method not allowed.'});
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return json(413, {error: 'Request body is too large.'});

  if (rateLimit && !(await rateLimit(request))) return json(429, {error: 'Too many puzzles. Try again shortly.'});

  const raw = await readCappedBody(request);
  if (raw === undefined) return json(413, {error: 'Request body is too large.'});

  let input;
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    return json(400, {error: 'Invalid request.'});
  }

  try {
    const {status, body} = await generateWords(input, env, {fetchImpl, signal: request.signal});
    return json(status, body);
  } catch (error) {
    console.error('Unexpected error generating words:', error);
    return json(500, {error: 'Something went wrong generating words.'});
  }
}
