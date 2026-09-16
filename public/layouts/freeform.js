// The Free-form layout driver: an open, loosely shaped grid built around interlocking
// theme and fill words. This module owns every Free-form policy decision — the pattern
// banks, the theme-anchor search, the themed-majority quota, and the greedy placement
// fallback for when no pattern can be filled — while `../dense.js` stays a style-neutral
// constraint solver that any layout style can drive.

import { createSolver, isFullyChecked, normalizeWords, numberEntries, readHistory, resolveSize } from '../dense.js';
import { miniPatterns } from '../mini-patterns.js';
import { denseFallbacks } from '../dense-fallbacks.js';

const DIRECTIONS = ['across', 'down'];

// Every open square in these rotationally symmetric patterns belongs to both
// an across and a down answer, and every answer is at least three letters.
const BASE_9_PATTERN = ['...###...', '...#.....', '...#.....', '#.....###', '#...#...#', '###.....#', '.....#...', '.....#...', '...###...'];

function extendPattern(extensionCount) {
  const pattern = Array.from({ length: 13 }, () => Array(13).fill('#'));
  BASE_9_PATTERN.forEach((line, row) => [...line].forEach((cell, col) => {
    pattern[row + 2][col + 2] = cell;
  }));
  const extensions = [
    ['left', 0], ['right', 8], ['top', 0],
    ['bottom', 8], ['left', 2], ['right', 6], ['top', 2],
    ['bottom', 6], ['left', 6], ['right', 2], ['top', 6], ['bottom', 2],
    ['left', 8], ['right', 0], ['top', 8], ['bottom', 0],
  ];
  for (const [side, index] of extensions.slice(0, extensionCount)) {
    if (side === 'left' || side === 'right') {
      const row = index + 2;
      const cols = side === 'left' ? [0, 1] : [11, 12];
      for (const col of cols) pattern[row][col] = '.';
    } else {
      const col = index + 2;
      const rows = side === 'top' ? [0, 1] : [11, 12];
      for (const row of rows) pattern[row][col] = '.';
    }
  }
  return pattern.map((row) => row.join(''));
}

const PATTERNS = {
  5: [
    ['...##', '....#', '.....', '#....', '##...'],
    ['.....','.....','.....','.....','#####'],
    ['....#','....#','....#','....#','....#'],
    ['....#', '....#', '.....', '#....', '#....'],
    ['...##', '...##', '.....', '##...', '##...'],
    ['#...#', '.....', '.....', '.....', '#...#'],
    ['.....', '.....', '.....', '.....', '.....'],
  ],
  9: [BASE_9_PATTERN],
  13: [
    ['###...#....##', '###...#....##', '###...#....##', '#....###...##', '...#.....####', '....#...#...#', '....#...#....', '#...#...#....', '####.....#...', '##...###....#', '##....#...###', '##....#...###', '##....#...###'],
    ['###.....#...#', '###.....#....', '###.....#....', '.....###.....', '...##....#...', '....#.....###', '....#...#....', '###.....#....', '...#....##...', '.....###.....', '....#.....###', '....#.....###', '#...#.....###'],
  ],
};

function modulePatterns(side, index, extensionDepth = 1) {
  return miniPatterns
    .filter(isFullyChecked)
    .filter((pattern) => side === 'bottom'
      ? pattern[4][index] === '.' && pattern[3][index] === '.'
      : pattern[index][4] === '.' && pattern[index][3] === '.')
    .map((base) => {
      const size = 5 + extensionDepth;
      const pattern = Array.from({ length: size }, () => Array(size).fill('#'));
      base.forEach((line, row) => [...line].forEach((cell, col) => {
        pattern[row][col] = cell;
      }));
      if (side === 'bottom') {
        for (let offset = 0; offset < extensionDepth; offset += 1) pattern[5 + offset][index] = '.';
      } else {
        for (let offset = 0; offset < extensionDepth; offset += 1) pattern[index][5 + offset] = '.';
      }

      return pattern.map((row) => row.join(''));
    });
}

