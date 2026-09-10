// Platform-neutral OpenRouter logic. No `process`, no platform imports, no `node:` imports:
// callers pass an `env` object and (optionally) a `fetch` implementation.
export const DEFAULT_MODELS = ['deepseek/deepseek-v4-flash', 'openai/gpt-5.6-luna', 'openai/gpt-4.1-mini'];
const SIZES = {small: 5, medium: 9, large: 13};

export class GenerationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Returns either `{error: {status, body}}` or the normalised options for `requestThemeWords`.
export function validateOptions(input) {
  const {theme, size = 5, difficulty = 'easy', exclude = []} = input ?? {};
  const cleanTheme = String(theme ?? '').trim();
  if (!cleanTheme) return {error: {status: 400, body: {error: 'A theme is required.'}}};
  if (cleanTheme.length > 160) return {error: {status: 400, body: {error: 'Theme must be 160 characters or fewer.'}}};
  const cleanDifficulty = String(difficulty).toLowerCase();
  if (!['easy', 'medium', 'hard'].includes(cleanDifficulty)) return {error: {status: 400, body: {error: 'Difficulty must be easy, medium, or hard.'}}};
  if (!Array.isArray(exclude) || exclude.length > 100 || exclude.some((word) => typeof word !== 'string' || word.length > 32)) {
    return {error: {status: 400, body: {error: 'Exclude must be an array of at most 100 short answer strings.'}}};
  }
  const numericSize = SIZES[String(size).toLowerCase()] ?? Number(size);
  if (![5, 9, 13].includes(numericSize)) return {error: {status: 400, body: {error: 'Size must be small (5), medium (9), or large (13).'}}};

  return {theme: cleanTheme, size: numericSize, difficulty: cleanDifficulty, exclude, count: numericSize <= 5 ? 60 : 90};
}

export function parseModels(env) {
  const models = String(env.OPENROUTER_MODELS || env.OPENROUTER_MODEL || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return models.length ? models : [...DEFAULT_MODELS];
}

async function requestThemeWords(model, {theme, size, difficulty, exclude, count}, env, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let apiResponse;
  try {
    apiResponse = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'content-type': 'application/json',
        'http-referer': env.OPENROUTER_SITE_URL || `http://localhost:${env.PORT || 3000}`,
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

// Returns plain `{status, body}` data rather than a `Response`, so this layer stays
// testable and reusable off any HTTP runtime.
export async function generateWords(input, env, {fetchImpl = fetch} = {}) {
  if (!env.OPENROUTER_API_KEY) return {status: 503, body: {error: 'AI theme generation is not configured.'}};

  const options = validateOptions(input);
  if (options.error) return options.error;

  const models = parseModels(env);
  let lastError;

  for (const model of models) {
    try {
      const words = await requestThemeWords(model, options, env, fetchImpl);
      return {status: 200, body: {words}};
    } catch (error) {
      if (!(error instanceof GenerationError)) throw error;
      lastError = error;
      console.warn(`Theme generation with ${model} failed: ${error.message}`);
    }
  }

  return {status: lastError.status, body: {error: lastError.message}};
}
