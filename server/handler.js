// The Web-standard handler every deployment target mounts. `env` is passed in by the
// adapter; `rateLimit` is an optional `(request) => Promise<boolean>` "allowed" check.
import {generateWords} from './words.js';

export const MAX_BODY = 32_000;

const json = (status, body) => Response.json(body, {status, headers: {'cache-control': 'no-store'}});

export async function handleWords(request, {env = {}, rateLimit, fetchImpl} = {}) {
  if (request.method !== 'POST') return json(405, {error: 'Method not allowed.'});
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return json(413, {error: 'Request body is too large.'});

  if (rateLimit && !(await rateLimit(request))) return json(429, {error: 'Too many puzzles. Try again shortly.'});

  let input;
  try {
    input = await request.json();
  } catch {
    return json(400, {error: 'Invalid request.'});
  }

  try {
    const {status, body} = await generateWords(input, env, {fetchImpl});
    return json(status, body);
  } catch (error) {
    console.error('Unexpected error generating words:', error);
    return json(500, {error: 'Something went wrong generating words.'});
  }
}
