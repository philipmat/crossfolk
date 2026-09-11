// Platform-neutral OpenRouter logic. No `process`, no platform imports, no `node:` imports:
// callers pass an `env` object and (optionally) a `fetch` implementation.
import {logger as defaultLogger} from './logger.js';

export const DEFAULT_MODELS = [
  'nvidia/nemotron-3-nano-30b-a3b:nitro', 'openai/gpt-oss-20b', 'google/gemini-2.5-flash-lite:nitro',
  'deepseek/deepseek-v4-flash', 'openai/gpt-4.1-mini', 'openai/gpt-5.6-luna'];
// Some providers begin streaming immediately but take longer than a minute to finish
// schema-constrained reasoning. Keep a bounded shared budget without prematurely
// cancelling a completion that has already started.
export const MAX_GENERATION_TIMEOUT_MS = 120_000;
export const MAX_MODEL_TIMEOUT_MS = 60_000;
const SIZES = {small: 5, medium: 9, large: 13};

export class GenerationError extends Error {
  constructor(status, message, usage = null) {
    super(message);
    this.status = status;
    this.usage = usage;
  }
}

// OpenRouter reports token counts alongside the completion. Surfacing them shows the player
// what the AI call cost, including tokens burned by an attempt that then failed.
function readUsage(payload) {
  const usage = payload?.usage;
  if (!usage) return null;
  const input = Number(usage.prompt_tokens) || 0;
  const output = Number(usage.completion_tokens) || 0;
  return {input, output, total: Number(usage.total_tokens) || input + output};
}

// Wall-clock cost of one OpenRouter attempt, reported on the server console so operators can see
// which model was tried and how long it held the shared request budget.
function elapsedSeconds(startedAt) {
  return ((Date.now() - startedAt) / 1000).toFixed(1);
}

function addUsage(first, second) {
  if (!first) return second ?? null;
  if (!second) return first;
  return {input: first.input + second.input, output: first.output + second.output, total: first.total + second.total};
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

  // A few dozen clean candidates are enough for the local solver. Asking for a much
  // larger schema-constrained response makes slower providers miss the request window.
  return {theme: cleanTheme, size: numericSize, difficulty: cleanDifficulty, exclude, count: numericSize <= 5 ? 40 : 60};
}

export function parseModels(env) {
  const models = String(env.OPENROUTER_MODELS || env.OPENROUTER_MODEL || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return models.length ? models : [...DEFAULT_MODELS];
}

async function requestThemeWords(model, {theme, size, difficulty, exclude, count}, env, fetchImpl, timeoutMs, parentSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, {once: true});
  let apiResponse;
  let payload;
  try {
    apiResponse = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'content-type': 'application/json',
        ...(env.OPENROUTER_SITE_URL ? {'http-referer': env.OPENROUTER_SITE_URL} : {}),
        'x-title': 'Crossfolk'
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
    // Read the body within the timeout: clearing the timer after the headers alone would
    // let a slow model stream for minutes past the abort deadline.
    payload = await apiResponse.json().catch((error) => {
      if (error.name === 'AbortError') throw error;
      return null;
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new GenerationError(504, 'Theme generation timed out.');
    throw new GenerationError(502, 'Could not reach theme generation.');
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
  const usage = readUsage(payload);
  if (!apiResponse.ok) throw new GenerationError(502, payload?.error?.message || 'Theme generation failed.', usage);
  const content = payload?.choices?.[0]?.message?.content;
  const output = Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text).join('') : content;
  if (typeof output !== 'string' || !output.trim()) throw new GenerationError(502, 'The AI returned an empty response.', usage);
  let parsed;
  try {
    parsed = JSON.parse(output.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    throw new GenerationError(502, 'The AI returned malformed JSON.', usage);
  }
  const words = (Array.isArray(parsed?.words) ? parsed.words : [])
    .map(({answer, clue}) => ({answer: String(answer).toUpperCase().replace(/[^A-Z]/g, ''), clue: String(clue)}))
    .filter(({answer, clue}) => answer.length >= 2 && answer.length <= size && clue);
  if (words.length < 3) throw new GenerationError(502, 'The AI did not return enough usable words.', usage);

  return {words, usage};
}

// Returns plain `{status, body}` data rather than a `Response`, so this layer stays
// testable and reusable off any HTTP runtime.
export async function generateWords(input, env, {fetchImpl = fetch, timeoutMs = MAX_GENERATION_TIMEOUT_MS, maxModelTimeoutMs = MAX_MODEL_TIMEOUT_MS, signal, logger = defaultLogger} = {}) {
  if (!env.OPENROUTER_API_KEY) return {status: 503, body: {error: 'AI theme generation is not configured.'}};

  const options = validateOptions(input);
  if (options.error) return options.error;

  const models = parseModels(env);
  const budgetMs = Math.max(10, Math.min(Number(timeoutMs) || MAX_GENERATION_TIMEOUT_MS, MAX_GENERATION_TIMEOUT_MS));
  const modelBudgetMs = Math.max(1, Math.min(Number(maxModelTimeoutMs) || MAX_MODEL_TIMEOUT_MS, MAX_MODEL_TIMEOUT_MS));
  const deadline = Date.now() + budgetMs;
  let lastError;
  let usage = null;

  for (let index = 0; index < models.length; index += 1) {
    if (signal?.aborted) {
      lastError = new GenerationError(504, 'Theme generation timed out.');
      break;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      lastError = new GenerationError(504, 'Theme generation timed out.');
      break;
    }

    // Give the preferred model a useful window. Equal-splitting a short total budget
    // across a long fallback list aborts every otherwise-successful completion.
    const modelTimeoutMs = Math.min(modelBudgetMs, remainingMs);
    const model = models[index];
    logger.info(`Requesting theme words from OpenRouter model ${model}`);
    const startedAt = Date.now();
    try {
      const attempt = await requestThemeWords(model, options, env, fetchImpl, modelTimeoutMs, signal);
      logger.info(`OpenRouter model ${model} answered in ${elapsedSeconds(startedAt)}s`);
      return {status: 200, body: {words: attempt.words, source: {model, usage: addUsage(usage, attempt.usage)}}};
    } catch (error) {
      if (!(error instanceof GenerationError)) throw error;
      usage = addUsage(usage, error.usage);
      lastError = error;
      logger.warn(`OpenRouter model ${model} failed after ${elapsedSeconds(startedAt)}s: ${error.message}`);
    }
  }

  return {status: lastError.status, body: {error: lastError.message}};
}
