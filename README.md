# Crossfolk

A responsive theme-based crossword game, built with native JavaScript and a dependency-free Node server.

## Run

Requires Node.js 22 or newer.

```sh
npm start
```

Open http://localhost:3000. Set `PORT` to choose another port.

Small (5×5) and Easy are the defaults; Medium is 9×9 and Large is 13×13. Difficulty changes the clues. The grids are connected freeform crosswords, with blocked unused cells, rather than rotationally symmetric newspaper grids.

## Arbitrary themes

Ten curated theme families work without a key: nature, ocean, space, food, music, travel, sports, animals, weather, and garden. Other themes require server-side AI generation:

```sh
export OPENAI_API_KEY='your-key'
npm start
```

Optionally set `OPENAI_MODEL` (default `gpt-4.1-mini`). The key remains on the server. Theme text and recently used answers are sent to OpenAI when generating a new game with AI enabled. This requires an account with API access and incurs API usage charges. Live AI generation has not been tested with credentials in this workspace.

Each generated puzzle uses a different answer set from the last 100 locally saved games. Individual words can recur, especially with finite curated banks; less-used words are favored. If the generator cannot find a fresh valid set, it reports that instead of knowingly repeating a game. Browser data clearing resets this history.

## Play

Click a clue or cell and type. Arrow keys move, Space switches direction at an intersection, and Tab cycles clues while the grid has focus. Tab from other controls follows normal browser navigation. Phones get an on-screen keyboard; large grids can scroll horizontally on narrow screens. Check marks wrong letters, Reveal fills the selected letter, and Clear resets letters after confirmation. The timer pauses when the page is hidden; game progress and history are saved in local storage.

## Verify

```sh
npm test
```

Tests cover connected grids, legal placement and crossings, numbering, sizes, difficulty, history, custom themed words, and invalid input. Desktop and 390px phone layouts were reviewed in the browser. Keyboard entry, touch keyboard, answer checking, letter reveal, puzzle regeneration, large size, and hard clues were exercised; HTTP smoke checks cover public assets and blocked private paths.

Before public hosting, add an application-appropriate access/rate limit to the generation endpoint to control API costs. This project is configured as a local app and has not been deployed.