const MODULE_PATTERNS = {
  left: modulePatterns('bottom', 4, 2),
  rightNear: modulePatterns('bottom', 1, 2),
  rightFar: modulePatterns('bottom', 4, 2),
  bottom: modulePatterns('right', 0),
};

const COMPACT_9_PATTERNS = {
  upper: modulePatterns('bottom', 3).filter((pattern) =>
    pattern[4][4] === '#' && Array.from({ length: 6 }, (_, row) => pattern[row][3]).every((cell) => cell === '.')),
  lower: miniPatterns
    .filter(isFullyChecked)
    .filter((pattern) => pattern[0].startsWith('##') && pattern[1] === '.....')
    .map((base) => {
      const pattern = Array.from({ length: 6 }, () => Array(6).fill('#'));
      base.forEach((line, row) => [...line].forEach((cell, col) => {
        pattern[row][col + 1] = cell;
      }));
      pattern[1][0] = '.';

      return pattern.map((row) => row.join(''));
    }),
};

function translateEntries(entries, rowOffset, colOffset) {
  return entries.map((entry) => ({
    ...entry,
    row: entry.row + rowOffset,
    col: entry.col + colOffset,
  }));
}

// Fills one pattern with a strict themed majority: it anchors a theme word, commits a
// broad-enough set of remaining slots to the themed quota, then drives the shared solver
// to fill the rest. `requiredThemed`, the quota commitment and the per-attempt time slice
// are Free-form policy, expressed through the solver's `prune`/`accept`/`stop` hooks.
function solvePattern(pattern, words, themeWords, history, deadline, fixedLetters = []) {
  const solver = createSolver(pattern, words, { fixedLetters, history });
  if (!solver) return null;

  const { slots, fixedSlotIndexes } = solver;
  const size = pattern.length;
  const requiredThemed = Math.floor(slots.length / 2) + 1;

  const prune = (domains, assigned) => {
    const themedCount = assigned.filter((word) => word?.isTheme).length;
    const possibleThemeSlots = domains.filter((domain) => domain?.some((word) => word.isTheme)).length;
    if (themedCount + possibleThemeSlots < requiredThemed) return false;
    if (themedCount + possibleThemeSlots === requiredThemed) {
      for (let i = 0; i < domains.length; i += 1) if (domains[i]?.some((word) => word.isTheme)) domains[i] = domains[i].filter((word) => word.isTheme);
    }
    return true;
  };

  const accept = (assigned, used) => {
    const signature = [...used].sort().join('|');
    return assigned.filter((word) => word?.isTheme).length >= requiredThemed && !history.sets.has(signature);
  };

  // Reserve the slots with the broadest themed domains for the quota. A slot with only a
  // handful of themed candidates is fragile, while a broad domain is much more likely to
  // survive the crossing constraints imposed by neighboring fill.
  const quotaSlots = (domains, occupied, strategyIndex) => {
    const choices = domains
      .map((domain, slotIndex) => ({
        slotIndex,
        direction: slots[slotIndex].direction,
        themed: slotIndex === occupied || fixedSlotIndexes.has(slotIndex) || !domain ? 0 : domain.filter((candidate) => candidate.isTheme).length,
      }))
      .filter(({ themed }) => themed > 0);
    if (size === 5) {
      return choices
        .sort((a, b) => a.themed - b.themed)
        .slice(0, requiredThemed - 1)
        .map(({ slotIndex }) => slotIndex);
    }
    const anchorDirection = slots[occupied].direction;
    const moduleBounds = [
      { minRow: 0, maxRow: 5, minCol: 0, maxCol: 4 },
      { minRow: 0, maxRow: 5, minCol: 8, maxCol: 12 },
      { minRow: 8, maxRow: 12, minCol: 1, maxCol: 6 },
    ];
    const moduleFor = (slotIndex) => moduleBounds.findIndex((bounds) => slots[slotIndex].cells.every(({ row, col }) =>
      row >= bounds.minRow && row <= bounds.maxRow && col >= bounds.minCol && col <= bounds.maxCol));
    const modular = moduleBounds.every((_, module) => slots.filter((_, slotIndex) => moduleFor(slotIndex) === module).length === 10);
    if (modular) {
      const selected = [];
      for (let module = 0; module < moduleBounds.length; module += 1) {
        const direction = ((strategyIndex >> module) & 1) === 0 ? 'across' : 'down';
        selected.push(...choices
          .filter(({ slotIndex }) => moduleFor(slotIndex) === module && slots[slotIndex].direction === direction)
          .sort((a, b) => b.themed - a.themed));
      }
      const selectedIds = new Set(selected.map(({ slotIndex }) => slotIndex));
      const remainder = choices
        .filter(({ slotIndex }) => !selectedIds.has(slotIndex))
        .sort((a, b) => b.themed - a.themed);

      return [...selected, ...remainder]
        .slice(0, requiredThemed - 1)
        .map(({ slotIndex }) => slotIndex);
    }
    const sameDirection = choices
      .filter(({ direction }) => direction === anchorDirection)
      .sort((a, b) => b.themed - a.themed);
    const otherDirection = choices
      .filter(({ direction }) => direction !== anchorDirection)
      .sort((a, b) => b.themed - a.themed);

    return [...sameDirection, ...otherDirection]
      .slice(0, requiredThemed - 1)
      .map(({ slotIndex }) => slotIndex);
  };

  const anchors = [];
  for (const themeWord of themeWords) {
    for (let index = 0; index < slots.length; index += 1) {
      if (!fixedSlotIndexes.has(index) && slots[index].length === themeWord.answer.length) anchors.push({ index, word: themeWord });
    }
  }
  anchors.sort((a, b) => (history.uses.get(a.word.answer) ?? 0) - (history.uses.get(b.word.answer) ?? 0)
    || Number(b.word.common) - Number(a.word.common) || a.word.random - b.word.random);

  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    if (Date.now() >= deadline) break;
    const { index, word } = anchors[anchorIndex];
    solver.put(index, word);
    const domains = solver.initialDomains(index);
    const committed = quotaSlots(domains, index, anchorIndex);
    // Commit those slots to themed words, then search. Without the commitment a small
    // themed pool loses its candidates to crossing letters before the quota is reachable;
    // a pattern that cannot host the quota at all is skipped rather than searched.
    if (!committed.length || committed.length === requiredThemed - 1) {
      for (const slotIndex of committed) domains[slotIndex] = domains[slotIndex].filter((candidate) => candidate.isTheme);
      const remainingTime = deadline - Date.now();
      const remainingAnchors = anchors.length - anchorIndex;
      const slice = Math.max(40, Math.min(500, remainingTime / Math.min(remainingAnchors, 5)));
      const attemptDeadline = Date.now() + slice;
      if (solver.search({ stop: () => Date.now() >= attemptDeadline, domains, left: slots.length - 1, prune, accept })) {
        return solver.result();
      }
    }

    solver.remove(index, word);
  }
  return null;
}

