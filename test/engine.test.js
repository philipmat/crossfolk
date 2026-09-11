import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePuzzle, supportedThemes} from '../public/engine.js';
import {resolveCuratedTheme} from '../public/themes.js';

function assertValidPuzzle(puzzle) {
  assert.equal(puzzle.grid.length, puzzle.size);
  assert.ok(puzzle.entries.length >= 3);
  const coverage = Array.from({length: puzzle.size}, () => Array.from({length: puzzle.size}, () => []));
  for (const entry of puzzle.entries) {
    assert.match(entry.answer, /^[A-Z]+$/);
    assert.ok(entry.clue);
    assert.ok(entry.number > 0);
    for (let i = 0; i < entry.answer.length; i += 1) {
      const row = entry.row + (entry.direction === 'down' ? i : 0);
      const col = entry.col + (entry.direction === 'across' ? i : 0);
      assert.ok(row >= 0 && row < puzzle.size && col >= 0 && col < puzzle.size);
      assert.equal(puzzle.grid[row][col], entry.answer[i]);
      coverage[row][col].push(entry);
    }
  }
  const connected = new Set([puzzle.entries[0]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const cell of coverage.flat()) {
      if (cell.some((entry) => connected.has(entry))) {
        for (const entry of cell) if (!connected.has(entry)) {
          connected.add(entry);
          changed = true;
        }
      }
    }
  }
  assert.equal(connected.size, puzzle.entries.length, 'all entries should be connected');
  for (let row = 0; row < puzzle.size; row += 1) {
    for (let col = 0; col < puzzle.size; col += 1) {
      if (!puzzle.grid[row][col]) continue;
      const memberships = coverage[row][col];
      assert.ok(memberships.length >= 1 && memberships.length <= 2);
      if (memberships.length === 2) assert.notEqual(memberships[0].direction, memberships[1].direction);
      if (col + 1 < puzzle.size && puzzle.grid[row][col + 1]) {
        assert.ok(memberships.some((entry) => entry.direction === 'across' && coverage[row][col + 1].includes(entry)), 'horizontal neighbors must belong to one across entry');
      }
      if (row + 1 < puzzle.size && puzzle.grid[row + 1][col]) {
        assert.ok(memberships.some((entry) => entry.direction === 'down' && coverage[row + 1][col].includes(entry)), 'vertical neighbors must belong to one down entry');
      }
    }
  }
}

test('exposes broad built-in themes', () => {
  for (const theme of ['nature', 'ocean', 'space', 'food', 'music', 'travel', 'sports', 'animals']) {
    assert.ok(supportedThemes.includes(theme));
  }
});

test('uses the same curated-theme resolution in the app and generator', () => {
  assert.equal(resolveCuratedTheme('ocean reef'), 'ocean');
  assert.equal(resolveCuratedTheme('Martini the blind dog'), null);
});

test('generates valid connected puzzles at every size', () => {
  for (const size of ['small', 'medium', 'large']) assertValidPuzzle(generatePuzzle({
    theme: 'ocean reef',
    size,
    difficulty: 'medium'
  }));
});

test('uses difficulty-specific thematic clues', () => {
  const words = ['ARC', 'AMP', 'REEF', 'CEDAR', 'MEET', 'TAKE', 'PEDAL', 'LED', 'FAKE', 'RED'].map(answer => ({
    answer,
    clues: {easy: 'Easy hint for ' + answer, hard: 'Hard hint for ' + answer}
  }));
  for (const difficulty of ['easy', 'hard']) {
    const puzzle = generatePuzzle({theme: 'celestial laboratory', size: 5, difficulty, words});
    assertValidPuzzle(puzzle);
    const themed = puzzle.entries.filter(entry => words.some(word => word.answer === entry.answer));
    assert.ok(themed.length > 0, 'at least one thematic answer must be included');
    for (const entry of themed) assert.ok(entry.clue.startsWith(difficulty === 'easy' ? 'Easy hint' : 'Hard hint'));
  }
});

test('history steers generation away from reused words', () => {
  const first = generatePuzzle({theme: 'food', size: 5});
  const second = generatePuzzle({theme: 'food', size: 5, history: [first.entries.map(({answer}) => answer)]});
  assert.notDeepEqual(first.entries.map(({answer}) => answer).sort(), second.entries.map(({answer}) => answer).sort());
});

test('accepts arbitrary themes when custom words are supplied', () => {
  const words = [
    {answer: 'ROBOT', clue: 'A programmable machine'},
    {answer: 'BOLT', clue: 'A threaded fastener'},
    {answer: 'GEAR', clue: 'A toothed wheel'},
    {answer: 'LASER', clue: 'A focused beam'},
    {answer: 'WIRE', clue: 'A metal conductor'},
    {answer: 'MOTOR', clue: 'It makes machinery move'},
    {answer: 'RELAY', clue: 'An electrical switch'},
  ];
  const puzzle = generatePuzzle({theme: 'friendly robots', size: 9, words});
  assertValidPuzzle(puzzle);

  const themed = puzzle.entries.filter((entry) => entry.isTheme).length;
  assert.ok(themed > puzzle.entries.length / 2, `expected a themed majority, got ${themed} of ${puzzle.entries.length}`);
});

