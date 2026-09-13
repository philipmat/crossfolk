import {handleWords} from '../server/handler.js';
import {D1GenerationStore} from './d1-generation-store.js';

async function requesterMetadata(request, env) {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip || !env.REQUESTER_HASH_SECRET || !crypto?.subtle) return {key: 'unknown', version: 'hmac-v1'};
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.REQUESTER_HASH_SECRET), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
  return {key: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''), version: 'hmac-v1'};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/words') return Response.json({error: 'Not found.'}, {status: 404});
    if (!env.APP_DB) return Response.json({error: 'Theme generation storage is not configured.', retryable: true}, {status: 503, headers: {'cache-control': 'no-store', 'retry-after': '1'}});

    const rateLimit = env.WORDS_LIMIT
      ? async (req) => (await env.WORDS_LIMIT.limit({key: req.headers.get('cf-connecting-ip') ?? 'unknown'})).success
      : undefined;

    const requester = await requesterMetadata(request, env);
    const requestEnv = {...env, RUNTIME: 'cloudflare', REQUESTER_KEY: requester.key, REQUESTER_KEY_VERSION: requester.version};
    const generationStore = new D1GenerationStore(env.APP_DB, {requesterKey: requester.key, requesterKeyVersion: requester.version});
    return handleWords(request, {env: requestEnv, rateLimit, generationStore});
  }
};