function solveModular(words, history, deadline, difficulty, random) {
  const rejectedModules = new Set();
  const longBridge = difficulty !== 'easy';
  while (Date.now() < deadline) {
    const moduleSpecs = [
      MODULE_PATTERNS.left,
      longBridge ? MODULE_PATTERNS.rightFar : MODULE_PATTERNS.rightNear,
      MODULE_PATTERNS.bottom,
    ];
    const moduleSolutions = [];
    const used = new Set();
    let failed = false;
    for (let index = 0; index < moduleSpecs.length; index += 1) {
      const available = words.filter((word) => !used.has(word.answer));
      const moduleDeadline = Math.min(deadline, Date.now() + Math.max(350, (deadline - Date.now()) / (moduleSpecs.length - index)));
      const moduleHistory = { sets: new Set([...history.sets, ...rejectedModules]), uses: history.uses };
      let solution = null;
      const patterns = moduleSpecs[index].toSorted(() => random() - 0.5);
      for (let patternIndex = 0; patternIndex < patterns.length && Date.now() < moduleDeadline; patternIndex += 1) {
        const patternsLeft = patterns.length - patternIndex;
        const patternDeadline = Math.min(moduleDeadline, Date.now() + Math.max(100, (moduleDeadline - Date.now()) / patternsLeft));
        solution = solvePattern(
          patterns[patternIndex],
          available,
          available.filter((word) => word.isTheme),
          moduleHistory,
          patternDeadline,
        );
        if (solution) break;
      }
      if (!solution) {
        failed = true;
        break;
      }
      moduleSolutions.push(solution);
      for (const entry of solution.entries) used.add(entry.answer);
    }
    if (failed) continue;

    const leftLetter = moduleSolutions[0].grid[6][4];
    const rightPosition = longBridge ? 8 : 5;
    const rightLetter = moduleSolutions[1].grid[6][longBridge ? 4 : 1];
    const horizontalLength = longBridge ? 9 : 6;
    const bridgeCandidates = (predicate) => words
      .filter((word) => !used.has(word.answer) && predicate(word))
      .toSorted((a, b) => Number(b.isTheme) - Number(a.isTheme)
        || (history.uses.get(a.answer) ?? 0) - (history.uses.get(b.answer) ?? 0)
        || Number(b.common) - Number(a.common)
        || a.random - b.random);
    const horizontal = bridgeCandidates((word) => word.answer.length === horizontalLength
      && word.answer[0] === leftLetter
      && word.answer[rightPosition] === rightLetter)[0];
    if (!horizontal) {
      for (const solution of moduleSolutions) rejectedModules.add(solution.entries.map(({ answer }) => answer).sort().join('|'));
      continue;
    }

    used.add(horizontal.answer);
    const bottomLetter = moduleSolutions[2].grid[0][5];
    const vertical = bridgeCandidates((word) => word.answer.length === 3
      && word.answer[0] === horizontal.answer[2]
      && word.answer[2] === bottomLetter)[0];
    if (!vertical) {
      for (const solution of moduleSolutions) rejectedModules.add(solution.entries.map(({ answer }) => answer).sort().join('|'));
      continue;
    }

    const entries = [
      ...translateEntries(moduleSolutions[0].entries, 0, 0),
      ...translateEntries(moduleSolutions[1].entries, 0, 8),
      ...translateEntries(moduleSolutions[2].entries, 8, 1),
      { answer: horizontal.answer, clue: horizontal.clue, isTheme: horizontal.isTheme, row: 6, col: 4, direction: 'across' },
      { answer: vertical.answer, clue: vertical.clue, isTheme: vertical.isTheme, row: 6, col: 6, direction: 'down' },
    ];
    if (entries.filter(({ isTheme }) => isTheme).length <= entries.length / 2) {
      for (const solution of moduleSolutions) rejectedModules.add(solution.entries.map(({ answer }) => answer).sort().join('|'));
      continue;
    }
    const signature = entries.map(({ answer }) => answer).sort().join('|');
    if (history.sets.has(signature)) {
      for (const solution of moduleSolutions) rejectedModules.add(solution.entries.map(({ answer }) => answer).sort().join('|'));
      continue;
    }

    const grid = Array.from({ length: 13 }, () => Array(13).fill(null));
    for (const entry of entries) {
      for (let offset = 0; offset < entry.answer.length; offset += 1) {
        const row = entry.row + (entry.direction === 'down' ? offset : 0);
        const col = entry.col + (entry.direction === 'across' ? offset : 0);
        grid[row][col] = entry.answer[offset];
      }
    }

    return { grid, entries: numberEntries(entries) };
  }
  return null;
}

