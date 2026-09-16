// The American-style generator: symmetric, fully checked 9x9 grids built from an audited
// mask catalog and the curated vocabulary tiers.
//
// It never falls back to another style. When no catalog mask can be filled acceptably it
// throws its own error, because a Free-form grid behind an "American style" selection
// would make the setting a suggestion rather than a guarantee.
//
// Two policies differ deliberately from Free form:
//   * theme entries are a featured minority in a rotational slot pair, not a majority;
//   * every answer must come from a reviewed tier. Raw dictionary material can fill a
//     grid, but it fills it with words no one wants to solve.

import {createSolver, normalizeWords, readHistory} from '../dense.js';
import {fillWords} from '../fill-words.js';
import {themedPlurals} from '../theme-plurals.js';
import {LayoutError} from './errors.js';
import {americanFillWords} from './american-fill-words.js';
import {americanThemeWords} from './american-theme-words.js';
import {americanRules, patternsFor} from './american-patterns.js';
import {analyzeMask} from './mask-analysis.js';

// How many *feasible* themed pairs to search per mask before moving on. Pairs that leave a
// crossing slot with an empty domain are rejected before this counts, so the budget is
// spent on searches that could succeed.
const PAIRS_PER_PATTERN = 12;

// How finely to slice the remaining budget. Every catalog mask stays reachable while time
// remains — capping the number of masks tried would throw away budget the deadline still
// allows.
const PATTERN_SLICES = 4;

function poolFor(themeCategory, customThemeWords, difficulty, size, random) {
  const curatedTheme = themeCategory ? americanThemeWords[themeCategory] ?? [] : [];
  const rawTheme = curatedTheme.length ? curatedTheme : (Array.isArray(customThemeWords) ? customThemeWords : []);
  const themeWords = normalizeWords(rawTheme, true, difficulty, size, random);

  const general = [
    ...fillWords.map((word) => ({...word, common: true})),
    ...themedPlurals.map((word) => ({...word, common: true})),
    ...americanFillWords,
  ];
  const fill = normalizeWords(general, false, difficulty, size, random);

  // A featured answer must never also appear as anonymous general fill.
  const byAnswer = new Map(fill.map((word) => [word.answer, word]));
  for (const word of themeWords) byAnswer.set(word.answer, word);

  return {themeWords, words: [...byAnswer.values()]};
}

function slotIndexOf(slots, entry) {
  return slots.findIndex((slot) => slot.row === entry.row && slot.col === entry.col && slot.direction === entry.direction);
}

// Ordered pairs of theme answers of one length: the two halves of a rotational pair. Both
// orders are produced, because the two slots cross different fill. Least-used answers come
// first so regeneration stays fresh.
function themePairs(candidates, history, random) {
  const ordered = candidates
    .map((word) => ({word, uses: history.uses.get(word.answer) ?? 0, jitter: random()}))
    .sort((left, right) => left.uses - right.uses || left.jitter - right.jitter)
    .map(({word}) => word);

  const pairs = [];
  for (let first = 0; first < ordered.length; first += 1) {
    for (let second = 0; second < ordered.length; second += 1) {
      if (first !== second) pairs.push([ordered[first], ordered[second]]);
    }
  }

  return pairs;
}

function assertEveryWhiteCellFilled(mask, grid) {
  mask.forEach((line, row) => [...line].forEach((cell, col) => {
    if (cell === '#') return;
    if (typeof grid[row][col] !== 'string' || !grid[row][col]) {
      throw new LayoutError('An American grid left a declared white cell empty.', 'layout-generation-failed');
    }
  }));
}

export function generateAmerican(options = {}) {
  const size = Number(options.size);
  const rules = americanRules[size];
  const patterns = patternsFor(size, options.difficulty);
  if (!rules || !patterns.length) {
    throw new LayoutError(`American style does not support ${size}x${size} grids.`, 'layout-size-unsupported');
  }

  const difficulty = ['easy', 'medium', 'hard'].includes(String(options.difficulty).toLowerCase())
    ? String(options.difficulty).toLowerCase()
    : 'medium';
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const deadline = Number(options.deadline) || (Date.now() + 10_000);
  const history = readHistory(options.history);
  const {themeWords, words} = poolFor(options.themeCategory, options.themeWords, difficulty, size, random);

  const themeByLength = new Map();
  for (const word of themeWords) {
    if (!themeByLength.has(word.answer.length)) themeByLength.set(word.answer.length, []);
    themeByLength.get(word.answer.length).push(word);
  }

  // Rotate the ranked pool so repeated generations at one difficulty do not always open
  // with the same mask, while the difficulty ordering still decides what is tried first.
  const offset = Math.floor(random() * patterns.length);
  const ordered = [...patterns.slice(offset), ...patterns.slice(0, offset)];

  let sawAnchorPair = false;
  let ranOutOfTime = Date.now() >= deadline;

  for (let index = 0; index < ordered.length; index += 1) {
    if (Date.now() >= deadline) {
      ranOutOfTime = true;
      break;
    }

    const pattern = ordered[index];
    const metrics = analyzeMask(pattern.mask);
    const remaining = deadline - Date.now();
    const patternDeadline = Date.now() + Math.max(250, remaining / Math.min(ordered.length - index, PATTERN_SLICES));

    for (const pair of pattern.themeSlots) {
      const slots = pair.map((entryIndex) => metrics.entries[entryIndex]);
      const candidates = themeByLength.get(slots[0].length) ?? [];
      if (candidates.length < 2) continue;
      sawAnchorPair = true;

      let attempts = 0;
      for (const [first, second] of themePairs(candidates, history, random)) {
        if (attempts >= PAIRS_PER_PATTERN || Date.now() >= patternDeadline) break;

        const solver = createSolver(pattern.mask, words, {history, interrupt: () => Date.now() >= patternDeadline});
        if (!solver) break;

        const anchors = [[slotIndexOf(solver.slots, slots[0]), first], [slotIndexOf(solver.slots, slots[1]), second]];
        if (anchors.some(([slotIndex]) => slotIndex < 0)) break;
        for (const [slotIndex, word] of anchors) solver.put(slotIndex, word);

        const fixed = new Set(anchors.map(([slotIndex]) => slotIndex));
        const domains = solver.slots.map((slot, slotIndex) => (fixed.has(slotIndex) ? null : solver.candidatesFor(slot)));
        // Most pairs strand a crossing slot with no candidate at all. Rejecting those
        // here costs one pass over the domains instead of a search that cannot succeed,
        // which is what buys enough attempts to find a pair that works.
        if (domains.some((domain) => domain && !domain.length)) continue;

        attempts += 1;
        const solved = solver.search({
          left: solver.slots.length - fixed.size,
          domains,
          stop: () => Date.now() >= patternDeadline,
          accept: (_assigned, used) => !history.sets.has([...used].sort().join('|')),
        });

        if (solved) {
          const {grid, entries} = solver.result();
          assertEveryWhiteCellFilled(pattern.mask, grid);

          return {
            size,
            theme: String(options.theme ?? '').trim(),
            grid,
            entries,
            patternId: pattern.id,
          };
        }
      }
    }
  }

  if (!sawAnchorPair) {
    throw new LayoutError(
      'This theme has too few featured answers for a symmetric pair. Try a broader theme.',
      'american-theme-anchors-insufficient'
    );
  }
  if (ranOutOfTime || Date.now() >= deadline) {
    throw new LayoutError('American generation ran out of time. Generate again.', 'american-deadline-exceeded');
  }

  throw new LayoutError('No American grid could be filled to standard from this theme. Generate again.', 'american-fill-exhausted');
}
