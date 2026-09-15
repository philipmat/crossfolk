import { miniPatterns } from './mini-patterns.js';
const SIZE_MAP = { small: 5, medium: 9, large: 13 };

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

function resolveSize(value) {
  const size = typeof value === 'string' ? SIZE_MAP[value.toLowerCase()] : Number(value ?? 5);
  return [5, 9, 13].includes(size) ? size : null;
}

function clueFor(raw, difficulty) {
  if (typeof raw?.clue === 'string') return raw.clue;
  if (raw?.clue && typeof raw.clue === 'object') {
    return raw.clue[difficulty] ?? raw.clue.medium ?? raw.clue.easy ?? raw.clue.hard;
  }
  if (raw?.clues && typeof raw.clues === 'object') {
    return raw.clues[difficulty] ?? raw.clues.medium ?? raw.clues.easy ?? raw.clues.hard;
  }
  return undefined;
}

function normalizeWords(words, isTheme, difficulty, size, random) {
  if (!Array.isArray(words)) return [];
  return words.map((item) => {
    const raw = typeof item === 'string' ? { answer: item } : item;
    const answer = String(raw?.answer ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    return {
      answer,
      clue: String(clueFor(raw, difficulty) ?? `${answer.length}-letter entry`),
      isTheme,
      common: raw.common === true,
      random: random(),
    };
  }).filter(({ answer }) => answer.length >= 3 && answer.length <= size);
}

function readHistory(history) {
  const sets = new Set();
  const uses = new Map();
  for (const game of Array.isArray(history) ? history : []) {
    const source = Array.isArray(game) ? game : game?.answers ?? game?.entries ?? [];
    const answers = source
      .map((item) => String(item?.answer ?? item).toUpperCase().replace(/[^A-Z]/g, ''))
      .filter(Boolean);
    if (!answers.length) continue;
    sets.add([...answers].sort().join('|'));
    for (const answer of answers) uses.set(answer, (uses.get(answer) ?? 0) + 1);
  }
  return { sets, uses };
}

function makeSlots(pattern) {
  const size = pattern.length;
  const slots = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (pattern[row][col] === '#') continue;
      if (col === 0 || pattern[row][col - 1] === '#') {
        let end = col;
        while (end < size && pattern[row][end] !== '#') end += 1;
        if (end - col >= 3) slots.push({ row, col, direction: 'across', length: end - col });
      }
      if (row === 0 || pattern[row - 1][col] === '#') {
        let end = row;
        while (end < size && pattern[end][col] !== '#') end += 1;
        if (end - row >= 3) slots.push({ row, col, direction: 'down', length: end - row });
      }
    }
  }
  for (const slot of slots) {
    slot.cells = Array.from({ length: slot.length }, (_, index) => ({
      row: slot.row + (slot.direction === 'down' ? index : 0),
      col: slot.col + (slot.direction === 'across' ? index : 0),
    }));
  }
  return slots;
}