function solveCompact9(words, history, deadline, random) {
  const rejectedModules = new Set();
  const bridgeLetters = 'STAREDCLMPBFGWHYVNKXJQZUIO';
  let attempt = 0;
  while (Date.now() < deadline) {
    const bridgeLetter = bridgeLetters[attempt % bridgeLetters.length];
    attempt += 1;
    const attemptDeadline = Math.min(deadline, Date.now() + 1500);
    const specs = [
      COMPACT_9_PATTERNS.upper,
      COMPACT_9_PATTERNS.lower,
    ];
    const solutions = [];
    const used = new Set();
    let failed = false;
    for (let index = 0; index < specs.length; index += 1) {
      const available = words.filter((word) => !used.has(word.answer));
      const moduleDeadline = Math.min(attemptDeadline, Date.now() + Math.max(250, (attemptDeadline - Date.now()) / (specs.length - index)));
      const moduleHistory = { sets: new Set([...history.sets, ...rejectedModules]), uses: history.uses };
      let solution = null;
      const availablePatterns = specs[index];
      const start = ((attempt - 1) * 3) % availablePatterns.length;
      const patterns = Array.from({ length: Math.min(3, availablePatterns.length) }, (_, offset) =>
        availablePatterns[(start + offset) % availablePatterns.length]);
      for (let patternIndex = 0; patternIndex < patterns.length && Date.now() < moduleDeadline; patternIndex += 1) {
        const patternsLeft = patterns.length - patternIndex;
        const patternDeadline = Math.min(moduleDeadline, Date.now() + Math.max(100, (moduleDeadline - Date.now()) / patternsLeft));
        solution = solvePattern(
          patterns[patternIndex],
          available,
          available.filter((word) => word.isTheme),
          moduleHistory,
          patternDeadline,
          index === 0
            ? [{ row: 5, col: 3, letter: bridgeLetter }]
            : [{ row: 1, col: 0, letter: bridgeLetter }],
        );
        if (solution) break;
      }
      if (!solution) {
        failed = true;
        break;
      }
      solutions.push(solution);
      for (const entry of solution.entries) used.add(entry.answer);
    }
    if (failed) continue;
    if (solutions[0].grid[5][3] !== solutions[1].grid[1][0]) {
      for (const solution of solutions) rejectedModules.add(solution.entries.map(({ answer }) => answer).sort().join('|'));
      continue;
    }

    const entries = [
      ...translateEntries(solutions[0].entries, 0, 0),
      ...translateEntries(solutions[1].entries, 4, 3),
    ];
    if (entries.filter(({ isTheme }) => isTheme).length <= entries.length / 2) {
      for (const solution of solutions) rejectedModules.add(solution.entries.map(({ answer }) => answer).sort().join('|'));
      continue;
    }
    const signature = entries.map(({ answer }) => answer).sort().join('|');
    if (history.sets.has(signature)) {
      for (const solution of solutions) rejectedModules.add(solution.entries.map(({ answer }) => answer).sort().join('|'));
      continue;
    }

    const grid = Array.from({ length: 9 }, () => Array(9).fill(null));
    for (const entry of entries) {
      for (let offset = 0; offset < entry.answer.length; offset += 1) {
        const row = entry.row + (entry.direction === 'down' ? offset : 0);
        const col = entry.col + (entry.direction === 'across' ? offset : 0);
        grid[row][col] = entry.answer[offset];
      }
    }

    return { grid, entries: numberEntries(entries) };
  }
  return null;
}

