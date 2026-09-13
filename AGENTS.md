# Working on Crossfolk

Read the developer overview and run instructions in `README.md` before changing the app.

## Project conventions

- This is a native JavaScript ES-module app with a lightweight Node server. Keep changes consistent with that structure; for a small amount of functionality, favor implementing it directly. When functionality is complex enough to justify it, a lightweight, focused library is acceptable. Avoid introducing a framework or build system for routine changes.
- Layout: `public/` holds every browser-loaded file (HTML, CSS, client JS), `server/` holds all server-side code, `scripts/` holds data-generation utilities, and `test/` holds automated tests. `worker/` holds the Cloudflare deployment adapter.
- `server/handler.js` and `server/words.js` are the portable core: `server/index.js` bridges local HTTP requests to them, and `worker/index.js` adapts them for Cloudflare.
- For coding tasks, use judgment to select an appropriate lower-power model for a concrete subagent task. Delegate only work that can run independently of useful local work.
- If working on C# or Python tooling, prefer the Rider or PyCharm MCP respectively for inspections, symbol lookup, search, and refactoring when available.
- Keep UI state and interactions in `public/app.js`, generation policy in `public/engine.js`, and constraint solving in `public/dense.js`. Run generation through `public/puzzle-worker.js` so it does not block the UI.
- Add new browser-loaded files to `public/` and to the explicit `PUBLIC_FILES` allowlist in `server/index.js`. The allowlist is both the local request-time guard and the definition of which files may exist in `public/` at all: production CDNs serve that directory wholesale, so it must match the directory contents exactly and `npm test` enforces that. Do not replace the allowlist with unrestricted directory serving.
- Write code as a human would: leave blank lines between logical steps within a function (setup, main logic, return/result) instead of producing dense, uninterrupted blocks. Do not add a blank line between every statement, and do not add blank lines inside short (under ~5 line) functions.

## Server portability rules

The core must run unmodified on Node 22 and `workerd`. Check these on every review of `server/words.js` and `server/handler.js`:

1. Never touch `process`. `process.env` does not exist in `workerd` and throws at runtime; each adapter passes an `env` object inward and the core reads configuration only from that argument.
2. Never import a platform package or a `node:` builtin. Cloudflare bindings and `node:fs` are reached only through injected functions or the adapter layer; an import inside the core would be bundled into the other platform's build.
3. Use only APIs common to both runtimes: `fetch`, `Request`, `Response`, `Headers`, `URL`, `AbortController`, `setTimeout`, and `JSON`. `fetch` is an injectable parameter defaulting to the global so tests can stub OpenRouter without credentials.

Adapters stay thin: they supply environment access, rate limiting, and static file serving, and nothing else. Favor implementing small utilities directly, but allow a lightweight, focused library for complex functionality when it preserves the portable core and clearly reduces implementation or maintenance complexity.

## Product requirements to preserve

- Default to Small (5×5) and Easy. Medium is 9×9; Large is 13×13.
- A strict majority of answers must relate to the theme. General crossing words are allowed, but do not count them as themed merely because they fit. Use clues that reflect the intended themed sense of ambiguous words.
- Small/Hard puzzles require at least 90% of playable letters to belong to both an Across and a Down answer, with at least 19 playable squares. Prefer fully crossed grids; do not silently lower these requirements when generation fails.
- Keep grids connected, crossing letters consistent, answer numbering correct, and adjacent letter runs valid. Avoid duplicate answers within a puzzle.
- Reject answer sets already present in the supplied history. Individual words may recur; a reshuffled layout of the same answers is not a new answer set.
- Preserve desktop keyboard/mouse input, mobile touch input, and local progress/history storage. Keep stored puzzle data compatible, or handle incompatible saved data gracefully.

## Data and server boundaries

- Keep `OPENROUTER_API_KEY` on the server. Never put credentials in client modules, generated data, or committed files.
- AI supplies candidate answers and clues; local code constructs the grid. Preserve the explicit unconfigured-AI fallback and useful errors for unsupported or unsatisfiable themes.
- Prefer editing curated vocabulary files for targeted word/clue fixes. Regenerate `public/wordnet-words.js` with `scripts/build-wordnet.mjs` when changing dictionary selection logic, and preserve the embedded WordNet license and `public/WORDNET-LICENSE.txt`.
- Validate generated fallback puzzles against current theme and crossing rules; historical generated data is not automatically valid after rules change.

## Verification

- Run `npm test` after changing generation, vocabulary, patterns, or fallback data. Add focused regression coverage for changed requirements rather than weakening tests to accept a regression.
- For UI changes, check desktop keyboard navigation and letter entry, then a phone-width layout and touch keyboard. Confirm errors and loading states remain usable.
- For server changes, run `npm test` (it covers the handler, the `public/` allowlist, and the local HTTP bridge), then check public assets, blocked private paths, and API error handling over HTTP. Live AI verification requires configured credentials; distinguish that from local tests. A deployed worker can be checked with `npx wrangler dev`.
- Documentation-only changes need a consistency review, not an application test run. Keep the README current when architecture, commands, or product behavior changes.
