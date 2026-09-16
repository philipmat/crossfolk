// The American release harness.
//
//   node scripts/american-fill-spike.mjs --size 9 [--smoke]
//
// It is deliberately not part of `npm test`: the full matrix is 300 runs per size at a
// 13.5-second ceiling, which would make routine verification take an hour. `npm test`
// keeps one fixed smoke seed per theme instead; this harness is the recorded release
// check, and it exits nonzero when a size misses any gate.
//
// What it measures, per the release gate:
//   * every catalog mask still passes the hard structural contract;
//   * every slot length a catalog mask can require has curated coverage;
//   * seeded fill success across every theme x difficulty cell, cold and with a rolling
//     history, with failures reported by category rather than hidden;
//   * answer quality: curated tier only, no duplicates, no uncovered white cells;
//   * wall-clock time inside the dispatch envelope.

import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {generateAmerican} from '../public/layouts/american.js';
import {americanPatterns, americanRules, americanSupportedSizes, AMERICAN_CATALOG_VERSION} from '../public/layouts/american-patterns.js';
import {analyzeMask, validateAmericanMask} from '../public/layouts/mask-analysis.js';
import {americanFillWords, AMERICAN_VOCABULARY_VERSION} from '../public/layouts/american-fill-words.js';
import {americanThemeWords} from '../public/layouts/american-theme-words.js';
import {supportedThemes} from '../public/themes.js';
import {fillWords} from '../public/fill-words.js';
import {themedPlurals} from '../public/theme-plurals.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPORT = resolve(ROOT, '.local/american-release-report.json');

// Frozen before any result was seen, so a failing matrix cannot be rescued by choosing
// kinder seeds afterwards.
export const RELEASE_SEEDS = Object.freeze(['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10']);
export const COLD_SEEDS = 5;
export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);

export const GATES = Object.freeze({
  dispatchEnvelopeMs: 13_500,
  aggregateSuccess: 0.9,
  cellSuccess: 0.8,
  minimumCoveragePerLength: 60,
});

function seededRandom(label) {
  let state = 2166136261;
  for (const character of label) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state = Math.imul(state, 1664525) + 1013904223 >>> 0;
    return state / 0x100000000;
  };
}

function curatedAnswers() {
  return new Set([
    ...fillWords.map(({answer}) => answer),
    ...themedPlurals.map(({answer}) => answer),
    ...americanFillWords.map(({answer}) => answer),
    ...supportedThemes.flatMap((theme) => americanThemeWords[theme].map(({answer}) => answer)),
  ]);
}

function checkCatalog(size) {
  const failures = [];
  for (const pattern of americanPatterns.filter((entry) => entry.size === size)) {
    const broken = validateAmericanMask(pattern.mask, americanRules[size]);
    if (broken.length) failures.push({id: pattern.id, broken});
  }

  return failures;
}

function checkCoverage(size) {
  const shortBank = [...fillWords, ...themedPlurals].reduce((counts, {answer}) => {
    counts[answer.length] = (counts[answer.length] ?? 0) + 1;
    return counts;
  }, {});
  const curated = americanFillWords.reduce((counts, {answer}) => {
    counts[answer.length] = (counts[answer.length] ?? 0) + 1;
    return counts;
  }, {});

  const thin = [];
  const lengths = new Set(americanPatterns
    .filter((pattern) => pattern.size === size)
    .flatMap((pattern) => Object.keys(analyzeMask(pattern.mask).lengthHistogram).map(Number)));

  for (const length of [...lengths].sort((left, right) => left - right)) {
    const available = (curated[length] ?? 0) + (shortBank[length] ?? 0);
    if (available < GATES.minimumCoveragePerLength) thin.push({length, available});
  }

  return {byLength: Object.fromEntries([...lengths].sort((a, b) => a - b).map((length) =>
    [length, (curated[length] ?? 0) + (shortBank[length] ?? 0)])), thin};
}

function inspect(puzzle, eligible) {
  const problems = [];
  const mask = puzzle.grid.map((row) => row.map((cell) => (cell === null ? '#' : '.')).join(''));
  const metrics = analyzeMask(mask);

  if (!metrics.fullyChecked) problems.push('not-fully-checked');
  if (metrics.uncoveredWhiteCells.length) problems.push('uncovered-white-cells');
  if (metrics.entryCount !== puzzle.entries.length) problems.push('entry-count-mismatch');

  const answers = puzzle.entries.map(({answer}) => answer);
  if (new Set(answers).size !== answers.length) problems.push('duplicate-answers');
  if (answers.some((answer) => !eligible.has(answer))) problems.push('non-curated-answer');
  if (puzzle.entries.filter(({isTheme}) => isTheme).length < 2) problems.push('no-featured-pair');

  return {problems, metrics};
}

