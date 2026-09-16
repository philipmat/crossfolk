import test from 'node:test';
import assert from 'node:assert/strict';

import {generateAmerican} from '../public/layouts/american.js';
import {americanPatterns, americanRules} from '../public/layouts/american-patterns.js';
import {analyzeMask, maxBlackCells} from '../public/layouts/mask-analysis.js';
import {americanFillWords} from '../public/layouts/american-fill-words.js';
import {americanThemeWords} from '../public/layouts/american-theme-words.js';
import {supportedThemes} from '../public/themes.js';
import {fillWords} from '../public/fill-words.js';
import {themedPlurals} from '../public/theme-plurals.js';

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const MASKS = new Map(americanPatterns.map((pattern) => [pattern.mask.join('/'), pattern]));
const BUDGET_MS = 9000;

function seededRandom(label) {
  let state = 2166136261;
  for (const character of label) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state = Math.imul(state, 1664525) + 1013904223 >>> 0;
    return state / 0x100000000;
  };
}

function build(theme, difficulty, {history = [], timeLimitMs = BUDGET_MS, themeWords} = {}) {
  return generateAmerican({
    size: 9,
    difficulty,
    theme,
    themeCategory: supportedThemes.includes(theme) ? theme : null,
    themeWords,
    history,
    random: seededRandom(`${theme}/9/${difficulty}`),
    deadline: Date.now() + timeLimitMs,
  });
}

// The mask a puzzle actually used, recovered from the grid rather than from metadata.
function maskOf(puzzle) {
  return puzzle.grid.map((row) => row.map((cell) => (cell === null ? '#' : '.')).join(''));
}

function assertAmericanPuzzle(puzzle, label) {
  assert.equal(puzzle.size, 9, `${label}: size`);
  assert.equal(puzzle.grid.length, 9, `${label}: rows`);

  const mask = maskOf(puzzle);
  const pattern = MASKS.get(mask.join('/'));
  assert.ok(pattern, `${label}: the produced grid is not a catalog mask`);

  const metrics = analyzeMask(mask);
  assert.equal(metrics.fullyChecked, true, `${label}: not fully checked`);
  assert.equal(metrics.connected, true, `${label}: not connected`);
  assert.equal(metrics.articulationPoints.length, 0, `${label}: has an articulation point`);
  assert.equal(metrics.hasTwoByTwoBlack, false, `${label}: has a 2x2 black block`);
  assert.ok(metrics.blackCount <= maxBlackCells(9), `${label}: ${metrics.blackCount} black cells`);
  assert.equal(metrics.minimumRun >= 3, true, `${label}: has a run shorter than three`);
  assert.ok(metrics.entryCount >= americanRules[9].minimumEntryCount, `${label}: only ${metrics.entryCount} entries`);

  // Every declared white cell carries a letter: an uncovered run must never be converted
  // into a black square behind the catalog's back.
  assert.equal(puzzle.entries.length, metrics.entryCount, `${label}: entry count differs from the mask`);
  const answers = puzzle.entries.map(({answer}) => answer);
  assert.equal(new Set(answers).size, answers.length, `${label}: duplicate answers`);

  const coverage = Array.from({length: 9}, () => Array.from({length: 9}, () => 0));
  for (const entry of puzzle.entries) {
    assert.match(entry.answer, /^[A-Z]{3,9}$/, `${label}: ${entry.answer}`);
    assert.ok(entry.clue && entry.clue.length > 0, `${label}: ${entry.answer} has no clue`);
    assert.ok(entry.number > 0, `${label}: ${entry.answer} has no number`);
    for (let index = 0; index < entry.answer.length; index += 1) {
      const row = entry.row + (entry.direction === 'down' ? index : 0);
      const col = entry.col + (entry.direction === 'across' ? index : 0);
      assert.equal(puzzle.grid[row][col], entry.answer[index], `${label}: ${entry.answer} disagrees at ${row},${col}`);
      coverage[row][col] += 1;
    }
  }
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const expected = mask[row][col] === '#' ? 0 : 2;
      assert.equal(coverage[row][col], expected, `${label}: cell ${row},${col} is covered ${coverage[row][col]} times`);
    }
  }

  return {pattern, mask};
}

test('every built-in theme produces a valid American 9x9 grid', () => {
  supportedThemes.forEach((theme, index) => {
    const difficulty = DIFFICULTIES[index % DIFFICULTIES.length];
    const puzzle = build(theme, difficulty);

    assertAmericanPuzzle(puzzle, `${theme}/${difficulty}`);
    assert.equal(puzzle.theme, theme);
  });
});

