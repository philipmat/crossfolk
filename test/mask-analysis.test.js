import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeMask,
  articulationPoints,
  hasTwoByTwoBlack,
  isConnected,
  isRotationallySymmetric,
  maskRuns,
  minimumRun,
  uncoveredWhiteCells,
  validateAmericanMask,
} from '../public/layouts/mask-analysis.js';

// A legal 9x9 American mask: rotationally symmetric, 13 black cells, every white cell
// in one across and one down entry, and no entry longer than six letters.
const LEGAL_9 = [
  '.....#...',
  '.....#...',
  '.....#...',
  '###......',
  '....#....',
  '......###',
  '...#.....',
  '...#.....',
  '...#.....',
];

const OPEN_9 = Array.from({length: 9}, () => '.........');
const RULES = {maxEntryLength: 9, minimumEntryCount: 20};

test('rotational symmetry is measured against the 180-degree rotation', () => {
  assert.equal(isRotationallySymmetric(LEGAL_9), true);
  assert.equal(isRotationallySymmetric(['.#.', '...', '...']), false);
  assert.equal(isRotationallySymmetric(['.#.', '...', '.#.']), true);
});

test('runs come from the raw mask, including the short runs makeSlots drops', () => {
  const lengths = maskRuns(['#.#', '...', '#.#']).map(({length}) => length).sort();

  assert.deepEqual(lengths, [1, 1, 1, 1, 3, 3]);
  assert.equal(minimumRun(['#.#', '...', '#.#']), 1);
  assert.equal(minimumRun(LEGAL_9), 3);
});

test('a white cell outside every three-cell run is reported rather than silently blacked out', () => {
  // The four cells around the centre block sit in one- or two-cell runs, so `makeSlots`
  // emits no slot for them and the solver would turn them into black squares.
  assert.deepEqual(uncoveredWhiteCells(['...', '.#.', '...']), [
    {row: 0, col: 1},
    {row: 1, col: 0},
    {row: 1, col: 2},
    {row: 2, col: 1},
  ]);
  assert.deepEqual(uncoveredWhiteCells(LEGAL_9), []);
});

test('two-by-two black blocks are rejected while adjacent black bars are allowed', () => {
  assert.equal(hasTwoByTwoBlack(['##.', '##.', '...']), true);
  assert.equal(hasTwoByTwoBlack(['##.', '...', '...']), false);
  assert.equal(hasTwoByTwoBlack(LEGAL_9), false);
});

test('connectivity and articulation points are both checked', () => {
  assert.equal(isConnected(['..#..', '..#..', '..#..', '..#..', '..#..']), false);
  assert.equal(isConnected(LEGAL_9), true);

  // Two blocks joined only through the middle row: every cell of that neck is an
  // articulation point, so "technically connected" does not pass.
  const neck = ['..#..', '..#..', '.....', '..#..', '..#..'];
  assert.equal(isConnected(neck), true);
  assert.ok(articulationPoints(neck).some(({row, col}) => row === 2 && col === 2));
  assert.deepEqual(articulationPoints(LEGAL_9), []);
});

test('analyzeMask recomputes every declared metric from the mask', () => {
  const metrics = analyzeMask(LEGAL_9);
  const lengths = metrics.entries.map(({length}) => length);

  assert.equal(metrics.size, 9);
  assert.equal(metrics.blackCount, 13);
  assert.equal(metrics.blackRatio, 13 / 81);
  assert.equal(metrics.entryCount, 32);
  assert.equal(metrics.maxEntryLength, 6);
  assert.equal(metrics.longestAcross, 6);
  assert.equal(metrics.longestDown, 6);
  assert.equal(metrics.threeLetterCount, 12);
  assert.equal(metrics.threeLetterShare, 12 / 32);
  assert.deepEqual(metrics.lengthHistogram, {3: 12, 4: 4, 5: 12, 6: 4});
  assert.equal(metrics.averageEntryLength, lengths.reduce((sum, value) => sum + value, 0) / 32);
  assert.equal(metrics.medianEntryLength, 4.5);
  assert.equal(metrics.fullyChecked, true);
  assert.equal(metrics.checkedRatio, 1);
  assert.equal(metrics.minimumRun, 3);
  assert.equal(metrics.connected, true);
  assert.deepEqual(metrics.articulationPoints, []);
  assert.equal(metrics.hasTwoByTwoBlack, false);
  assert.equal(typeof metrics.adjacentBlackPairs, 'number');
  assert.equal(typeof metrics.cheaterPairs, 'number');

  const histogramTotal = Object.values(metrics.lengthHistogram).reduce((sum, count) => sum + count, 0);
  assert.equal(histogramTotal, metrics.entryCount);
});

test('symmetric rotational entry pairs are reported for theme placement', () => {
  const {entries, symmetricPairs} = analyzeMask(LEGAL_9);

  const cellKeys = (entry) => entry.cells.map(({row, col}) => `${row},${col}`).sort().join(' ');
  const rotatedKeys = (entry) => entry.cells.map(({row, col}) => `${8 - row},${8 - col}`).sort().join(' ');

  assert.ok(symmetricPairs.length > 0);
  for (const [first, second] of symmetricPairs) {
    assert.notEqual(first, second);
    assert.equal(entries[first].length, entries[second].length);
    assert.equal(entries[first].direction, entries[second].direction);
    // The pair maps onto itself under a 180-degree rotation of the grid.
    assert.equal(rotatedKeys(entries[first]), cellKeys(entries[second]));
  }
});

test('validateAmericanMask names every rule it fails', () => {
  assert.deepEqual(validateAmericanMask(LEGAL_9, RULES), []);

  const asymmetric = LEGAL_9.map((line, row) => (row === 0 ? `#${line.slice(1)}` : line));
  assert.ok(validateAmericanMask(asymmetric, RULES).includes('symmetry'));

  const tooMuchBlack = [
    '###.#.###',
    '###.#.###',
    '...#.#...',
    '.........',
    '####.####',
    '.........',
    '...#.#...',
    '###.#.###',
    '###.#.###',
  ];
  assert.ok(validateAmericanMask(tooMuchBlack, RULES).includes('black-ratio'));

  assert.ok(validateAmericanMask(OPEN_9, {...RULES, maxEntryLength: 8}).includes('max-entry-length'));
  assert.ok(validateAmericanMask(OPEN_9, RULES).includes('minimum-entry-count'));

  const shortRun = ['...', '.#.', '...'];
  const failures = validateAmericanMask(shortRun, {maxEntryLength: 3, minimumEntryCount: 0});
  assert.ok(failures.includes('minimum-run'));
  assert.ok(failures.includes('uncovered-white-cells'));
});
