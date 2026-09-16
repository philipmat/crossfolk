import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  DEFAULT_LAYOUT_STYLE,
  FALLBACK_LAYOUT_STYLE,
  effectiveLayoutStyle,
  layoutStyleById,
  layoutStyles,
  supportsSize,
  wordProfileFor,
} from '../public/layouts/styles.js';
import {LAYOUT_VERSION, LayoutError, createLayoutRegistry, generateLayout, registeredStyles} from '../public/layouts/registry.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function stubRegistry(generators) {
  return createLayoutRegistry(generators);
}

test('style metadata lists exactly the implemented styles', () => {
  assert.deepEqual(layoutStyles.map(({id}) => id), ['american', 'freeform']);
  assert.equal(DEFAULT_LAYOUT_STYLE, 'american');
  assert.equal(FALLBACK_LAYOUT_STYLE, 'freeform');

  for (const style of layoutStyles) {
    assert.equal(typeof style.label, 'string');
    assert.ok(style.label.length > 0);
    assert.equal(typeof style.helper, 'string');
    assert.ok(style.helper.length > 0);
    assert.ok(Array.isArray(style.supportedSizes) && style.supportedSizes.length > 0);
    assert.match(style.wordProfile, /^[a-z-]+$/);
  }

  assert.equal(layoutStyleById('creative-shape'), null, 'an unimplemented style must not be advertised');
});

test('supported sizes and word profiles come from the one metadata source', () => {
  assert.deepEqual(layoutStyleById('american').supportedSizes, [9]);
  assert.deepEqual(layoutStyleById('freeform').supportedSizes, [5, 9, 13]);

  assert.equal(supportsSize('american', 9), true);
  assert.equal(supportsSize('american', 5), false);
  assert.equal(supportsSize('american', 13), false, '13x13 stays gated until its own release gate passes');

  assert.equal(wordProfileFor('american'), 'american-anchors');
  assert.equal(wordProfileFor('freeform'), 'freeform-bank');
  assert.equal(wordProfileFor('creative-shape'), null);
});

test('an unsupported size falls back for this generation without losing the preference', () => {
  assert.equal(effectiveLayoutStyle('american', 9), 'american');
  assert.equal(effectiveLayoutStyle('american', 5), 'freeform');
  assert.equal(effectiveLayoutStyle('american', 13), 'freeform');
  assert.equal(effectiveLayoutStyle('freeform', 9), 'freeform');
  assert.equal(effectiveLayoutStyle('creative-shape', 9), 'freeform');
  assert.equal(effectiveLayoutStyle(undefined, 9), 'freeform', 'an omitted style is legacy Free form');
});

test('the registry rejects an unknown style before any generator runs', () => {
  let calls = 0;
  const registry = stubRegistry({freeform: () => { calls += 1; return {grid: [], entries: []}; }});

  assert.throws(() => registry.generate('creative-shape', {size: 9}), (error) => {
    assert.ok(error instanceof LayoutError);
    assert.equal(error.code, 'layout-style-unknown');
    return true;
  });
  assert.equal(calls, 0);
});

test('the registry validates size support before calling a generator', () => {
  let calls = 0;
  const registry = stubRegistry({american: () => { calls += 1; return {grid: [], entries: []}; }});

  assert.throws(() => registry.generate('american', {size: 13}), (error) => {
    assert.equal(error.code, 'layout-size-unsupported');
    return true;
  });
  assert.equal(calls, 0);
});

test('the registry dispatches once and never retries another style', () => {
  const calls = [];
  const registry = stubRegistry({
    american: () => {
      calls.push('american');
      throw new LayoutError('No anchors.', 'american-theme-anchors-insufficient');
    },
    freeform: () => {
      calls.push('freeform');
      return {grid: [[null]], entries: []};
    },
  });

  assert.throws(() => registry.generate('american', {size: 9}), (error) => {
    assert.equal(error.code, 'american-theme-anchors-insufficient');
    return true;
  });
  assert.deepEqual(calls, ['american'], 'an American failure must never fall through to Free form');
});

test('the registry stamps its own style and layout version over anything a generator returns', () => {
  const registry = stubRegistry({
    freeform: () => ({grid: [[null]], entries: [], layoutStyle: 'american', layoutVersion: 99}),
  });

  const result = registry.generate('freeform', {size: 9});
  assert.equal(result.layoutStyle, 'freeform');
  assert.equal(result.layoutVersion, LAYOUT_VERSION);
  assert.equal(LAYOUT_VERSION, 4);
});

test('a generator returning null is a contract violation, not a fallback signal', () => {
  const registry = stubRegistry({freeform: () => null});

  assert.throws(() => registry.generate('freeform', {size: 9}), (error) => {
    assert.equal(error.code, 'layout-generation-failed');
    return true;
  });
});

test('an unexpected generator error is normalized to a stable code', () => {
  const registry = stubRegistry({freeform: () => { throw new TypeError('boom'); }});

  assert.throws(() => registry.generate('freeform', {size: 9}), (error) => {
    assert.ok(error instanceof LayoutError);
    assert.equal(error.code, 'layout-generation-failed');
    assert.ok(!error.message.includes('boom') || typeof error.message === 'string');
    return true;
  });
});

test('the shipped registry exposes exactly the implemented styles', () => {
  assert.deepEqual([...registeredStyles].sort(), ['american', 'freeform']);
  assert.equal(typeof generateLayout, 'function');
});

test('the reserved error codes are stable machine-facing values', () => {
  assert.deepEqual([...LayoutError.codes].sort(), [
    'american-deadline-exceeded',
    'american-fill-exhausted',
    'american-theme-anchors-insufficient',
    'layout-generation-failed',
    'layout-size-unsupported',
    'layout-style-unknown',
  ]);
});

test('the dependency direction keeps styles isolated from one another', async () => {
  const read = (path) => readFile(resolve(ROOT, path), 'utf8');
  const importsOf = (source) => [...source.matchAll(/^\s*import[^;]*?from\s+'([^']+)'/gm)].map(([, specifier]) => specifier);

  const styles = await read('public/layouts/styles.js');
  assert.deepEqual(importsOf(styles), [], 'styles.js stays lightweight enough for the main thread');

  const registry = await read('public/layouts/registry.js');
  assert.ok(importsOf(registry).includes('./styles.js'));
  assert.ok(importsOf(registry).some((specifier) => specifier.includes('freeform')));

  const engine = await read('public/engine.js');
  const engineImports = importsOf(engine);
  assert.ok(engineImports.some((specifier) => specifier.includes('layouts/registry.js')));
  assert.ok(!engineImports.some((specifier) => specifier.includes('layouts/american.js')));
  assert.ok(!engineImports.some((specifier) => specifier.includes('layouts/freeform.js')));

  const american = await read('public/layouts/american.js');
  assert.ok(!importsOf(american).some((specifier) => specifier.includes('freeform') || specifier.includes('registry')));

  const freeform = await read('public/layouts/freeform.js');
  assert.ok(!importsOf(freeform).some((specifier) => specifier.includes('american') || specifier.includes('registry')));
});