function runCell(size, theme, difficulty, seeds, eligible) {
  const runs = [];
  let rolling = [];

  seeds.forEach((seed, index) => {
    const cold = index < COLD_SEEDS;
    const history = cold ? [] : rolling;
    const started = Date.now();
    let outcome = 'success';
    let problems = [];

    try {
      const puzzle = generateAmerican({
        size,
        difficulty,
        theme,
        themeCategory: theme,
        history,
        random: seededRandom(`${theme}/${size}/${difficulty}/${seed}`),
        deadline: started + GATES.dispatchEnvelopeMs,
      });
      ({problems} = inspect(puzzle, eligible));
      if (problems.length) outcome = 'quality';
      else if (!cold) rolling = [...rolling, {answers: puzzle.entries.map(({answer}) => answer)}].slice(-8);
    } catch (error) {
      outcome = error.code ?? 'unknown-error';
    }

    runs.push({seed, cold, outcome, problems, elapsedMs: Date.now() - started});
  });

  return runs;
}

function summarize(runs) {
  const total = runs.length;
  const succeeded = runs.filter(({outcome}) => outcome === 'success').length;
  const elapsed = runs.map(({elapsedMs}) => elapsedMs).sort((left, right) => left - right);
  const at = (fraction) => elapsed[Math.min(elapsed.length - 1, Math.floor(elapsed.length * fraction))] ?? 0;

  return {
    total,
    succeeded,
    successRate: total ? succeeded / total : 0,
    slowestMs: elapsed.at(-1) ?? 0,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    byOutcome: runs.reduce((counts, {outcome}) => {
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

export function runHarness({size = 9, smoke = false} = {}) {
  const seeds = smoke ? RELEASE_SEEDS.slice(0, 1) : RELEASE_SEEDS;
  const eligible = curatedAnswers();
  const catalogFailures = checkCatalog(size);
  const coverage = checkCoverage(size);

  const cells = [];
  supportedThemes.forEach((theme, index) => {
    const difficulties = smoke ? [DIFFICULTIES[index % DIFFICULTIES.length]] : DIFFICULTIES;
    for (const difficulty of difficulties) {
      cells.push({theme, difficulty, runs: runCell(size, theme, difficulty, seeds, eligible)});
    }
  });

  const all = cells.flatMap(({runs}) => runs);
  const overall = summarize(all);
  const failures = [];

  if (catalogFailures.length) failures.push(`catalog masks failing structure: ${catalogFailures.map(({id}) => id).join(', ')}`);
  if (coverage.thin.length) failures.push(`thin vocabulary coverage: ${coverage.thin.map(({length, available}) => `${length}:${available}`).join(', ')}`);
  if (overall.successRate < GATES.aggregateSuccess) failures.push(`aggregate success ${(overall.successRate * 100).toFixed(1)}% below ${GATES.aggregateSuccess * 100}%`);
  if (overall.slowestMs >= GATES.dispatchEnvelopeMs) failures.push(`slowest run ${overall.slowestMs}ms at or beyond the ${GATES.dispatchEnvelopeMs}ms envelope`);

  for (const cell of cells) {
    const summary = summarize(cell.runs);
    cell.summary = summary;
    if (summary.successRate < GATES.cellSuccess) {
      failures.push(`${cell.theme}/${cell.difficulty} success ${(summary.successRate * 100).toFixed(0)}% below ${GATES.cellSuccess * 100}%`);
    }
  }

  return {
    size,
    smoke,
    catalogVersion: AMERICAN_CATALOG_VERSION,
    vocabularyVersion: AMERICAN_VOCABULARY_VERSION,
    gates: GATES,
    seeds,
    catalogFailures,
    coverage: coverage.byLength,
    overall,
    cells,
    failures,
    passed: failures.length === 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const smoke = args.includes('--smoke');
  const sizeArg = args.indexOf('--size');
  const size = sizeArg >= 0 ? Number(args[sizeArg + 1]) : 9;

  if (!americanSupportedSizes.includes(size)) {
    console.error(`${size}x${size} is not a registered American size.`);
    process.exit(2);
  }

  const report = runHarness({size, smoke});
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`American ${size}x${size} — ${report.overall.succeeded}/${report.overall.total} runs succeeded (${(report.overall.successRate * 100).toFixed(1)}%)`);
  console.log(`  median ${report.overall.medianMs}ms, p95 ${report.overall.p95Ms}ms, slowest ${report.overall.slowestMs}ms`);
  console.log(`  outcomes: ${JSON.stringify(report.overall.byOutcome)}`);
  console.log(`  coverage by length: ${JSON.stringify(report.coverage)}`);
  console.log(`  full report: ${REPORT}`);

  for (const failure of report.failures) console.error(`  GATE FAILED: ${failure}`);
  process.exit(report.passed ? 0 : 1);
}
