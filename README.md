# Crossfolk

A responsive theme-based crossword game, built with native JavaScript and a dependency-free Node server.

## Run

Requires Node.js 22 or newer.

```sh
npm start
```

Open http://localhost:3000. Set `PORT` to choose another port.

Small (5×5) and Easy are the defaults; Medium is 9×9 and Large is 13×13. A strict majority of entries must relate to the resolved theme. General vocabulary fills the remaining crossings. The header reports the themed answer count and the percentage of playable letters shared by Across and Down answers.

Hard minis require at least 90% crossing coverage and 19 playable squares, typically reaching 100%. The constraint solver tries several interlocking patterns. Validated space/weather grids provide additional fresh answer sets when a time-bounded search cannot complete. Larger grids prefer fully checked patterns and use a more compact, short-word placement search when needed. Historical answer sets are rejected. If a hard mini cannot satisfy both theme majority and crossing coverage, the app reports that instead of silently lowering either requirement.

Generation runs in a web worker so controls remain responsive. Some hard themes can take several seconds.

## Arbitrary themes

Ten curated theme families work without a key: nature, ocean, space, food, music, travel, sports, animals, weather, and garden. Other themes require server-side AI generation:

```sh
export OPENROUTER_API_KEY='your-key'
npm start
```

Optionally set `OPENROUTER_MODELS` to a comma-separated, preference-ordered list of models (default `deepseek/deepseek-v4-flash,openai/gpt-5.6-luna,openai/gpt-4.1-mini`; each must support structured JSON schema output). The server tries each model in turn and falls back to the next when a request fails, times out, or returns unusable output. `OPENROUTER_MODEL` is still accepted as a single-model alias, and `OPENROUTER_SITE_URL` sets the `HTTP-Referer` attribution header. The key remains on the server. Theme text and recently used answers are sent to OpenRouter when generating a new game with AI enabled. This requires an account with API access and incurs API usage charges. Live AI generation has not been tested with credentials in this workspace.

Each generated puzzle uses a different answer set from the last 100 locally saved games. Individual words can recur, especially with finite curated banks; less-used words are favored. If the generator cannot find a fresh valid set, it reports that instead of knowingly repeating a game. Browser data clearing resets this history.

## Play

Click a clue or cell and type. Arrow keys move, Space switches direction at an intersection, and Tab cycles clues while the grid has focus. Tab from other controls follows normal browser navigation. Phones get an on-screen keyboard; large grids can scroll horizontally on narrow screens. Check marks wrong letters, Reveal fills the selected letter, and Clear resets letters after confirmation. The timer pauses when the page is hidden; game progress and history are saved in local storage.

## Verify

```sh
npm test
```

Tests cover connected grids, legal placement and crossings, numbering, sizes, difficulty, history, custom themed words, invalid input, at least 90% crossed hard minis with a strict thematic majority across all built-in themes, and repeat-game variety. They also cover the generation API — request methods, body size caps, every validation rule, model fallback, answer normalisation, the `public/` allowlist, and the local server's HTTP bridge to the portable handler — using a stubbed OpenRouter. Desktop and 390px phone layouts were reviewed in the browser. Keyboard entry, touch keyboard, answer checking, letter reveal, puzzle regeneration, large size, and hard clues were exercised; HTTP smoke checks cover public assets and blocked private paths.

The generation endpoint is rate-limited on both deployment targets — a Cloudflare binding and a Vercel WAF rule — and unlimited on the local server. Live AI generation has not been tested with credentials in this workspace.

## Deploy

All three targets run the same `server/handler.js`; only environment access, rate limiting, and static file serving differ.

| | Command | Static files | API key | Rate limit |
| --- | --- | --- | --- | --- |
| Local (canonical) | `npm start` | `PUBLIC_FILES` allowlist in `server/index.js` | shell environment | none |
| Cloudflare check | `npx wrangler dev` | `assets` directory | `.dev.vars` (gitignored) | simulated binding |
| Vercel check | `npx vercel dev` | `outputDirectory` | `vercel env pull` | none locally |

`npm start` stays the fastest loop and exercises the same handler both platforms run; the platform CLIs are pre-deploy smoke checks.

### Cloudflare Workers

`public/` is served as Workers Static Assets, so asset requests never reach the Worker. `worker/index.js` handles `/api/words` and returns a JSON 404 for anything else. The `WORDS_LIMIT` binding in `wrangler.jsonc` allows 20 requests per minute per IP.

```sh
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler deploy
```

### Vercel

