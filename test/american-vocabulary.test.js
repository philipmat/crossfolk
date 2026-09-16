import test from 'node:test';
import assert from 'node:assert/strict';

import {americanFillWords, americanFillByLength, AMERICAN_VOCABULARY_VERSION} from '../public/layouts/american-fill-words.js';
import {americanThemeWords, americanThemeByLength} from '../public/layouts/american-theme-words.js';
import {americanPatterns, americanRules} from '../public/layouts/american-patterns.js';
import {analyzeMask} from '../public/layouts/mask-analysis.js';
import {supportedThemes} from '../public/themes.js';
import {dictionaryThemes, dictionaryWords} from '../public/wordnet-words.js';
import {fillWords} from '../public/fill-words.js';

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const CURATED_SHORT = new Set(fillWords.map(({answer}) => answer));

// Depth floors for the general-fill tier, set from measured fill feasibility rather than
// taste. A fully checked 9x9 with two theme answers pinned in symmetric slots does not
// fill at all from the original 2,309-word short bank; short-word depth, not long-word
// depth, is what the constraint problem actually runs out of.
const LENGTH_FLOORS = {3: 250, 4: 900, 5: 1200, 6: 900, 7: 300, 8: 180, 9: 180};

function assertClueSet(entry, label) {
  for (const difficulty of DIFFICULTIES) {
    const clue = entry.clue[difficulty];
    assert.equal(typeof clue, 'string', `${label}: missing ${difficulty} clue`);
    assert.ok(clue.length >= 3 && clue.length <= 70, `${label}: ${difficulty} clue length ${clue.length}`);
    assert.ok(!clue.includes('|'), `${label}: ${difficulty} clue contains a separator`);
    assert.ok(!clue.toUpperCase().includes(entry.answer), `${label}: ${difficulty} clue gives away the answer`);
  }
}

test('the curated American general-fill tier covers the lengths the short bank does not', () => {
  assert.equal(typeof AMERICAN_VOCABULARY_VERSION, 'string');
  assert.ok(americanFillWords.length > 0);

  for (const [length, floor] of Object.entries(LENGTH_FLOORS)) {
    const available = americanFillByLength[length] ?? [];
    assert.ok(available.length >= floor, `length ${length}: ${available.length} entries, need ${floor}`);
  }
});

test('every general-fill entry is a real, plainly spelled word with three clues', () => {
  const seen = new Set();

  for (const entry of americanFillWords) {
    assert.match(entry.answer, /^[A-Z]{3,9}$/, `${entry.answer} is not a 3-9 letter answer`);
    assert.ok(!seen.has(entry.answer), `${entry.answer} is duplicated`);
    seen.add(entry.answer);
    assert.ok(!CURATED_SHORT.has(entry.answer), `${entry.answer} already exists in the short curated bank`);
    assert.equal(entry.common, true, `${entry.answer} must be in the top answer tier`);
    assertClueSet(entry, entry.answer);
  }
});

// The vendored WordNet subset stores lemmas, so a curated plural or past tense will not
// appear in it verbatim. A large majority still should: a low rate here means the curation
// pass drifted towards invented or misspelled forms.
test('the curated tier stays anchored to the vendored dictionary', () => {
  const known = new Set(dictionaryWords.map(({answer}) => answer));
  for (const entries of Object.values(dictionaryThemes)) for (const {answer} of entries) known.add(answer);

  const matched = americanFillWords.filter(({answer}) => known.has(answer)).length;
  assert.ok(matched / americanFillWords.length >= 0.75, `only ${matched} of ${americanFillWords.length} answers are dictionary lemmas`);
});

test('every catalog slot length has general-fill coverage', () => {
  const shortBank = fillWords.reduce((counts, {answer}) => {
    counts[answer.length] = (counts[answer.length] ?? 0) + 1;
    return counts;
  }, {});

  for (const pattern of americanPatterns) {
    for (const length of Object.keys(analyzeMask(pattern.mask).lengthHistogram)) {
      const available = (americanFillByLength[length]?.length ?? 0) + (shortBank[length] ?? 0);
      assert.ok(available >= 60, `${pattern.id}: only ${available} general-fill answers of length ${length}`);
      assert.ok(Number(length) <= americanRules[pattern.size].maxEntryLength);
    }
  }
});

test('every built-in theme has enough featured entries to seed a rotational pair', () => {
  const themeSlotLengths = [...new Set(americanPatterns.flatMap(({themeSlotLengths: lengths}) => lengths))];
  assert.ok(themeSlotLengths.length > 0);

  for (const theme of supportedThemes) {
    const entries = americanThemeWords[theme];
    assert.ok(Array.isArray(entries) && entries.length > 0, `${theme} has no featured entries`);

    for (const length of themeSlotLengths) {
      const available = americanThemeByLength[theme]?.[length] ?? [];
      // A rotational pair needs two distinct answers at exactly the same length, and a
      // single alternative is not enough to survive the crossing constraints.
      assert.ok(available.length >= 4, `${theme}: ${available.length} featured answers of length ${length}`);
    }
  }
});

test('featured theme entries are familiar, clued for every difficulty, and not general fill', () => {
  const general = new Set(americanFillWords.map(({answer}) => answer));

  for (const theme of supportedThemes) {
    const seen = new Set();
    for (const entry of americanThemeWords[theme]) {
      assert.match(entry.answer, /^[A-Z]{5,9}$/, `${theme}/${entry.answer} is not a 5-9 letter answer`);
      assert.ok(!seen.has(entry.answer), `${theme}/${entry.answer} is duplicated`);
      seen.add(entry.answer);
      assert.ok(!general.has(entry.answer), `${theme}/${entry.answer} is also in the general-fill tier`);
      assert.equal(entry.isTheme, true);
      assert.equal(entry.common, true);
      assertClueSet(entry, `${theme}/${entry.answer}`);
    }
  }
});

test('clue variants actually differ, so difficulty is visible to the solver', () => {
  const sample = [...americanFillWords, ...supportedThemes.flatMap((theme) => americanThemeWords[theme])];
  const identical = sample.filter(({clue}) => new Set(DIFFICULTIES.map((key) => clue[key])).size === 1);

  assert.ok(identical.length / sample.length < 0.02, `${identical.length} of ${sample.length} entries repeat one clue at every difficulty`);
});
