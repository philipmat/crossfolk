// Regenerates public/layouts/american-patterns.js.
//
// Enumerates every rotationally symmetric 9x9 black-square mask within the style's hard
// ceiling, keeps the ones that pass `validateAmericanMask`, then selects a diverse,
// fillable catalog. Run it with:
//
//   node scripts/build-american-patterns.mjs
//
// The exhaustive enumeration takes a couple of minutes. Its result is deterministic, so
// the committed module should only change when the rules below change.

import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {analyzeMask, maxBlackCells, validateAmericanMask} from '../public/layouts/mask-analysis.js';

const SIZE = 9;
const RULES = {maxEntryLength: 9, minimumEntryCount: 26};
const CATALOG_VERSION = 'american-catalog-9x9-v1';
const TARGET_PATTERNS = 16;
const MAX_PER_SIGNATURE = 3;

// The curated general-fill tier thins out at nine letters, so a mask that stacks several
// of them is admissible but a poor first choice.
const MAX_NINE_LETTER_ENTRIES = 2;
const THEME_SLOT_LENGTHS = [5, 6, 7];

const OUTPUT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'public', 'layouts', 'american-patterns.js');

function maskFrom(black) {
  return Array.from({length: SIZE}, (_, row) =>
    Array.from({length: SIZE}, (_, col) => (black.has(row * SIZE + col) ? '#' : '.')).join(''));
}

// Cheap structural rejections, applied during the search so the exhaustive walk stays
// affordable. `validateAmericanMask` re-checks everything on the survivors.
function plausible(mask) {
  for (let line = 0; line < SIZE; line += 1) {
    let across = 0;
    let down = 0;
    for (let index = 0; index <= SIZE; index += 1) {
      const acrossBlack = index === SIZE || mask[line][index] === '#';
      if (acrossBlack) {
        if (across > 0 && across < 3) return false;
        across = 0;
      } else across += 1;

      const downBlack = index === SIZE || mask[index][line] === '#';
      if (downBlack) {
        if (down > 0 && down < 3) return false;
        down = 0;
      } else down += 1;
    }
  }

  for (let row = 0; row < SIZE - 1; row += 1) {
    for (let col = 0; col < SIZE - 1; col += 1) {
      if (mask[row][col] === '#' && mask[row][col + 1] === '#'
        && mask[row + 1][col] === '#' && mask[row + 1][col + 1] === '#') return false;
    }
  }

  return true;
}

function enumerateMasks() {
  const limit = maxBlackCells(SIZE);
  const pairs = [];
  for (let cell = 0; cell < SIZE * SIZE; cell += 1) {
    const mate = (SIZE * SIZE) - 1 - cell;
    if (cell <= mate) pairs.push([cell, mate]);
  }

  const found = [];
  const walk = (index, black) => {
    if (index === pairs.length) {
      const mask = maskFrom(black);
      if (plausible(mask) && validateAmericanMask(mask, RULES).length === 0) found.push(mask);
      return;
    }

    walk(index + 1, black);
    const [cell, mate] = pairs[index];
    const added = cell === mate ? 1 : 2;
    if (black.size + added <= limit) {
      const next = new Set(black);
      next.add(cell);
      next.add(mate);
      walk(index + 1, next);
    }
  };
  walk(0, new Set());

  return found;
}

function describe(mask, index) {
  const metrics = analyzeMask(mask);
  const themeSlots = metrics.symmetricPairs
    .filter(([first]) => THEME_SLOT_LENGTHS.includes(metrics.entries[first].length))
    .sort((a, b) => metrics.entries[b[0]].length - metrics.entries[a[0]].length);

  return {
    id: `us9-${String(index + 1).padStart(2, '0')}`,
    size: SIZE,
    mask,
    blackCount: metrics.blackCount,
    entryCount: metrics.entryCount,
    maxEntryLength: metrics.maxEntryLength,
    threeLetterCount: metrics.threeLetterCount,
    averageEntryLength: Number(metrics.averageEntryLength.toFixed(3)),
    lengthHistogram: metrics.lengthHistogram,
    cheaterPairs: metrics.cheaterPairs,
    adjacentBlackPairs: metrics.adjacentBlackPairs,
    themeSlots: themeSlots.slice(0, 3),
    themeSlotLengths: themeSlots.slice(0, 3).map(([first]) => metrics.entries[first].length),
  };
}

// Prefer masks that the curated vocabulary can actually fill: many entries, few very long
// ones, few cheaters, and no large black clusters.
function fillability(record) {
  const nines = record.lengthHistogram[9] ?? 0;
  const eights = record.lengthHistogram[8] ?? 0;
  return record.entryCount * 2 - nines * 9 - eights * 3 - record.cheaterPairs * 4 - record.adjacentBlackPairs;
}

function selectCatalog(records) {
  const eligible = records
    .filter((record) => (record.lengthHistogram[9] ?? 0) <= MAX_NINE_LETTER_ENTRIES)
    .filter((record) => record.themeSlots.length > 0)
    .sort((left, right) => fillability(right) - fillability(left));

  // One mask per shape signature keeps the catalog visually varied instead of collecting
  // near-identical rearrangements of the same block layout.
  const chosen = [];
  const seen = new Map();
  for (const record of eligible) {
    const signature = `${record.blackCount}:${JSON.stringify(record.lengthHistogram)}:${record.themeSlotLengths.join('-')}`;
    const taken = seen.get(signature) ?? 0;
    if (taken >= MAX_PER_SIGNATURE) continue;
    seen.set(signature, taken + 1);
    chosen.push(record);
    if (chosen.length === TARGET_PATTERNS) break;
  }

  return chosen;
}

