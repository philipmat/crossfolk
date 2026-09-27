# Local development

## Run

Requires Node.js 22.13 or newer for its built-in SQLite API.

```sh
npm start
```

Open http://localhost:3000. Set `PORT` for another port. Copy [`.env.example`](.env.example) to the gitignored `.env` file to configure local settings; `npm start` loads it automatically. The server creates `.local/crossfolk.sqlite` and applies pending `migrations/` files before accepting requests. Set `APP_DB_PATH` to use another file, such as `APP_DB_PATH=/data/crossfolk.sqlite`.

The local server and Cloudflare Worker share `server/handler.js` and `server/words.js`. The adapters supply environment access, rate limiting, static files, and database connections. The local server has no `WORDS_LIMIT` burst guard; the Cloudflare deployment has one. For custom theme credentials and the AI policy, see [DEPLOYMENT.md](DEPLOYMENT.md#ai-generation).

## Verify

```sh
npm test
```

This routine suite covers grid validity, themes, crossings, history, the `public/` allowlist, API handling, and the local HTTP bridge. Run `npm run test:ai` when changing AI generation, prompts, OpenRouter handling, word profiles, or generation storage. It covers provider fallback, token accounting, request deduplication, and SQLite/D1 persistence. Run the suites separately: timing-sensitive generation tests can be affected by a concurrent run.

For changes to the interface, check desktop keyboard entry and navigation, then a phone-width layout and touch keyboard. For server changes, check public assets, blocked private paths, and API errors over HTTP after `npm test`. Live AI checks require a configured key and an enabled generation policy.

```sh
npm run verify:american
```

The separate American release harness runs 300 cases per size across themes, difficulties, and rolling history. It checks fill success, answer quality, and a 13.5-second time budget. It must pass before enabling a size; `npm test` keeps a smaller smoke set. The Free form parity test seeds random choices and uses a virtual clock for reproducible grids.

## How generation works

The browser loads native ES modules without a build step. `public/app.js` handles input, rendering, the timer, and browser storage. Curated themes use local vocabulary; custom themes request candidate answers and clues from `POST /api/words`. The API never builds the grid.

`public/puzzle-worker.js` runs generation off the UI thread. `public/engine.js` prepares vocabulary and passes the selected style to `public/layouts/registry.js`. The Free form and American generators use `public/dense.js` for slot constraints and crossing-aware backtracking. A failed generation returns a stable error code; it does not switch styles or relax requirements. Free form uses themed-majority answers. American uses a symmetric pair of featured theme answers (at least five letters each at 9×9) and an audited mask catalog. Only 9×9 American has passed its release gate; 5×5 and 13×13 use Free form.

American masks must be rotationally symmetric, connected, fully crossed, free of one-cell necks and solid 2×2 black blocks, and fillable with curated vocabulary. The 9×9 black-square ceiling is 19 of 81 cells; the usual 16% ceiling leaves almost no usable masks at this size. Difficulty changes mask order and clues, not the vocabulary tier or structural rules. Custom themes use a style-specific server-owned word profile.

A puzzle stores its grid, entries, clues, positions, directions, clue numbers, and theme flags. `localStorage` keeps the current puzzle and progress under `crossfolk-game` and recent answer sets under `crossfolk-history`. Creating a new puzzle replaces the full puzzle record; clearing browser data resets history.

## Code guide

| Path | Role |
|---|---|
| `public/index.html`, `public/style.css`, `public/app.js` | Page, styling, and interaction |
| `public/puzzle-worker.js`, `public/engine.js`, `public/dense.js` | Worker boundary, generation policy, and constraint solver |
| `public/layouts/` | Style metadata, dispatch, masks, and generators |
| `public/fill-words.js`, `public/theme-*.js`, `public/wordnet-words.js` | Curated and generated vocabulary |
| `server/handler.js`, `server/words.js`, `server/generation-policy.js` | Portable API, OpenRouter integration, and AI policy |
| `server/index.js`, `server/sqlite-database.js` | Local HTTP and SQLite adapters |
| `worker/` | Cloudflare adapter |
| `scripts/`, `test/`, `migrations/` | Data utilities, tests, and database migrations |

Every browser-loaded file belongs in `public/` and in the explicit `PUBLIC_FILES` allowlist in `server/index.js`. Production serves `public/` wholesale, so the allowlist must match its contents exactly; `npm test` checks this. Keep credentials out of client code and committed files.

For targeted word or clue fixes, edit curated vocabulary. If dictionary selection changes, rebuild `public/wordnet-words.js` with:

```sh
node scripts/build-wordnet.mjs /path/to/WordNet-3.0/dict
```

Keep its embedded WordNet license and `public/WORDNET-LICENSE.txt`. Test vocabulary, pattern, fallback, and solver changes with `npm test`.
