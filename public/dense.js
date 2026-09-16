const SIZE_MAP = { small: 5, medium: 9, large: 13 };

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

// A style-neutral constraint solver: given a pattern and a word pool, it builds the slot
// list, the crossing index and the candidate domains, then exposes the mechanics a driver
// needs to run its own backtracking search (`search`) with its own policy hooks.
function createSolver(pattern, words, { fixedLetters = [], history, interrupt = () => false } = {}) {
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
      || Number(b.isTheme) - Number(a.isTheme) || Number(b.common) - Number(a.common) || a.random - b.random);
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
      // One propagation sweep over a large pool is expensive enough that a caller's
      // deadline can pass entirely inside this loop. Without this check the search only
      // notices every sixty-fourth node, and a bounded attempt overruns its budget.
      if (interrupt()) return false;
    }
    return true;
  }

  function initialDomains(excludedIndex) {
    return slots.map((slot, slotIndex) => slotIndex === excludedIndex ? null : candidatesFor(slot));
  }

  function search({ stop, domains = initialDomains(), left = slots.length - assigned.filter(Boolean).length, prune = () => true, accept = () => true }) {
    let nodes = 0;

    function attempt(remaining, currentDomains) {
      nodes += 1;
      if ((nodes & 63) === 0 && stop()) return false;
      if (!remaining) return accept(assigned, used);
      if (!propagate(currentDomains)) return false;
      if (!prune(currentDomains, assigned)) return false;

      let bestIndex = -1;
      let bestCandidates = null;
      for (let index = 0; index < slots.length; index += 1) {
        if (assigned[index]) continue;
        const candidates = currentDomains[index];
        if (!candidates.length) return false;
        if (!bestCandidates || candidates.length < bestCandidates.length) {
          bestIndex = index;
          bestCandidates = candidates;
          if (candidates.length === 1) break;
        }
      }

      for (const word of bestCandidates.toSorted((a, b) => Number(b.isTheme) - Number(a.isTheme))) {
        put(bestIndex, word);
        const nextDomains = currentDomains.slice();
        nextDomains[bestIndex] = null;
        if (attempt(remaining - 1, nextDomains)) return true;
        remove(bestIndex, word);
        if (stop()) return false;
      }
      return false;
    }

    return attempt(left, domains);
  }

  function result() {
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

  return {
    slots,
    crossings,
    assigned,
    used,
    fixedSlotIndexes,
    candidatesFor,
    initialDomains,
    put,
    remove,
    propagate,
    search,
    result,
  };
}

export { makeSlots, numberEntries, isFullyChecked, normalizeWords, readHistory, resolveSize, createSolver };
