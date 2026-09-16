// Structural analysis of a black-square mask, shared by the American catalog, the
// American generator's runtime assertions, and the offline pattern spike. Everything
// here is recomputed from the raw mask: declared catalog metadata is never trusted, and
// short runs are visible here even though `makeSlots()` in dense.js drops them.

const BLACK = '#';
const DIRECTIONS = [
  {direction: 'across', rowStep: 0, colStep: 1},
  {direction: 'down', rowStep: 1, colStep: 0},
];

// The classic "about 16%" guideline, applied as a hard ceiling.
export const BLACK_RATIO_CEILING = 0.16;

// The 16% figure is a 15x15 convention, where it still leaves plenty of short entries. On
// a 9x9 it is punishing: of the 3,210 legal masks within 13 black cells, all but two carry
// a nine-letter answer spanning the whole grid, and a curated vocabulary cannot fill those
// acceptably. A 9x9 therefore gets its own measured ceiling, which admits twenty masks
// whose longest entry is six letters — every one of them demonstrably fillable.
const SIZE_BLACK_CEILINGS = Object.freeze({9: 19});

export function maxBlackCells(size) {
  return SIZE_BLACK_CEILINGS[size] ?? Math.round(size * size * BLACK_RATIO_CEILING);
}

function isBlack(mask, row, col) {
  return mask[row][col] === BLACK;
}

function cellsFor(row, col, direction, length) {
  const step = DIRECTIONS.find((entry) => entry.direction === direction);
  return Array.from({length}, (_, index) => ({
    row: row + step.rowStep * index,
    col: col + step.colStep * index,
  }));
}

// Every maximal white run in both directions, including the one- and two-cell runs that
// never become answers. Callers that want answers filter on `length >= 3`.
export function maskRuns(mask) {
  const size = mask.length;
  const runs = [];

  for (const {direction, rowStep, colStep} of DIRECTIONS) {
    for (let line = 0; line < size; line += 1) {
      let index = 0;
      while (index < size) {
        const row = rowStep ? index : line;
        const col = rowStep ? line : index;
        if (isBlack(mask, row, col)) {
          index += 1;
          continue;
        }

        let end = index;
        while (end < size && !isBlack(mask, rowStep ? end : line, rowStep ? line : end)) end += 1;
        const length = end - index;
        runs.push({row, col, direction, length, cells: cellsFor(row, col, direction, length)});
        index = end;
      }
    }
  }

  return runs;
}

export function entriesFromMask(mask) {
  return maskRuns(mask).filter(({length}) => length >= 3);
}

export function minimumRun(mask) {
  const lengths = maskRuns(mask).map(({length}) => length);
  return lengths.length ? Math.min(...lengths) : 0;
}

export function whiteCells(mask) {
  const cells = [];
  mask.forEach((line, row) => [...line].forEach((cell, col) => {
    if (cell !== BLACK) cells.push({row, col});
  }));

  return cells;
}

// White cells that no answer covers. `solvePattern` leaves these blank and grid assembly
// turns them into black squares, which silently changes the mask a puzzle claims to use.
export function uncoveredWhiteCells(mask) {
  const coverage = new Map();
  for (const entry of entriesFromMask(mask)) {
    for (const {row, col} of entry.cells) {
      const key = `${row},${col}`;
      coverage.set(key, (coverage.get(key) ?? 0) + 1);
    }
  }

  return whiteCells(mask).filter(({row, col}) => coverage.get(`${row},${col}`) !== 2);
}

export function isFullyChecked(mask) {
  return uncoveredWhiteCells(mask).length === 0;
}

export function isRotationallySymmetric(mask) {
  const size = mask.length;
  return mask.every((line, row) => [...line].every((cell, col) =>
    cell === mask[size - 1 - row][size - 1 - col]));
}

export function hasTwoByTwoBlack(mask) {
  const size = mask.length;
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      if (isBlack(mask, row, col) && isBlack(mask, row, col + 1)
        && isBlack(mask, row + 1, col) && isBlack(mask, row + 1, col + 1)) return true;
    }
  }

  return false;
}

export function adjacentBlackPairs(mask) {
  const size = mask.length;
  let pairs = 0;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!isBlack(mask, row, col)) continue;
      if (col + 1 < size && isBlack(mask, row, col + 1)) pairs += 1;
      if (row + 1 < size && isBlack(mask, row + 1, col)) pairs += 1;
    }
  }

  return pairs;
}

