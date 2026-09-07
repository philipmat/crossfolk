# Working on Crossfolk

Read the developer overview and run instructions in `README.md` before changing the app.

## Project conventions

- This is a native JavaScript ES-module app with a dependency-free Node server. Keep changes consistent with that structure; avoid introducing a framework or build system for routine changes.
- For coding tasks, use judgment to select an appropriate lower-power model for a concrete subagent task. Delegate only work that can run independently of useful local work.
- If working on C# or Python tooling, prefer the Rider or PyCharm MCP respectively for inspections, symbol lookup, search, and refactoring when available.
- Keep UI state and interactions in `app.js`, generation policy in `engine.js`, and constraint solving in `dense.js`. Run generation through `puzzle-worker.js` so it does not block the UI.
- Add new browser-loaded files to the explicit `PUBLIC_FILES` allowlist in `server.js`. Do not replace the allowlist with unrestricted directory serving.

## Product requirements to preserve

- Default to Small (5×5) and Easy. Medium is 9×9; Large is 13×13.
- A strict majority of answers must relate to the theme. General crossing words are allowed, but do not count them as themed merely because they fit. Use clues that reflect the intended themed sense of ambiguous words.
- Small/Hard puzzles require at least 90% of playable letters to belong to both an Across and a Down answer, with at least 19 playable squares. Prefer fully crossed grids; do not silently lower these requirements when generation fails.
- Keep grids connected, crossing letters consistent, answer numbering correct, and adjacent letter runs valid. Avoid duplicate answers within a puzzle.
- Reject answer sets already present in the supplied history. Individual words may recur; a reshuffled layout of the same answers is not a new answer set.
- Preserve desktop keyboard/mouse input, mobile touch input, and local progress/history storage. Keep stored puzzle data compatible, or handle incompatible saved data gracefully.

## Data and server boundaries

- Keep `OPENAI_API_KEY` on the server. Never put credentials in client modules, generated data, or committed files.
- AI supplies candidate answers and clues; local code constructs the grid. Preserve the explicit unconfigured-AI fallback and useful errors for unsupported or unsatisfiable themes.
- Prefer editing curated vocabulary files for targeted word/clue fixes. Regenerate `wordnet-words.js` with `scripts/build-wordnet.mjs` when changing dictionary selection logic, and preserve the embedded WordNet license and `WORDNET-LICENSE.txt`.
- Validate generated fallback puzzles against current theme and crossing rules; historical generated data is not automatically valid after rules change.

## Verification

- Run `npm test` after changing generation, vocabulary, patterns, or fallback data. Add focused regression coverage for changed requirements rather than weakening tests to accept a regression.
- For UI changes, check desktop keyboard navigation and letter entry, then a phone-width layout and touch keyboard. Confirm errors and loading states remain usable.
- For server changes, check public assets, blocked private paths, and API error handling. Live AI verification requires configured credentials; distinguish that from local tests.
- Documentation-only changes need a consistency review, not an application test run. Keep the README current when architecture, commands, or product behavior changes.
