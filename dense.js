import { miniPatterns } from './mini-patterns.js';
const SIZE_MAP = { small: 5, medium: 9, large: 13 };

// Every open square in these rotationally symmetric patterns belongs to both
// an across and a down answer, and every answer is at least three letters.
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
  9: [
    ['...###...', '...#.....', '...#.....', '#.....###', '#...#...#', '###.....#', '.....#...', '.....#...', '...###...'],
  ],
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

function normalizeWords(words, isTheme, difficulty, size) {
  if (!Array.isArray(words)) return [];
  return words.map((item) => {
    const raw = typeof item === 'string' ? { answer: item } : item;
    const answer = String(raw?.answer ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    return {
      answer,
      clue: String(clueFor(raw, difficulty) ?? `${answer.length}-letter entry`),
      isTheme,
      common: raw.common === true,
      random: Math.random(),
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

function solvePattern(pattern, words, themeWords, history, deadline) {
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
  const cellUses = Array.from({ length: size }, () => Array(size).fill(0));
  const assigned = Array(slots.length).fill(null);
  const used = new Set();
  let nodes = 0;
  const requiredThemed = Math.floor(slots.length / 2) + 1;

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
      if (!cellUses[row][col]) grid[row][col] = '';
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
      if (slots[index].length === themeWord.answer.length) anchors.push({ index, word: themeWord });
    }
  }
  anchors.sort((a, b) => (history.uses.get(a.word.answer) ?? 0) - (history.uses.get(b.word.answer) ?? 0)
    || Number(b.word.common)-Number(a.word.common) || a.word.random - b.word.random);

  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    if (Date.now() >= deadline) break;
    const { index, word } = anchors[anchorIndex];
    put(index, word);
    const domains = slots.map((slot, slotIndex) => slotIndex === index ? null : candidatesFor(slot));
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
    remove(index, word);
  }
  return null;
}

export function generateDense(options = {}) {
  const size = resolveSize(options.size);
  if (!size) return null;
  const difficulty = ['easy', 'medium', 'hard'].includes(String(options.difficulty).toLowerCase())
    ? String(options.difficulty).toLowerCase()
    : 'medium';
  const themeWords = normalizeWords(options.themeWords, true, difficulty, size);
  if (!themeWords.length) return null;
  const fillWords = normalizeWords(options.fillWords, false, difficulty, size);
  const byAnswer = new Map(fillWords.map((word) => [word.answer, word]));
  for (const word of themeWords) byAnswer.set(word.answer, word);
  const words = [...byAnswer.values()];
  const normalizedThemes = themeWords.map(({ answer }) => byAnswer.get(answer));
  const history = readHistory(options.history);
  const defaultLimit = 10000;
  const deadline = Date.now() + Math.max(100, Math.min(Number(options.timeLimitMs) || defaultLimit, 10000));

  const patterns = size === 5 ? [...miniPatterns.slice(0,2), ...miniPatterns.slice(2).toSorted(()=>Math.random()-.5)] : [...PATTERNS[size]];
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