function componentCount(mask, skipRow = -1, skipCol = -1) {
  const open = new Set(whiteCells(mask)
    .filter(({row, col}) => !(row === skipRow && col === skipCol))
    .map(({row, col}) => `${row},${col}`));
  if (!open.size) return 0;

  const seen = new Set();
  let components = 0;
  for (const start of open) {
    if (seen.has(start)) continue;
    components += 1;

    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const [row, col] = stack.pop().split(',').map(Number);
      for (const [rowStep, colStep] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${row + rowStep},${col + colStep}`;
        if (open.has(key) && !seen.has(key)) {
          seen.add(key);
          stack.push(key);
        }
      }
    }
  }

  return components;
}

export function isConnected(mask) {
  return componentCount(mask) === 1;
}

// A cell whose removal splits the white region. These are the single-cell necks that make
// a layout "technically connected" without being all-over interlocked.
export function articulationPoints(mask) {
  if (!isConnected(mask)) return [];
  return whiteCells(mask).filter(({row, col}) => componentCount(mask, row, col) > 1);
}

// Symmetric black-cell pairs whose removal leaves the answer count unchanged: the classic
// "cheater" blocks, which make filling easier without creating a word boundary.
export function cheaterPairs(mask) {
  const size = mask.length;
  const baseline = entriesFromMask(mask).length;
  let cheaters = 0;

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!isBlack(mask, row, col)) continue;
      const mateRow = size - 1 - row;
      const mateCol = size - 1 - col;
      if (mateRow * size + mateCol < row * size + col) continue;

      const opened = mask.map((line, lineRow) => [...line].map((cell, lineCol) =>
        ((lineRow === row && lineCol === col) || (lineRow === mateRow && lineCol === mateCol)) ? '.' : cell).join(''));
      if (entriesFromMask(opened).length === baseline) cheaters += 1;
    }
  }

  return cheaters;
}

// Index pairs of entries that map onto each other under a 180-degree rotation. An entry
// that rotates onto itself has no partner and is reported separately as a centre entry.
function symmetricEntryPairs(mask, entries) {
  const size = mask.length;
  const keyFor = (entry) => entry.cells.map(({row, col}) => `${row},${col}`).sort().join(' ');
  const byKey = new Map(entries.map((entry, index) => [keyFor(entry), index]));
  const pairs = [];
  const centres = [];

  entries.forEach((entry, index) => {
    const rotated = entry.cells
      .map(({row, col}) => `${size - 1 - row},${size - 1 - col}`)
      .sort()
      .join(' ');
    const mate = byKey.get(rotated);
    if (mate === undefined) return;
    if (mate === index) centres.push(index);
    else if (index < mate) pairs.push([index, mate]);
  });

  return {pairs, centres};
}

export function analyzeMask(mask) {
  const size = mask.length;
  const entries = entriesFromMask(mask);
  const lengths = entries.map(({length}) => length).sort((a, b) => a - b);
  const blackCount = mask.reduce((sum, line) => sum + [...line].filter((cell) => cell === BLACK).length, 0);
  const across = entries.filter(({direction}) => direction === 'across');
  const down = entries.filter(({direction}) => direction === 'down');
  const uncovered = uncoveredWhiteCells(mask);
  const white = whiteCells(mask).length;
  const {pairs, centres} = symmetricEntryPairs(mask, entries);

  const middle = lengths.length >> 1;
  const median = lengths.length % 2
    ? lengths[middle]
    : (lengths[middle - 1] + lengths[middle]) / 2;

  return {
    size,
    entries,
    entryCount: entries.length,
    blackCount,
    blackRatio: blackCount / (size * size),
    lengthHistogram: lengths.reduce((histogram, length) => {
      histogram[length] = (histogram[length] ?? 0) + 1;
      return histogram;
    }, {}),
    averageEntryLength: lengths.reduce((sum, length) => sum + length, 0) / (lengths.length || 1),
    medianEntryLength: lengths.length ? median : 0,
    maxEntryLength: lengths.length ? lengths[lengths.length - 1] : 0,
    longestAcross: across.length ? Math.max(...across.map(({length}) => length)) : 0,
    longestDown: down.length ? Math.max(...down.map(({length}) => length)) : 0,
    threeLetterCount: lengths.filter((length) => length === 3).length,
    threeLetterShare: lengths.length ? lengths.filter((length) => length === 3).length / lengths.length : 0,
    minimumRun: minimumRun(mask),
    fullyChecked: uncovered.length === 0,
    checkedRatio: white ? (white - uncovered.length) / white : 0,
    uncoveredWhiteCells: uncovered,
    connected: isConnected(mask),
    articulationPoints: articulationPoints(mask),
    hasTwoByTwoBlack: hasTwoByTwoBlack(mask),
    adjacentBlackPairs: adjacentBlackPairs(mask),
    cheaterPairs: cheaterPairs(mask),
    symmetricPairs: pairs,
    centreEntries: centres,
  };
}

// Returns the stable names of every hard rule the mask fails, in a fixed order, so both
// the catalog test and the spike script report failures the same way.
export function validateAmericanMask(mask, {maxEntryLength, minimumEntryCount} = {}) {
  const failures = [];
  if (!Array.isArray(mask) || !mask.length || mask.some((line) => line.length !== mask.length)) return ['shape'];

  const metrics = analyzeMask(mask);
  if (!isRotationallySymmetric(mask)) failures.push('symmetry');
  if (metrics.blackCount > maxBlackCells(metrics.size)) failures.push('black-ratio');
  if (metrics.minimumRun < 3) failures.push('minimum-run');
  if (metrics.uncoveredWhiteCells.length) failures.push('uncovered-white-cells');
  if (!metrics.fullyChecked) failures.push('not-fully-checked');
  if (!metrics.connected) failures.push('disconnected');
  if (metrics.articulationPoints.length) failures.push('articulation-point');
  if (metrics.hasTwoByTwoBlack) failures.push('two-by-two-black');
  if (Number.isFinite(maxEntryLength) && metrics.maxEntryLength > maxEntryLength) failures.push('max-entry-length');
  if (Number.isFinite(minimumEntryCount) && metrics.entryCount < minimumEntryCount) failures.push('minimum-entry-count');

  return failures;
}