`public/` is served from the CDN and `api/words.js` runs as a Node function with `maxDuration: 30`, bounding it just past the 20 s upstream timeout. It takes no runtime dependency: configure the rate limit as a WAF rule against `/api/words` rather than importing an SDK.

```sh
npx vercel env add OPENROUTER_API_KEY production
npx vercel deploy --prod
```

`OPENROUTER_MODELS` and `OPENROUTER_SITE_URL` are read from each platform's environment and fall back to the defaults above when unset. Keep `server/words.js` and `server/handler.js` free of `process`, platform imports, and `node:` imports — see `AGENTS.md`.

## How the app works

There is no framework, build step, database, or runtime package dependency. The browser loads native ES modules from the Node server during development; in production the same `public/` directory is served by the platform's CDN (`assets` on Cloudflare, `outputDirectory` on Vercel), and only `/api/words` reaches server code.

1. **Choose a puzzle.** `public/app.js` manages the controls, selected cell/clue, letter entry, checking, reveals, timer, and rendering. On a new game it requests candidate words from `POST /api/words`, which `server/handler.js` implements on every target. A `503` means AI is unconfigured, so it uses the local theme banks instead. The initial demo skips that request.
2. **Generate off the main thread.** `public/puzzle-worker.js` calls `public/engine.js` and returns either a puzzle or an error. The engine combines the theme vocabulary, optional AI candidates, and general crossing words. The AI supplies answers and clues—not the grid.
3. **Fill and validate the grid.** `public/dense.js` fills word slots in predefined patterns, narrowing candidates when crossing letters impose constraints and backtracking when a choice fails. It enforces a thematic majority and rejects previously used answer sets. `public/engine.js` coordinates time limits, saved fallback layouts, and the alternative placement search. Hard minis cannot fall back below 90% crossing coverage.
4. **Play and save locally.** A puzzle contains a two-dimensional `grid` of letters or `null` blocks, plus `entries` with answers, clues, zero-based row/column positions, directions, clue numbers, and theme flags. Progress and recent answer sets live in browser `localStorage`; there are no accounts or server-side saves.

### Layout

```
public/    Static assets served to the browser (HTML, CSS, and all client-side JS)
server/    Portable request core plus the local development server
worker/    Cloudflare Worker adapter (platform-mandated directory name)
api/       Vercel Function adapter (platform-mandated directory name)
scripts/   Dictionary and fallback-data generation utilities
test/      Automated tests
```

### File guide

| Files | Responsibility |
| --- | --- |
| `public/index.html`, `public/style.css`, `public/app.js` | Page structure, responsive styling, and game interaction |
| `server/handler.js` | Platform-neutral Web handler for `POST /api/words` |
| `server/words.js` | Platform-neutral OpenRouter request, validation, and model fallback |
| `server/index.js` | Local development server: static-file allowlist plus a bridge to `server/handler.js` |
| `worker/index.js`, `api/words.js` | Cloudflare and Vercel adapters around `server/handler.js` |
| `public/puzzle-worker.js`, `public/engine.js`, `public/dense.js` | Worker boundary, generation policy, and constraint solver |
| `public/fill-words.js`, `public/theme-fill.js`, `public/theme-plurals.js`, `public/theme-clues.js` | Curated vocabulary, theme associations, plural entries, and contextual clues |
| `public/mini-patterns.js`, `public/dense-fallbacks.js` | Mini grid shapes and pre-generated fallback puzzles |
| `public/wordnet-words.js`, `public/WORDNET-LICENSE.txt` | Generated dictionary supplement and its license |
| `scripts/` | Dictionary and fallback-data generation utilities |
| `test/engine.test.js` | Grid validity, theme majority, crossing coverage, and variety tests |
| `test/handler.test.js` | API validation, model fallback, `public/` allowlist, and the local HTTP bridge |

When adding a browser-loaded module, also add it to `PUBLIC_FILES` in `server/index.js` and place the file in `public/`. That allowlist is also what must match the contents of `public/` exactly — the CDN serves the directory wholesale in production, so `npm test` fails if a stray file appears there. Keep API credentials in server environment variables. Vocabulary or solver changes should be checked with `npm test`; interaction changes also need a browser check on desktop and at phone width.

## Dictionary attribution

Additional short answers and definitions are selected from [Princeton WordNet 3.0](https://wordnet.princeton.edu/). See `public/WORDNET-LICENSE.txt`; the license is also embedded in the generated dictionary module. Curated vocabulary and context-specific clues take precedence where applicable. Rebuild that supplement using `node scripts/build-wordnet.mjs /path/to/WordNet-3.0/dict`.
