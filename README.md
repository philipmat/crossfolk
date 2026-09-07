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

Optionally set `OPENROUTER_MODELS` to a comma-separated, preference-ordered list of models (default `deepseek/deepseek-v4-flash,openai/gpt-4.1-mini`; each must support structured JSON schema output). The server tries each model in turn and falls back to the next when a request fails, times out, or returns unusable output. `OPENROUTER_MODEL` is still accepted as a single-model alias. and `OPENROUTER_SITE_URL` (sent as the `HTTP-Referer` attribution header). The key remains on the server. Theme text and recently used answers are sent to OpenRouter when generating a new game with AI enabled. This requires an account with API access and incurs API usage charges. Live AI generation has not been tested with credentials in this workspace.

Each generated puzzle uses a different answer set from the last 100 locally saved games. Individual words can recur, especially with finite curated banks; less-used words are favored. If the generator cannot find a fresh valid set, it reports that instead of knowingly repeating a game. Browser data clearing resets this history.

## Play

Click a clue or cell and type. Arrow keys move, Space switches direction at an intersection, and Tab cycles clues while the grid has focus. Tab from other controls follows normal browser navigation. Phones get an on-screen keyboard; large grids can scroll horizontally on narrow screens. Check marks wrong letters, Reveal fills the selected letter, and Clear resets letters after confirmation. The timer pauses when the page is hidden; game progress and history are saved in local storage.

## Verify

```sh
npm test
```

Tests cover connected grids, legal placement and crossings, numbering, sizes, difficulty, history, custom themed words, invalid input, at least 90% crossed hard minis with a strict thematic majority across all built-in themes, and repeat-game variety. Desktop and 390px phone layouts were reviewed in the browser. Keyboard entry, touch keyboard, answer checking, letter reveal, puzzle regeneration, large size, and hard clues were exercised; HTTP smoke checks cover public assets and blocked private paths.

Before public hosting, add an application-appropriate access/rate limit to the generation endpoint to control API costs. This project is configured as a local app and has not been deployed.

## How the app works

There is no framework, build step, database, or runtime package dependency. The browser loads native ES modules from the Node server.

1. **Choose a puzzle.** `app.js` manages the controls, selected cell/clue, letter entry, checking, reveals, timer, and rendering. On a new game it requests candidate words from `POST /api/words`. A `503` means AI is unconfigured, so it uses the local theme banks instead. The initial demo skips that request.
2. **Generate off the main thread.** `puzzle-worker.js` calls `engine.js` and returns either a puzzle or an error. The engine combines the theme vocabulary, optional AI candidates, and general crossing words. The AI supplies answers and clues—not the grid.
3. **Fill and validate the grid.** `dense.js` fills word slots in predefined patterns, narrowing candidates when crossing letters impose constraints and backtracking when a choice fails. It enforces a thematic majority and rejects previously used answer sets. `engine.js` coordinates time limits, saved fallback layouts, and the alternative placement search. Hard minis cannot fall back below 90% crossing coverage.
4. **Play and save locally.** A puzzle contains a two-dimensional `grid` of letters or `null` blocks, plus `entries` with answers, clues, zero-based row/column positions, directions, clue numbers, and theme flags. Progress and recent answer sets live in browser `localStorage`; there are no accounts or server-side saves.

### File guide

| Files | Responsibility |
| --- | --- |
| `index.html`, `style.css`, `app.js` | Page structure, responsive styling, and game interaction |
| `server.js` | Static-file allowlist and optional server-side OpenRouter request |
| `puzzle-worker.js`, `engine.js`, `dense.js` | Worker boundary, generation policy, and constraint solver |
| `fill-words.js`, `theme-fill.js`, `theme-plurals.js`, `theme-clues.js` | Curated vocabulary, theme associations, plural entries, and contextual clues |
| `mini-patterns.js`, `dense-fallbacks.js` | Mini grid shapes and pre-generated fallback puzzles |
| `wordnet-words.js`, `WORDNET-LICENSE.txt` | Generated dictionary supplement and its license |
| `scripts/` | Dictionary and fallback-data generation utilities |
| `engine.test.js` | Grid validity, theme majority, crossing coverage, and variety tests |

When adding a browser-loaded module, also add it to `PUBLIC_FILES` in `server.js`. Keep API credentials in server environment variables. Vocabulary or solver changes should be checked with `npm test`; interaction changes also need a browser check on desktop and at phone width.

## Dictionary attribution

Additional short answers and definitions are selected from [Princeton WordNet 3.0](https://wordnet.princeton.edu/). See `WORDNET-LICENSE.txt`; the license is also embedded in the generated dictionary module. Curated vocabulary and context-specific clues take precedence where applicable. Rebuild that supplement using `node scripts/build-wordnet.mjs /path/to/WordNet-3.0/dict`.