// One dense-pattern generation attempt, bounded by `options.timeLimitMs`. This is the
// core of the historical `generateDense`: it normalizes the supplied word pools, then
// tries the compact 9x9 module layout, the 13x13 modular layout, or the plain pattern
// bank in turn, returning the first grid that satisfies the themed majority.
function solveDense(options = {}) {
  const size = resolveSize(options.size);
  if (!size) return null;
  const difficulty = ['easy', 'medium', 'hard'].includes(String(options.difficulty).toLowerCase())
    ? String(options.difficulty).toLowerCase()
    : 'medium';
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const themeWords = normalizeWords(options.themeWords, true, difficulty, size, random);
  if (!themeWords.length) return null;
  const fillWords = normalizeWords(options.fillWords, false, difficulty, size, random);
  const byAnswer = new Map(fillWords.map((word) => [word.answer, word]));
  for (const word of themeWords) byAnswer.set(word.answer, word);
  const words = [...byAnswer.values()];
  const normalizedThemes = themeWords.map(({ answer }) => byAnswer.get(answer));
  const history = readHistory(options.history);
  const defaultLimit = 10000;
  const deadline = Date.now() + Math.max(100, Math.min(Number(options.timeLimitMs) || defaultLimit, 10000));

  if (size === 9) {
    const compact = solveCompact9(words, history, deadline, random);
    if (compact) {
      return {
        size,
        theme: String(options.theme ?? '').trim(),
        entries: compact.entries,
        grid: compact.grid,
      };
    }
  }

  if (size === 13) {
    const modular = solveModular(words, history, deadline, difficulty, random);
    if (modular) {
      return {
        size,
        theme: String(options.theme ?? '').trim(),
        entries: modular.entries,
        grid: modular.grid,
      };
    }
  }

  const patterns = size === 5
    ? [...miniPatterns.slice(0,2), ...miniPatterns.slice(2).toSorted(()=>random()-.5)]
    : size === 13
      ? [extendPattern({ easy: 3, medium: 7, hard: 12 }[difficulty]), ...PATTERNS[size]]
      : [...PATTERNS[size]];
  for (let index = 0; index < patterns.length; index += 1) {
    if(Date.now() >= deadline)break;
    const patternsLeft = patterns.length - index;
    const remaining = deadline - Date.now();
    const patternDeadline = patternsLeft === 1
      ? deadline
      : Date.now() + Math.min(remaining, Math.max(100, remaining / Math.min(patternsLeft, 10)));
    const solved = solvePattern(patterns[index], words, normalizedThemes, history, patternDeadline);
    if (solved) {
      return {
        size,
        theme: String(options.theme ?? '').trim(),
        entries: solved.entries,
        grid: solved.grid,
      };
    }
  }
  return null;
}

