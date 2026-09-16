// Builds the curated American vocabulary modules from the raw curation files.
//
//   node scripts/build-american-vocabulary.mjs [sourceDir]
//
// Source files live outside the repository by default (`.local/vocab`), because they are
// the working copy of the curation pass rather than a shipped artefact. Each line is
// pipe-separated:
//
//   general fill   ANSWER|easy clue|medium clue|hard clue        (fill-<length>-<band>.txt)
//   theme entries  theme|ANSWER|easy clue|medium clue|hard clue  (theme-*.txt)
//
// Provenance: the entries are written for this project rather than imported from a
// licensed word list, and every answer is kept only if WordNet (already vendored in
// public/wordnet-words.js) confirms the spelling. Rejected lines are reported so the
// curation pass can be redone; nothing is silently repaired.

import {readdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {dictionaryThemes, dictionaryWords} from '../public/wordnet-words.js';
import {fillWords} from '../public/fill-words.js';
import {supportedThemes} from '../public/themes.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SOURCE_DIR = resolve(ROOT, process.argv[2] ?? '.local/vocab');
const FILL_OUTPUT = resolve(ROOT, 'public/layouts/american-fill-words.js');
const THEME_OUTPUT = resolve(ROOT, 'public/layouts/american-theme-words.js');
const VOCABULARY_VERSION = 'american-vocabulary-v1';

const FILL_LENGTHS = [6, 7, 8, 9];
const THEME_LENGTHS = [5, 6, 7, 8, 9];
const MAX_CLUE = 70;

const known = new Set(dictionaryWords.map(({answer}) => answer));
for (const entries of Object.values(dictionaryThemes)) for (const {answer} of entries) known.add(answer);
for (const {answer} of fillWords) known.add(answer);

// The vendored WordNet subset stores lemmas, so a regular inflection of a known lemma is
// still a confirmed spelling. Anything that matches neither is dropped and reported: the
// curation pass is model-written, and this is the mechanical check on it.
function baseForms(answer) {
  const forms = [answer];
  if (answer.endsWith('IES')) forms.push(`${answer.slice(0, -3)}Y`);
  if (answer.endsWith('ES')) forms.push(answer.slice(0, -2));
  if (answer.endsWith('S')) forms.push(answer.slice(0, -1));
  if (answer.endsWith('ED')) {
    forms.push(answer.slice(0, -1), answer.slice(0, -2));
    if (answer.endsWith('IED')) forms.push(`${answer.slice(0, -3)}Y`);
    if (answer.length > 4 && answer.at(-3) === answer.at(-4)) forms.push(answer.slice(0, -3));
  }
  if (answer.endsWith('ING')) {
    forms.push(answer.slice(0, -3), `${answer.slice(0, -3)}E`);
    if (answer.length > 5 && answer.at(-4) === answer.at(-5)) forms.push(answer.slice(0, -4));
  }
  if (answer.endsWith('LY')) forms.push(answer.slice(0, -2));
  if (answer.endsWith('NESS')) forms.push(answer.slice(0, -4));

  return forms;
}

function isKnownSpelling(answer) {
  return baseForms(answer).some((form) => known.has(form));
}
const curatedShort = new Set(fillWords.map(({answer}) => answer));
const rejects = [];

function reject(source, line, reason) {
  rejects.push(`${source}: ${reason} — ${line.slice(0, 60)}`);
}

// A clue that repeats the answer, or the answer's stem, gives the puzzle away.
function leaksAnswer(clue, answer) {
  const upper = clue.toUpperCase();
  if (upper.includes(answer)) return true;

  const stem = answer.length > 5 ? answer.slice(0, answer.length - 2) : answer;
  return stem.length >= 5 && upper.includes(stem);
}

function readClues(fields, answer, source, line) {
  const [easy, medium, hard] = fields.map((value) => value.trim());
  for (const clue of [easy, medium, hard]) {
    if (!clue || clue.length < 3 || clue.length > MAX_CLUE) {
      reject(source, line, `clue length ${clue?.length ?? 0}`);
      return null;
    }
    if (leaksAnswer(clue, answer)) {
      reject(source, line, 'clue leaks the answer');
      return null;
    }
  }
  if (new Set([easy, medium, hard]).size === 1) {
    reject(source, line, 'all three clues are identical');
    return null;
  }

  return {easy, medium, hard};
}

async function readLines(name) {
  const text = await readFile(resolve(SOURCE_DIR, name), 'utf8');
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

async function collectFill(files) {
  const entries = new Map();

  for (const name of files) {
    for (const line of await readLines(name)) {
      const fields = line.split('|');
      if (fields.length !== 4) {
        reject(name, line, `expected 4 fields, got ${fields.length}`);
        continue;
      }

      const answer = fields[0].trim().toUpperCase();
      if (!/^[A-Z]+$/.test(answer) || !FILL_LENGTHS.includes(answer.length)) {
        reject(name, line, 'answer is not a 6-9 letter A-Z word');
        continue;
      }
      if (!isKnownSpelling(answer)) {
        reject(name, line, 'spelling is not confirmed by the vendored dictionary');
        continue;
      }
      if (curatedShort.has(answer) || entries.has(answer)) {
        reject(name, line, 'duplicate answer');
        continue;
      }

      const clue = readClues(fields.slice(1), answer, name, line);
      if (clue) entries.set(answer, {answer, clue});
    }
  }

  return [...entries.values()].sort((left, right) => left.answer.localeCompare(right.answer));
}

async function collectThemes(files) {
  const byTheme = new Map(supportedThemes.map((theme) => [theme, new Map()]));

  for (const name of files) {
    for (const line of await readLines(name)) {
      const fields = line.split('|');
      if (fields.length !== 5) {
        reject(name, line, `expected 5 fields, got ${fields.length}`);
        continue;
      }

      const theme = fields[0].trim().toLowerCase();
      const answer = fields[1].trim().toUpperCase();
      if (!byTheme.has(theme)) {
        reject(name, line, `unknown theme ${theme}`);
        continue;
      }
      if (!/^[A-Z]+$/.test(answer) || !THEME_LENGTHS.includes(answer.length)) {
        reject(name, line, 'answer is not a 5-9 letter A-Z word');
        continue;
      }
      if (!isKnownSpelling(answer)) {
        reject(name, line, 'spelling is not confirmed by the vendored dictionary');
        continue;
      }
      if (byTheme.get(theme).has(answer)) {
        reject(name, line, 'duplicate answer');
        continue;
      }

      const clue = readClues(fields.slice(2), answer, name, line);
      if (clue) byTheme.get(theme).set(answer, {answer, clue});
    }
  }

  return byTheme;
}

function renderSource(entries) {
  return entries.map(({answer, clue}) => `${answer}|${clue.easy}|${clue.medium}|${clue.hard}`).join('\n');
}

function fillModule(entries) {
  return `// Generated by scripts/build-american-vocabulary.mjs. Do not edit by hand.
//
// The curated general-fill tier for American grids, covering the 6-9 letter lengths the
// short bank in fill-words.js does not reach. Membership here — not presence in WordNet —
// is what makes an answer production-eligible and "common" for American fill scoring.
//
// Each line is ANSWER|easy clue|medium clue|hard clue. Every answer's spelling is
// confirmed against the vendored WordNet data at build time.

export const AMERICAN_VOCABULARY_VERSION = '${VOCABULARY_VERSION}';

const source = \`
${renderSource(entries)}
\`;

function parse(text) {
  return text.trim().split('\\n').map((line) => {
    const [answer, easy, medium, hard] = line.split('|');
    return {answer, clue: {easy, medium, hard}, common: true, isTheme: false};
  });
}

export const americanFillWords = Object.freeze(parse(source));

export const americanFillByLength = Object.freeze(americanFillWords.reduce((buckets, entry) => {
  (buckets[entry.answer.length] ??= []).push(entry);
  return buckets;
}, {}));
`;
}

function themeModule(byTheme) {
  const blocks = [...byTheme.entries()]
    .map(([theme, entries]) => `${theme}: \`
${renderSource([...entries.values()].sort((left, right) => left.answer.localeCompare(right.answer)))}
\`,`)
    .join('\n');

  return `// Generated by scripts/build-american-vocabulary.mjs. Do not edit by hand.
//
// Featured theme entries for American grids: familiar, clue-worthy answers long enough to
// occupy a prominent rotational slot pair. Raw dictionaryThemes material is curation
// input, not a production tier, so nothing here comes straight from WordNet.
//
// Each line is ANSWER|easy clue|medium clue|hard clue.

const sources = {
${blocks}
};

function parse(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  return trimmed.split('\\n').map((line) => {
    const [answer, easy, medium, hard] = line.split('|');
    return {answer, clue: {easy, medium, hard}, common: true, isTheme: true};
  });
}

export const americanThemeWords = Object.freeze(Object.fromEntries(
  Object.entries(sources).map(([theme, text]) => [theme, Object.freeze(parse(text))])
));

export const americanThemeByLength = Object.freeze(Object.fromEntries(
  Object.entries(americanThemeWords).map(([theme, entries]) => [theme, Object.freeze(entries.reduce((buckets, entry) => {
    (buckets[entry.answer.length] ??= []).push(entry);
    return buckets;
  }, {}))])
));
`;
}

const files = await readdir(SOURCE_DIR);
const collected = await collectFill(files.filter((name) => name.startsWith('fill-') && name.endsWith('.txt')).sort());
const themes = await collectThemes(files.filter((name) => name.startsWith('theme-') && name.endsWith('.txt')).sort());

// Featured entries win a collision: an answer that carries a theme's clue must not also
// appear as anonymous general fill, and the curated theme banks are the scarcer tier.
const featured = new Set([...themes.values()].flatMap((entries) => [...entries.keys()]));
const fill = collected.filter(({answer}) => !featured.has(answer));

await writeFile(FILL_OUTPUT, fillModule(fill));
await writeFile(THEME_OUTPUT, themeModule(themes));

const byLength = fill.reduce((counts, {answer}) => {
  counts[answer.length] = (counts[answer.length] ?? 0) + 1;
  return counts;
}, {});

console.log(`general fill: ${fill.length} entries`, byLength);
for (const [theme, entries] of themes) {
  const lengths = [...entries.values()].reduce((counts, {answer}) => {
    counts[answer.length] = (counts[answer.length] ?? 0) + 1;
    return counts;
  }, {});
  console.log(`  ${theme}: ${entries.size}`, lengths);
}
console.log(`rejected lines: ${rejects.length}`);
for (const line of rejects.slice(0, 40)) console.log(`  ${line}`);
if (rejects.length > 40) console.log(`  … and ${rejects.length - 40} more`);