test('asks for AI words when a theme has no built-in vocabulary', () => {
  assert.throws(
    () => generatePuzzle({theme: 'medieval poetry'}),
    (error) => error.code === 'theme-words-unavailable' && /need AI-generated words/.test(error.message)
  );
});

// Themed pools from the AI endpoint hold a few dozen short words, far fewer than the
// curated banks. A mini still has to reach the themed majority with a fully crossed grid.
// Generation is stochastic and a player can regenerate, so a pool gets a few attempts.
test('builds a crossed mini from an AI-sized themed pool', () => {
  const words = 'BARK,TAIL,PAW,NOSE,EAR,EYE,BLIND,SIGHT,SMELL,SOUND,TOUCH,TASTE,WALK,LEAD,LEASH,FETCH,BALL,BONE,TREAT,SIT,STAY,DOWN,COME,HEEL,ROLL,PLAY,SWIM,DIG,CHEW,LICK,SNIFF,GROWL,WHINE,HOWL,YELP,PANT,SHED,GROOM,BATHE,CRATE,BED,BOWL,FOOD,WATER,SNACK,CHOW,MEAL,BRUSH,COMB,NAIL,VET,SHOT,CHIP,TAG,VEST,GUIDE,PUP,POOCH,HOUND'
    .split(',')
    .map((answer) => ({answer, clue: `Clue for ${answer}`}));

  let playable = 0;
  let crossed = 0;
  for (let attempt = 0; attempt < 3 && playable < 19; attempt += 1) {
    const puzzle = generatePuzzle({theme: 'martini the blind dog', size: 5, difficulty: 'easy', words});
    assertValidPuzzle(puzzle);

    const entryCells = new Map();
    for (const entry of puzzle.entries) {
      for (const offset of [...entry.answer].keys()) {
        const key = `${entry.row + (entry.direction === 'down' ? offset : 0)},${entry.col + (entry.direction === 'across' ? offset : 0)}`;
        entryCells.set(key, (entryCells.get(key) ?? 0) + 1);
      }
    }
    playable = entryCells.size;
    crossed = [...entryCells.values()].filter((count) => count === 2).length;
  }

  assert.ok(playable >= 19, `expected at least 19 playable squares, got ${playable}`);
  assert.ok(crossed / playable >= 0.9, `expected at least 90% crossed letters, got ${Math.round(crossed / playable * 100)}%`);
});

test('rejects invalid options clearly', () => {
  assert.throws(() => generatePuzzle({theme: 'ocean', size: 7}), /Size must/);
  assert.throws(() => generatePuzzle({theme: 'ocean', difficulty: 'expert'}), /Difficulty must/);
});

function checkedRatio(puzzle) {
  const cells = new Map();
  for (const entry of puzzle.entries) {
    for (let i = 0; i < entry.answer.length; i++) {
      const key = `${entry.row + (entry.direction === 'down' ? i : 0)},${entry.col + (entry.direction === 'across' ? i : 0)}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
  }
  return [...cells.values()].filter(count => count === 2).length / cells.size;
}

test('hard minis combine at least 90% crossing coverage with a thematic majority', () => {
  for (const theme of supportedThemes) {
    const puzzle = generatePuzzle({theme, size: 5, difficulty: 'hard'});
    assertValidPuzzle(puzzle);
    assert.ok(checkedRatio(puzzle) >= 0.9, `${theme}: nearly all letters must have both clues`);
    assert.ok(puzzle.entries.filter(e => e.isTheme).length > puzzle.entries.length / 2, `${theme}: a strict majority must be themed`);
    assert.ok(puzzle.grid.flat().filter(Boolean).length >= 19, 'at least 76% of the board is playable');
    assert.equal(new Set(puzzle.entries.map(e => e.answer)).size, puzzle.entries.length, 'no duplicate answers');
  }
});

test('repeated hard minis keep full interlocking and distinct answer sets', () => {
  const history = [];
  for (let i = 0; i < 8; i++) {
    const puzzle = generatePuzzle({theme: 'ocean', size: 5, difficulty: 'hard', history});
    assertValidPuzzle(puzzle);
    assert.ok(checkedRatio(puzzle) >= 0.9);
    assert.ok(puzzle.entries.filter(e => e.isTheme).length > puzzle.entries.length / 2);
    const answers = puzzle.entries.map(e => e.answer).sort();
    assert.ok(!history.some(old => old.join('|') === answers.join('|')));
    history.push(answers);
  }
});

test('larger grids improve crossing density and preserve a thematic majority', () => {
  for (const size of [9, 13]) {
    const puzzle = generatePuzzle({theme: 'nature', size, difficulty: 'hard'});
    assertValidPuzzle(puzzle);
    assert.ok(checkedRatio(puzzle) >= 0.35, `${size}: crossing density must improve on the old sparse grids`);
    assert.ok(puzzle.entries.filter(e => e.isTheme).length > puzzle.entries.length / 2);
    assert.ok(puzzle.grid.flat().filter(Boolean).length >= size * size * 0.35);
  }
});