function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function emptyBoard(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function canPlace(board, directions, answer, row, col, direction, requireCrossing) {
  const size = board.length;
  const dr = direction === 'down' ? 1 : 0;
  const dc = direction === 'across' ? 1 : 0;
  const endRow = row + dr * (answer.length - 1);
  const endCol = col + dc * (answer.length - 1);
  if (row < 0 || col < 0 || endRow >= size || endCol >= size) return -1;
  const beforeRow = row - dr;
  const beforeCol = col - dc;
  const afterRow = endRow + dr;
  const afterCol = endCol + dc;
  if (beforeRow >= 0 && beforeCol >= 0 && beforeRow < size && beforeCol < size && board[beforeRow][beforeCol]) return -1;
  if (afterRow >= 0 && afterCol >= 0 && afterRow < size && afterCol < size && board[afterRow][afterCol]) return -1;

  let crossings = 0;
  for (let i = 0; i < answer.length; i += 1) {
    const r = row + dr * i;
    const c = col + dc * i;
    const existing = board[r][c];
    if (existing && existing !== answer[i]) return -1;
    if (existing) {
      if (directions[r][c].has(direction)) return -1;
      crossings += 1;
    } else if (direction === 'across') {
      if ((r > 0 && board[r - 1][c]) || (r + 1 < size && board[r + 1][c])) return -1;
    } else if ((c > 0 && board[r][c - 1]) || (c + 1 < size && board[r][c + 1])) return -1;
  }
  return requireCrossing && crossings === 0 ? -1 : crossings;
}

function placementOptions(board, directions, answer, entries) {
  const options = [];
  if (!entries.length) {
    for (const direction of DIRECTIONS) {
      const row = direction === 'across' ? Math.floor(board.length / 2) : Math.floor((board.length - answer.length) / 2);
      const col = direction === 'across' ? Math.floor((board.length - answer.length) / 2) : Math.floor(board.length / 2);
      if (canPlace(board, directions, answer, row, col, direction, false) >= 0) options.push({ row, col, direction, crossings: 0 });
    }
    return options;
  }
  for (let r = 0; r < board.length; r += 1) {
    for (let c = 0; c < board.length; c += 1) {
      if (!board[r][c]) continue;
      for (let i = 0; i < answer.length; i += 1) {
        if (answer[i] !== board[r][c]) continue;
        for (const direction of DIRECTIONS) {
          const row = r - (direction === 'down' ? i : 0);
          const col = c - (direction === 'across' ? i : 0);
          const crossings = canPlace(board, directions, answer, row, col, direction, true);
          if (crossings >= 0) options.push({ row, col, direction, crossings });
        }
      }
    }
  }
  return options;
}

function place(board, directions, answer, option) {
  const dr = option.direction === 'down' ? 1 : 0;
  const dc = option.direction === 'across' ? 1 : 0;
  for (let i = 0; i < answer.length; i += 1) {
    const row = option.row + dr * i;
    const col = option.col + dc * i;
    board[row][col] = answer[i];
    directions[row][col].add(option.direction);
  }
}

function buildCandidate(words, size, target, random = Math.random) {
  const board = emptyBoard(size);
  const directions = Array.from({ length: size }, () => Array.from({ length: size }, () => new Set()));
  const entries = [];
  let remaining = [...words];
  let themed = 0;
  // Themed answers are placed first so general crossings cannot crowd them out, then
  // fill answers join only while the themed answers stay a strict majority.
  for (let themedPass = 1; themedPass >= 0; themedPass -= 1) {
    while (remaining.length && entries.length < target) {
      let best = null;
      for (const word of remaining) {
        const isTheme = word.isTheme === true;
        if (isTheme !== (themedPass === 1)) continue;
        if (!isTheme && themed * 2 <= entries.length + 1) continue;
        const options = placementOptions(board, directions, word.answer, entries);
        for (const option of options) {
          const centrality = -Math.abs(option.row - size / 2) - Math.abs(option.col - size / 2);
          const score = option.crossings * 24 - word.answer.length * 4 + centrality + random() * 5;
          if (!best || score > best.score) best = { word, option, score };
        }
      }
      if (!best) break;
      place(board, directions, best.word.answer, best.option);
      entries.push({ ...best.word, ...best.option });
      if (best.word.isTheme) themed += 1;
      remaining = remaining.filter((word) => word.answer !== best.word.answer);
    }
  }
  return { board, entries };
}

// Distinct from `../dense.js`'s `numberEntries`: this greedy placement path carries a
// `crossings` scoring field on each entry that must be dropped before numbering.
function numberPlacementEntries(entries) {
  const starts = [...new Set(entries.map(({ row, col }) => `${row},${col}`))]
    .map((key) => key.split(',').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const numbers = new Map(starts.map(([row, col], index) => [`${row},${col}`, index + 1]));
  return entries
    .map(({ crossings: _crossings, ...entry }) => ({ ...entry, number: numbers.get(`${entry.row},${entry.col}`) }))
    .sort((a, b) => a.number - b.number || DIRECTIONS.indexOf(a.direction) - DIRECTIONS.indexOf(b.direction));
}

// The full Free-form generation path: a dense pattern-fill attempt, a curated fallback
// mini and a slower retry for 5x5, then a greedy interlocking placement as a last resort.
// `options` carries both the word pools for the dense attempt (`themeWords`, `fillWords`)
// and the plain, history-sorted pool (`words`, `category`, `byAnswer`, `sets`, `wordUses`)
// the fallback and greedy paths need.
export function generateFreeform(options = {}) {
  const size = resolveSize(options.size);
  if (!size) return null;
  const difficulty = ['easy', 'medium', 'hard'].includes(String(options.difficulty).toLowerCase())
    ? String(options.difficulty).toLowerCase()
    : 'medium';
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const theme = String(options.theme ?? '').trim();

  let dense = solveDense({ ...options, timeLimitMs: size === 5 ? 2500 : 5000 });
  if (dense) return dense;

  if (size === 5) {
    const { category, sets, wordUses, byAnswer } = options;
    const available = (denseFallbacks[category] || []).filter((p) => !sets.has(p.entries.map((e) => e.answer).sort().join('|')));
    available.sort((a, b) => a.entries.reduce((n, e) => n + (wordUses.get(e.answer) || 0), 0) - b.entries.reduce((n, e) => n + (wordUses.get(e.answer) || 0), 0));
    if (available.length) {
      const chosen = structuredClone(available[0]);
      chosen.entries = chosen.entries.map((entry) => ({ ...entry, clue: byAnswer.get(entry.answer)?.clue || entry.clue, isTheme: byAnswer.has(entry.answer) }));
      if (chosen.entries.filter((e) => e.isTheme).length > chosen.entries.length / 2) return { ...chosen, theme };
    }
    // A slower retry fits the quota where the first pass ran out of budget, which matters
    // most for AI-supplied word sets, whose themed pools are smaller than curated ones.
    dense = solveDense({ ...options, timeLimitMs: 6500 });
    if (dense) return dense;
    if (difficulty === 'hard') throw new Error('Could not fit a new mostly themed mini with at least 90% crossed letters. Try another theme or generate again.');
  }

  const target = size === 5 ? 7 : size === 9 ? 22 : 38;
  // General crossings keep a themed grid buildable when the themed pool alone is too
  // small to interlock; `buildCandidate` stops adding them short of a themed majority.
  const generalSample = shuffle(options.fillWords.filter((word) => word.answer.length <= size), random).slice(0, 180);
  let best = null;
  let bestFresh = null;
  const placementDeadline = Date.now() + 1500;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (bestFresh && Date.now() >= placementDeadline) break;
    const pool = [
      ...shuffle(options.words.filter((word) => word.answer.length <= 4), random).slice(0, Math.max(24, target * 2)),
      ...shuffle(options.words.filter((word) => word.answer.length > 4), random).slice(0, 6),
      ...shuffle(generalSample, random).slice(0, 45).map((word) => ({ ...word, isTheme: false })),
    ].map((word) => ({ ...word, isTheme: word.isTheme !== false }));
    const candidate = buildCandidate(pool, size, target, random);
    const signature = candidate.entries.map(({ answer }) => answer).sort().join('|');
    const repeatPenalty = options.sets.has(signature) ? 100 : 0;
    const reusePenalty = candidate.entries.reduce((sum, entry) => sum + (options.wordUses.get(entry.answer) ?? 0), 0) * 1.5;
    const crossings = candidate.entries.reduce((sum, entry) => sum + entry.crossings, 0);
    const occupied = candidate.board.flat().filter(Boolean).length;
    const score = (crossings / occupied) * 200 + crossings * 15 + candidate.entries.length * 10 - repeatPenalty - reusePenalty + random();
    if (!best || score > best.score) best = { ...candidate, score, signature };
    if (!options.sets.has(signature) && (!bestFresh || score > bestFresh.score)) bestFresh = { ...candidate, score, signature };
    if (candidate.entries.length >= target && !options.sets.has(signature) && reusePenalty === 0 && crossings / occupied >= 0.65) break;
  }
  if (!best || best.entries.length < 3) throw new Error('Could not build a connected crossword from these themed words. Try a broader theme or more candidate words.');
  if (options.sets.size) {
    if (!bestFresh || bestFresh.entries.length < 3) throw new Error('Every usable crossword from these words is already in the game history. Add more themed words or clear older history.');
    best = bestFresh;
  }
  return {
    size,
    theme,
    entries: numberPlacementEntries(best.entries),
    grid: best.board,
  };
}
