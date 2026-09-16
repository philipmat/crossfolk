import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {generatePuzzle} from '../public/engine.js';
import {createSolver, isFullyChecked, makeSlots, normalizeWords, numberEntries, readHistory} from '../public/dense.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const fixture = JSON.parse(await readFile(resolve(ROOT, 'test/fixtures/freeform-seeded.json'), 'utf8'));

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

function importsOf(source) {
  return [...source.matchAll(/^\s*import[^;]*?from\s+'([^']+)'/gm)].map(([, specifier]) => specifier);
}

test('the recorded seeded Free-form puzzles are reproduced exactly', () => {
  assert.ok(fixture.length >= 12, 'the parity fixture should cover both sizes across every built-in theme');

  for (const {theme, size, difficulty, seed, puzzle} of fixture) {
    const produced = generatePuzzle({theme, size, difficulty, random: seededRandom(seed)});

    assert.deepEqual(
      {size: produced.size, theme: produced.theme, layoutVersion: produced.layoutVersion ?? null, grid: produced.grid, entries: produced.entries},
      puzzle,
      `${seed} changed`
    );
  }
});

test('omitting layoutStyle and asking for freeform produce the same seeded puzzle', () => {
  for (const {theme, size, difficulty, seed} of fixture.slice(0, 6)) {
    const omitted = generatePuzzle({theme, size, difficulty, random: seededRandom(seed)});
    const explicit = generatePuzzle({theme, size, difficulty, layoutStyle: 'freeform', random: seededRandom(seed)});

    assert.deepEqual(explicit.grid, omitted.grid, `${seed} grid`);
    assert.deepEqual(explicit.entries, omitted.entries, `${seed} entries`);
  }
});

test('dense.js exposes a style-neutral constraint-solving surface', () => {
  assert.equal(typeof makeSlots, 'function');
  assert.equal(typeof numberEntries, 'function');
  assert.equal(typeof isFullyChecked, 'function');
  assert.equal(typeof normalizeWords, 'function');
  assert.equal(typeof readHistory, 'function');
  assert.equal(typeof createSolver, 'function');

  const pattern = ['...', '...', '...'];
  const words = normalizeWords([
    {answer: 'CAT', clue: 'Pet'}, {answer: 'ARE', clue: 'Exist'}, {answer: 'TEA', clue: 'Brew'},
    {answer: 'CAT', clue: 'Pet'}, {answer: 'ART', clue: 'Craft'}, {answer: 'RET', clue: 'Soak'},
    {answer: 'TEA', clue: 'Brew'}, {answer: 'EAT', clue: 'Dine'}, {answer: 'ATE', clue: 'Dined'},
  ], false, 'medium', 3, () => 0.5);

  const solver = createSolver(pattern, words, {history: readHistory([])});
  assert.equal(solver.slots.length, makeSlots(pattern).length);

  // The core searches without any theme anchor, which the Free-form driver used to require.
  const solved = solver.search({stop: () => false});
  assert.equal(solved, true);
  const {grid, entries} = solver.result();
  assert.equal(grid.length, 3);
  assert.equal(entries.length, 6);
  assert.ok(entries.every(({number}) => number > 0));
});

test('the solver stops when its injected predicate says so', () => {
  const pattern = ['...', '...', '...'];
  const words = normalizeWords([{answer: 'CAT', clue: 'Pet'}], false, 'medium', 3, () => 0.5);
  const solver = createSolver(pattern, words, {history: readHistory([])});

  assert.equal(solver.search({stop: () => true}), false);
});

test('Free-form policy lives in the Free-form driver, not the shared solver', async () => {
  const dense = await readFile(resolve(ROOT, 'public/dense.js'), 'utf8');
  const freeform = await readFile(resolve(ROOT, 'public/layouts/freeform.js'), 'utf8');
  const engine = await readFile(resolve(ROOT, 'public/engine.js'), 'utf8');

  // The anchor loop, the themed-majority quota and the hard-coded per-attempt slice are
  // Free-form decisions; leaving them in dense.js would make them American defaults too.
  for (const marker of ['quotaSlots', 'requiredThemed', 'miniPatterns', 'denseFallbacks']) {
    assert.ok(!dense.includes(marker), `dense.js should not contain ${marker}`);
  }
  assert.ok(freeform.includes('quotaSlots'), 'freeform.js owns the themed quota');

  assert.deepEqual(importsOf(dense), [], 'dense.js imports no style, pattern bank or registry module');
  assert.ok(importsOf(freeform).includes('../dense.js'), 'freeform.js drives the shared solver');
  assert.ok(!importsOf(engine).some((specifier) => specifier.includes('dense-fallbacks') || specifier.includes('mini-patterns')));
});