function render(records) {
  const entries = records.map((record) => `  {
    id: '${record.id}',
    size: ${record.size},
    mask: [
${record.mask.map((line) => `      '${line}',`).join('\n')}
    ],
    blackCount: ${record.blackCount},
    entryCount: ${record.entryCount},
    maxEntryLength: ${record.maxEntryLength},
    threeLetterCount: ${record.threeLetterCount},
    averageEntryLength: ${record.averageEntryLength},
    lengthHistogram: ${JSON.stringify(record.lengthHistogram)},
    cheaterPairs: ${record.cheaterPairs},
    adjacentBlackPairs: ${record.adjacentBlackPairs},
    themeSlots: [${record.themeSlots.map((pair) => `[${pair.join(', ')}]`).join(', ')}],
    themeSlotLengths: [${record.themeSlotLengths.join(', ')}],
  },`).join('\n');

  return `// Generated by scripts/build-american-patterns.mjs. Do not edit by hand.
//
// Audited American black-square masks. Every mask here passed \`validateAmericanMask\` at
// generation time and is re-validated from the raw mask by test/american-patterns.test.js,
// so the metadata below is a convenience for ranking, never a source of truth.
//
// 13x13 is deliberately absent: it has not passed its own fill and timing gate.

export const AMERICAN_CATALOG_VERSION = '${CATALOG_VERSION}';

export const americanSupportedSizes = Object.freeze([${SIZE}]);

export const americanRules = Object.freeze({
  ${SIZE}: Object.freeze({maxEntryLength: ${RULES.maxEntryLength}, minimumEntryCount: ${RULES.minimumEntryCount}}),
});

const PATTERNS = [
${entries}
];

export const americanPatterns = Object.freeze(PATTERNS.map((pattern) => Object.freeze({
  ...pattern,
  mask: Object.freeze(pattern.mask),
  themeSlots: Object.freeze(pattern.themeSlots.map(Object.freeze)),
  themeSlotLengths: Object.freeze(pattern.themeSlotLengths),
  lengthHistogram: Object.freeze(pattern.lengthHistogram),
})));

// Difficulty reorders the same pool; it never removes a valid pattern, so a hard puzzle
// can still fall back to an easier-shaped mask rather than failing to generate.
const RANKERS = {
  easy: (left, right) => right.threeLetterCount - left.threeLetterCount
    || left.averageEntryLength - right.averageEntryLength
    || right.entryCount - left.entryCount
    || left.id.localeCompare(right.id),
  medium: (left, right) => Math.abs(left.averageEntryLength - 4.75) - Math.abs(right.averageEntryLength - 4.75)
    || right.entryCount - left.entryCount
    || left.id.localeCompare(right.id),
  hard: (left, right) => right.averageEntryLength - left.averageEntryLength
    || left.threeLetterCount - right.threeLetterCount
    || left.cheaterPairs - right.cheaterPairs
    || left.id.localeCompare(right.id),
};

export function patternsFor(size, difficulty) {
  const pool = americanPatterns.filter((pattern) => pattern.size === Number(size));
  if (!pool.length) return [];

  const rank = RANKERS[String(difficulty).toLowerCase()] ?? RANKERS.medium;
  return pool.toSorted(rank);
}

// The distinct sets of theme-slot lengths a pattern can seed. The server compares a
// custom-theme candidate pool against these before accepting a response, so a pool that
// looks large enough in aggregate but matches no pattern is rejected early.
export function themeSlotSignatures(size) {
  const seen = new Map();
  for (const pattern of americanPatterns.filter((entry) => entry.size === Number(size))) {
    for (const length of pattern.themeSlotLengths) {
      const signature = [length];
      seen.set(signature.join('-'), signature);
    }
  }

  return [...seen.values()].sort((left, right) => left[0] - right[0]);
}
`;
}

// The exhaustive walk is deterministic, so a local cache keeps selection changes cheap to
// iterate on without changing what the script produces.
const cachePath = process.env.AMERICAN_MASK_CACHE;
let masks = null;
if (cachePath) {
  masks = await readFile(cachePath, 'utf8').then(JSON.parse).catch(() => null);
}
if (!masks) {
  masks = enumerateMasks();
  if (cachePath) await writeFile(cachePath, JSON.stringify(masks));
}
const records = masks.map(describe);
const catalog = selectCatalog(records);

await writeFile(OUTPUT, render(catalog.map((record, index) => ({...record, id: `us9-${String(index + 1).padStart(2, '0')}`}))));

console.log(`valid masks: ${masks.length}`);
console.log(`catalog: ${catalog.length} patterns`);
for (const record of catalog) {
  console.log(`  ${record.id} black=${record.blackCount} entries=${record.entryCount} avg=${record.averageEntryLength} theme=${record.themeSlotLengths.join('/')} hist=${JSON.stringify(record.lengthHistogram)}`);
}
