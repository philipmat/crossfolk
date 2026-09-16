import test from 'node:test';
import assert from 'node:assert/strict';

import {analyzeMask, validateAmericanMask} from '../public/layouts/mask-analysis.js';
import {
  AMERICAN_CATALOG_VERSION,
  americanPatterns,
  americanRules,
  americanSupportedSizes,
  patternsFor,
  themeSlotSignatures,
} from '../public/layouts/american-patterns.js';

test('the catalog covers only the sizes that passed a release gate', () => {
  assert.deepEqual(americanSupportedSizes, [9]);
  assert.equal(typeof AMERICAN_CATALOG_VERSION, 'string');
  assert.ok(AMERICAN_CATALOG_VERSION.length > 0);
  assert.equal(patternsFor(13, 'medium').length, 0, '13x13 stays out of the catalog until its own gate passes');
  assert.equal(patternsFor(5, 'medium').length, 0);
});

test('the 9x9 catalog carries enough variety for regeneration', () => {
  const nine = americanPatterns.filter(({size}) => size === 9);

  assert.ok(nine.length >= 12, `expected at least 12 9x9 masks, got ${nine.length}`);
  assert.equal(new Set(nine.map(({id}) => id)).size, nine.length, 'pattern ids must be unique');
  assert.equal(new Set(nine.map(({mask}) => mask.join('/'))).size, nine.length, 'masks must be distinct');
});

test('every catalog mask satisfies the hard American structure rules', () => {
  for (const {id, size, mask} of americanPatterns) {
    const rules = americanRules[size];
    assert.ok(rules, `${id}: no rules declared for size ${size}`);
    assert.deepEqual(validateAmericanMask(mask, rules), [], `${id} failed its structure rules`);
  }
});

test('declared pattern metadata is recomputed rather than trusted', () => {
  for (const pattern of americanPatterns) {
    const metrics = analyzeMask(pattern.mask);

    assert.equal(pattern.blackCount, metrics.blackCount, `${pattern.id} blackCount`);
    assert.equal(pattern.entryCount, metrics.entryCount, `${pattern.id} entryCount`);
    assert.equal(pattern.maxEntryLength, metrics.maxEntryLength, `${pattern.id} maxEntryLength`);
    assert.equal(pattern.threeLetterCount, metrics.threeLetterCount, `${pattern.id} threeLetterCount`);
    assert.deepEqual(pattern.lengthHistogram, metrics.lengthHistogram, `${pattern.id} lengthHistogram`);
    assert.equal(pattern.averageEntryLength, Number(metrics.averageEntryLength.toFixed(3)), `${pattern.id} averageEntryLength`);
    assert.equal(pattern.cheaterPairs, metrics.cheaterPairs, `${pattern.id} cheaterPairs`);
    assert.equal(pattern.adjacentBlackPairs, metrics.adjacentBlackPairs, `${pattern.id} adjacentBlackPairs`);
  }
});

test('declared theme slots are real rotational pairs of prominent equal-length entries', () => {
  for (const pattern of americanPatterns) {
    const {entries, symmetricPairs} = analyzeMask(pattern.mask);
    const known = new Set(symmetricPairs.map((pair) => pair.join(',')));

    assert.ok(pattern.themeSlots.length >= 1, `${pattern.id} declares no theme slot pair`);
    for (const pair of pattern.themeSlots) {
      assert.ok(known.has(pair.join(',')), `${pattern.id}: ${pair} is not a rotational pair`);
      const [first, second] = pair.map((index) => entries[index]);
      assert.equal(first.length, second.length);
      assert.ok(first.length >= 5, `${pattern.id}: theme slots must be at least five letters`);
      assert.ok(first.length <= americanRules[pattern.size].maxEntryLength);
    }
  }
});

test('theme-slot signatures describe the lengths a candidate pool must supply', () => {
  const signatures = themeSlotSignatures(9);

  assert.ok(signatures.length > 0);
  for (const signature of signatures) {
    assert.ok(Array.isArray(signature));
    assert.ok(signature.every((length) => Number.isInteger(length) && length >= 5));
    assert.deepEqual(signature, [...signature].sort((a, b) => a - b), 'signatures are sorted for stable comparison');
  }

  const fromPatterns = new Set(americanPatterns
    .filter(({size}) => size === 9)
    .flatMap((pattern) => pattern.themeSlots.map((pair) => analyzeMask(pattern.mask).entries[pair[0]].length)));
  for (const signature of signatures) {
    for (const length of signature) assert.ok(fromPatterns.has(length));
  }
});

test('difficulty ordering ranks the whole pool rather than filtering it', () => {
  const easy = patternsFor(9, 'easy');
  const medium = patternsFor(9, 'medium');
  const hard = patternsFor(9, 'hard');
  const nine = americanPatterns.filter(({size}) => size === 9);

  for (const ordered of [easy, medium, hard]) {
    assert.equal(ordered.length, nine.length, 'every difficulty may fall back to any valid pattern');
    assert.deepEqual([...ordered].map(({id}) => id).sort(), nine.map(({id}) => id).sort());
  }

  // Easy leads with more short footholds; Hard leads with the longer entries the curated
  // vocabulary can still support. Neither may leave the shared structural ceiling.
  assert.ok(easy[0].threeLetterCount >= hard[0].threeLetterCount);
  assert.ok(hard[0].averageEntryLength >= easy[0].averageEntryLength);
  assert.notEqual(easy[0].id, hard[0].id);
});

test('an unknown difficulty falls back to the medium ordering', () => {
  assert.deepEqual(patternsFor(9, 'impossible').map(({id}) => id), patternsFor(9, 'medium').map(({id}) => id));
});
