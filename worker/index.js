import {handleWords} from '../server/handler.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/words') return Response.json({error: 'Not found.'}, {status: 404});

    const rateLimit = env.WORDS_LIMIT
      ? async (req) => (await env.WORDS_LIMIT.limit({key: req.headers.get('cf-connecting-ip') ?? 'unknown'})).success
      : undefined;

    return handleWords(request, {env, rateLimit});
  }
};