function numberEntries(entries) {
  const starts = [...new Set(entries.map(({ row, col }) => `${row},${col}`))]
    .map((key) => key.split(',').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const numbers = new Map(starts.map(([row, col], index) => [`${row},${col}`, index + 1]));
  return entries
    .map((entry) => ({ ...entry, number: numbers.get(`${entry.row},${entry.col}`) }))
    .sort((a, b) => a.number - b.number || (a.direction === 'across' ? -1 : 1));
}

function solvePattern(pattern, words, themeWords, history, deadline, fixedLetters = []) {
  const size = pattern.length;
  const slots = makeSlots(pattern);
  const owners = new Map();
  const crossings = slots.map(() => []);
  slots.forEach((slot, slotIndex) => slot.cells.forEach(({ row, col }, position) => {
    const key = `${row},${col}`;
    const prior = owners.get(key);
    if (prior) {
      crossings[slotIndex].push({ other: prior.slotIndex, position, otherPosition: prior.position });
      crossings[prior.slotIndex].push({ other: slotIndex, position: prior.position, otherPosition: position });
    } else owners.set(key, { slotIndex, position });
  }));
  const byLength = new Map();
  for (const word of words) {
    if (!byLength.has(word.answer.length)) byLength.set(word.answer.length, []);
    byLength.get(word.answer.length).push(word);
  }
  if (slots.some((slot) => !byLength.get(slot.length)?.length)) return null;

  for (const candidates of byLength.values()) {
    candidates.sort((a, b) => (history.uses.get(a.answer) ?? 0) - (history.uses.get(b.answer) ?? 0)
      || Number(b.isTheme) - Number(a.isTheme) || Number(b.common)-Number(a.common) || a.random - b.random);
  }

  const letterIndex = new Map();
  for (const [length, candidates] of byLength) {
    const positions = Array.from({ length }, () => new Map());
    for (const word of candidates) {
      for (let index = 0; index < length; index += 1) {
        const bucket = positions[index].get(word.answer[index]) ?? [];
        bucket.push(word);
        positions[index].set(word.answer[index], bucket);
      }
    }
    letterIndex.set(length, positions);
  }

  const grid = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => pattern[row][col] === '#' ? null : ''));
  const fixedCells = new Map();
  for (const { row, col, letter } of fixedLetters) {
    grid[row][col] = letter;
    fixedCells.set(`${row},${col}`, letter);
  }
  const cellUses = Array.from({ length: size }, () => Array(size).fill(0));
  const assigned = Array(slots.length).fill(null);
  const used = new Set();
  let nodes = 0;
  const requiredThemed = Math.floor(slots.length / 2) + 1;
  const fixedSlotIndexes = new Set(slots
    .map((slot, slotIndex) => fixedLetters.some(({ row, col }) => slot.cells.some((cell) => cell.row === row && cell.col === col)) ? slotIndex : -1)
    .filter((slotIndex) => slotIndex >= 0));

  const matches = (slot, word) => slot.cells.every(({ row, col }, index) =>
    !grid[row][col] || grid[row][col] === word.answer[index]);

  const candidatesFor = (slot) => {
    let source = byLength.get(slot.length) ?? [];
    const positions = letterIndex.get(slot.length);
    slot.cells.forEach(({ row, col }, index) => {
      const letter = grid[row][col];
      if (!letter) return;
      const bucket = positions[index].get(letter) ?? [];
      if (bucket.length < source.length) source = bucket;
    });
    return source.filter((word) => !used.has(word.answer) && matches(slot, word));
  };

  function put(slotIndex, word) {
    assigned[slotIndex] = word;
    used.add(word.answer);
    slots[slotIndex].cells.forEach(({ row, col }, index) => {
      grid[row][col] = word.answer[index];
      cellUses[row][col] += 1;
    });
  }

  function remove(slotIndex, word) {
    slots[slotIndex].cells.forEach(({ row, col }) => {
      cellUses[row][col] -= 1;
      if (!cellUses[row][col]) grid[row][col] = fixedCells.get(`${row},${col}`) ?? '';
    });
    used.delete(word.answer);
    assigned[slotIndex] = null;
  }

  function propagate(domains) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = 0; index < slots.length; index += 1) {
        if (!domains[index]) continue;
        let domain = domains[index].filter((word) => !used.has(word.answer) && matches(slots[index], word));
        for (const crossing of crossings[index]) {
          const otherDomain = domains[crossing.other];
          if (!otherDomain) continue;
          const allowed = new Set(otherDomain
            .filter((word) => !used.has(word.answer))
            .map((word) => word.answer[crossing.otherPosition]));
          domain = domain.filter((word) => allowed.has(word.answer[crossing.position]));
        }
        if (!domain.length) return false;
        if (domain.length !== domains[index].length) {
          domains[index] = domain;
          changed = true;
        }
      }
      if (Date.now() >= deadline) return false;
    }
    return true;
  }

  function search(left, domains, attemptDeadline) {
    nodes += 1;
    if ((nodes & 63) === 0 && Date.now() >= attemptDeadline) return false;
    if (!left) {
      const signature = [...used].sort().join('|');
      return assigned.filter(word=>word?.isTheme).length >= requiredThemed && !history.sets.has(signature);
    }
    if (!propagate(domains)) return false;
    const themedCount = assigned.filter(word=>word?.isTheme).length;
    const possibleThemeSlots = domains.filter(domain=>domain?.some(word=>word.isTheme)).length;
    if(themedCount + possibleThemeSlots < requiredThemed) return false;
    if(themedCount + possibleThemeSlots === requiredThemed) {
      for(let i=0;i<domains.length;i++) if(domains[i]?.some(word=>word.isTheme)) domains[i]=domains[i].filter(word=>word.isTheme);
    }
    let bestIndex = -1;
    let bestCandidates = null;
    for (let index = 0; index < slots.length; index += 1) {
      if (assigned[index]) continue;
      const candidates = domains[index];
      if (!candidates.length) return false;
      if (!bestCandidates || candidates.length < bestCandidates.length) {
        bestIndex = index;
        bestCandidates = candidates;
        if (candidates.length === 1) break;
      }
    }
    for (const word of bestCandidates.toSorted((a,b)=>Number(b.isTheme)-Number(a.isTheme))) {
      put(bestIndex, word);
      const nextDomains = domains.slice();
      nextDomains[bestIndex] = null;
      if (search(left - 1, nextDomains, attemptDeadline)) return true;
      remove(bestIndex, word);
      if (Date.now() >= attemptDeadline) return false;
    }
    return false;
  }

  const anchors = [];
  for (const themeWord of themeWords) {
    for (let index = 0; index < slots.length; index += 1) {
      if (!fixedSlotIndexes.has(index) && slots[index].length === themeWord.answer.length) anchors.push({ index, word: themeWord });
    }
  }
  anchors.sort((a, b) => (history.uses.get(a.word.answer) ?? 0) - (history.uses.get(b.word.answer) ?? 0)
    || Number(b.word.common)-Number(a.word.common) || a.word.random - b.word.random);

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

  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    if (Date.now() >= deadline) break;
    const { index, word } = anchors[anchorIndex];
    put(index, word);
    const domains = slots.map((slot, slotIndex) => slotIndex === index ? null : candidatesFor(slot));
    const committed = quotaSlots(domains, index, anchorIndex);
    // Commit those slots to themed words, then search. Without the commitment a small
    // themed pool loses its candidates to crossing letters before the quota is reachable;
    // a pattern that cannot host the quota at all is skipped rather than searched.
    if (!committed.length || committed.length === requiredThemed - 1) {
      for (const slotIndex of committed) domains[slotIndex] = domains[slotIndex].filter((candidate) => candidate.isTheme);
      const remainingTime = deadline - Date.now();
      const remainingAnchors = anchors.length - anchorIndex;
      const slice = Math.max(40, Math.min(500, remainingTime / Math.min(remainingAnchors, 5)));
      if (search(slots.length - 1, domains, Date.now() + slice)) {
        const entries = slots.map((slot, slotIndex) => ({
          answer: assigned[slotIndex].answer,
          clue: assigned[slotIndex].clue,
          isTheme: assigned[slotIndex].isTheme,
          row: slot.row,
          col: slot.col,
          direction: slot.direction,
        }));
        return { grid: grid.map((row) => row.map((cell) => cell || null)), entries: numberEntries(entries) };
      }
    }

    remove(index, word);
  }
  return null;
}

function isFullyChecked(pattern) {
  const covered = new Map();
  for (const slot of makeSlots(pattern)) {
    for (const { row, col } of slot.cells) {
      const key = `${row},${col}`;
      covered.set(key, (covered.get(key) ?? 0) + 1);
    }
  }

  return pattern.every((line, row) => [...line].every((cell, col) => cell === '#' || covered.get(`${row},${col}`) === 2));
}

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

export function generateDense(options = {}) {
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