test('a featured rotational pair of theme entries is placed in prominent slots', () => {
  for (const theme of supportedThemes.slice(0, 5)) {
    const puzzle = build(theme, 'medium');
    const {mask} = assertAmericanPuzzle(puzzle, theme);
    const metrics = analyzeMask(mask);

    const themed = puzzle.entries.filter(({isTheme}) => isTheme);
    assert.ok(themed.length >= 2, `${theme}: ${themed.length} featured entries`);

    const featured = new Set(americanThemeWords[theme].map(({answer}) => answer));
    for (const entry of themed) assert.ok(featured.has(entry.answer), `${theme}: ${entry.answer} is not a curated featured entry`);

    // The pair occupies rotationally corresponding slots of the same length.
    const indexOf = (entry) => metrics.entries.findIndex((slot) =>
      slot.row === entry.row && slot.col === entry.col && slot.direction === entry.direction);
    const themedIndexes = new Set(themed.map(indexOf));
    const paired = metrics.symmetricPairs.some(([first, second]) => themedIndexes.has(first) && themedIndexes.has(second));
    assert.ok(paired, `${theme}: the featured entries are not a rotational pair`);

    assert.ok(themed.every(({answer}) => answer.length >= 5), `${theme}: a featured entry is shorter than five letters`);
    // American replaces the strict thematic majority with prominence, so most of the grid
    // is deliberately general fill.
    assert.ok(themed.length <= puzzle.entries.length / 2, `${theme}: American should not require a themed majority`);
  }
});

test('every answer comes from the curated tier, never raw dictionary material', () => {
  const eligible = new Set([
    ...fillWords.map(({answer}) => answer),
    ...themedPlurals.map(({answer}) => answer),
    ...americanFillWords.map(({answer}) => answer),
    ...supportedThemes.flatMap((theme) => americanThemeWords[theme].map(({answer}) => answer)),
  ]);

  for (const theme of supportedThemes.slice(0, 4)) {
    const puzzle = build(theme, 'hard');
    for (const {answer} of puzzle.entries) {
      assert.ok(eligible.has(answer), `${theme}: ${answer} is not production-eligible`);
    }
  }
});

// Comparing two puzzles' shared answers is too fragile to assert this: different
// difficulties pick different masks, and the handful of answers they happen to share can
// all come from the legacy bank, which carries a single clue. Check the mechanism instead —
// every answer that HAS variants must use the one for the requested difficulty.
test('an answer with clue variants is clued for the requested difficulty', () => {
  // Scoped to the theme being generated: an answer can be featured in more than one theme
  // with a different, theme-appropriate clue in each, which is deliberate.
  const variants = new Map([...americanFillWords, ...americanThemeWords.nature].map(({answer, clue}) => [answer, clue]));

  for (const difficulty of DIFFICULTIES) {
    const puzzle = build('nature', difficulty);
    const checked = puzzle.entries.filter(({answer}) => variants.has(answer));

    assert.ok(checked.length > 0, `${difficulty}: no entry came from the curated tier`);
    for (const entry of checked) {
      assert.equal(entry.clue, variants.get(entry.answer)[difficulty], `${difficulty}: ${entry.answer} used the wrong clue variant`);
    }
  }
});

test('a used answer set is rejected, so regeneration is fresh', () => {
  const first = build('ocean', 'medium');
  const second = build('ocean', 'medium', {history: [{answers: first.entries.map(({answer}) => answer)}]});

  const signature = (puzzle) => puzzle.entries.map(({answer}) => answer).sort().join('|');
  assert.notEqual(signature(second), signature(first));
  assertAmericanPuzzle(second, 'ocean/fresh');
});

test('a theme without a usable anchor pair fails with its own error code', () => {
  assert.throws(
    () => build('a custom theme', 'medium', {themeWords: [{answer: 'ZZZ', clue: 'Nothing'}]}),
    (error) => {
      assert.equal(error.code, 'american-theme-anchors-insufficient');
      return true;
    }
  );
});

test('an exhausted deadline reports itself instead of returning a partial grid', () => {
  assert.throws(
    () => build('nature', 'medium', {timeLimitMs: -1}),
    (error) => {
      assert.equal(error.code, 'american-deadline-exceeded');
      return true;
    }
  );
});

test('an unsupported size is refused at the generator boundary', () => {
  assert.throws(
    () => generateAmerican({size: 13, difficulty: 'medium', theme: 'nature', themeCategory: 'nature', history: [], random: Math.random, deadline: Date.now() + 1000}),
    (error) => {
      assert.equal(error.code, 'layout-size-unsupported');
      return true;
    }
  );
});

test('a seeded 9x9 fill completes well inside the worker dispatch envelope', () => {
  const started = Date.now();
  const puzzle = build('space', 'medium');
  const elapsed = Date.now() - started;

  assertAmericanPuzzle(puzzle, 'space/timing');
  assert.ok(elapsed < BUDGET_MS, `fill took ${elapsed}ms`);
});
