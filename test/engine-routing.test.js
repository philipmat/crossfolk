import test from 'node:test';
import assert from 'node:assert/strict';

import {generatePuzzle} from '../public/engine.js';
import {LAYOUT_VERSION} from '../public/layouts/registry.js';

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

test('an omitted layout style is the legacy Free-form path', () => {
  const puzzle = generatePuzzle({theme: 'ocean', size: 9, difficulty: 'medium', random: seededRandom('ocean/9/medium')});

  assert.equal(puzzle.layoutStyle, 'freeform');
  assert.equal(puzzle.layoutVersion, LAYOUT_VERSION);
});

test('every new result carries the current layout version, including greedy Free form', () => {
  // A 5x5 hard puzzle for a theme with a small bank exercises the fallback tail.
  for (const size of [5, 9, 13]) {
    const puzzle = generatePuzzle({theme: 'garden', size, difficulty: 'hard', layoutStyle: 'freeform', random: seededRandom(`garden/${size}/hard`)});

    assert.equal(puzzle.layoutStyle, 'freeform', `${size}: style`);
    assert.equal(puzzle.layoutVersion, LAYOUT_VERSION, `${size}: version`);
  }
});

test('an American request at a supported size returns an American puzzle', () => {
  const puzzle = generatePuzzle({theme: 'space', size: 9, difficulty: 'medium', layoutStyle: 'american', random: seededRandom('space/9/american')});

  assert.equal(puzzle.layoutStyle, 'american');
  assert.equal(puzzle.layoutVersion, LAYOUT_VERSION);
  assert.equal(puzzle.size, 9);

  // Fully checked: every playable cell belongs to one Across and one Down answer. The
  // 60/80/90% Free-form crossing targets do not apply to this path.
  const coverage = new Map();
  for (const entry of puzzle.entries) {
    for (let index = 0; index < entry.answer.length; index += 1) {
      const row = entry.row + (entry.direction === 'down' ? index : 0);
      const col = entry.col + (entry.direction === 'across' ? index : 0);
      coverage.set(`${row},${col}`, (coverage.get(`${row},${col}`) ?? 0) + 1);
    }
  }
  const playable = puzzle.grid.flat().filter(Boolean).length;
  assert.equal(coverage.size, playable);
  assert.ok([...coverage.values()].every((count) => count === 2), 'American grids are 100% checked');
});

test('American at an unsupported size is refused rather than reinterpreted', () => {
  for (const size of [5, 13]) {
    assert.throws(
      () => generatePuzzle({theme: 'space', size, difficulty: 'medium', layoutStyle: 'american', random: seededRandom('x')}),
      (error) => {
        assert.equal(error.code, 'layout-size-unsupported', `size ${size}`);
        return true;
      }
    );
  }
});

test('an unknown layout style is refused rather than silently mapped', () => {
  assert.throws(
    () => generatePuzzle({theme: 'space', size: 9, difficulty: 'medium', layoutStyle: 'creative-shape', random: seededRandom('x')}),
    (error) => {
      assert.equal(error.code, 'layout-style-unknown');
      return true;
    }
  );
});

test('an American failure never returns a Free-form grid', () => {
  // A custom theme with no usable anchor pair: American must report it, not quietly
  // produce the open layout the selector did not ask for.
  assert.throws(
    () => generatePuzzle({
      theme: 'an extremely narrow custom theme',
      size: 9,
      difficulty: 'medium',
      layoutStyle: 'american',
      words: [{answer: 'ZZZ', clue: 'Nothing'}, {answer: 'QQQ', clue: 'Nothing'}, {answer: 'XXX', clue: 'Nothing'}],
      random: seededRandom('narrow'),
    }),
    (error) => {
      assert.match(error.code, /^american-/);
      return true;
    }
  );
});
