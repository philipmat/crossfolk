import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

import {GATES, RELEASE_SEEDS, COLD_SEEDS, DIFFICULTIES, runHarness} from '../scripts/american-fill-spike.mjs';
import {americanSupportedSizes} from '../public/layouts/american-patterns.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the release gate is a frozen, auditable contract', () => {
  assert.equal(RELEASE_SEEDS.length, 10, 'the release matrix is ten fixed seeds per cell');
  assert.equal(new Set(RELEASE_SEEDS).size, RELEASE_SEEDS.length);
  assert.ok(Object.isFrozen(RELEASE_SEEDS));
  assert.equal(COLD_SEEDS, 5, 'half the seeds run cold and half against a rolling history');
  assert.deepEqual([...DIFFICULTIES], ['easy', 'medium', 'hard']);

  assert.equal(GATES.dispatchEnvelopeMs, 13_500, 'the envelope must stay inside the 15s worker termination backstop');
  assert.equal(GATES.aggregateSuccess, 0.9);
  assert.equal(GATES.cellSuccess, 0.8);
});

test('the exhaustive harness is a separate command, not part of npm test', () => {
  assert.ok(packageJson.scripts['verify:american'], 'no verify:american script');
  assert.ok(!packageJson.scripts.test.includes('american-fill-spike'), 'the 300-run matrix must not run in npm test');
  assert.match(packageJson.scripts['verify:american'], /american-fill-spike/);
});

test('13x13 stays unregistered until it passes the same gate', () => {
  assert.deepEqual([...americanSupportedSizes], [9]);
});

// One smoke pass per theme, difficulties rotated: the same shape as the release matrix
// at a fraction of the cost, so a structural or vocabulary regression fails npm test.
test('a smoke matrix passes every gate it can evaluate', () => {
  const report = runHarness({size: 9, smoke: true});

  assert.equal(report.catalogFailures.length, 0, `catalog failures: ${JSON.stringify(report.catalogFailures)}`);
  assert.equal(report.overall.total, 10, 'one smoke seed per built-in theme');
  assert.ok(report.overall.successRate >= GATES.aggregateSuccess, `smoke success ${report.overall.successRate}: ${JSON.stringify(report.overall.byOutcome)}`);
  assert.ok(report.overall.slowestMs < GATES.dispatchEnvelopeMs, `slowest smoke run ${report.overall.slowestMs}ms`);

  for (const [length, available] of Object.entries(report.coverage)) {
    assert.ok(available >= GATES.minimumCoveragePerLength, `length ${length} has only ${available} curated answers`);
  }
});
