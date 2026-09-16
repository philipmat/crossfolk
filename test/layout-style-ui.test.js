import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

import {DEFAULT_LAYOUT_STYLE, layoutStyles} from '../public/layouts/styles.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../public/puzzle-worker.js', import.meta.url), 'utf8');

test('the settings form offers a labelled Grid style select with described helper text', () => {
  assert.match(html, /<label[^>]+for="layout-style"[^>]*>\s*Grid style\s*<\/label>/i);
  assert.match(html, /<select[^>]+id="layout-style"[^>]*>/i);

  const select = html.match(/<select[^>]+id="layout-style"[^>]*>/i)[0];
  const describedBy = select.match(/aria-describedby="([^"]+)"/i);
  assert.ok(describedBy, 'the select must point at its helper text');
  assert.ok(html.includes(`id="${describedBy[1]}"`), 'the described helper element must exist');
});

test('the Grid style control sits between Puzzle size and Difficulty', () => {
  const sizeAt = html.indexOf('id="sizes"');
  const styleAt = html.indexOf('id="layout-style"');
  const difficultyAt = html.indexOf('id="difficulties"');

  assert.ok(sizeAt > 0 && styleAt > 0 && difficultyAt > 0);
  assert.ok(sizeAt < styleAt && styleAt < difficultyAt, 'the new control is out of order');
});

test('options come from the style metadata rather than duplicated markup', () => {
  const select = html.slice(html.indexOf('id="layout-style"'));
  const body = select.slice(0, select.indexOf('</select>'));
  assert.ok(!body.includes('<option'), 'options are populated from styles.js, not hard-coded');

  assert.match(app, /from '\.\/layouts\/styles\.js'/);
  for (const style of layoutStyles) assert.ok(app.includes(style.id) || app.includes('layoutStyles'), `${style.id} unreachable from app.js`);
});

test('an unimplemented Creative shape style is not advertised anywhere', () => {
  assert.ok(!html.includes('creative-shape'));
  assert.ok(!html.toLowerCase().includes('creative shape'));
  assert.ok(!app.includes('creative-shape'));
});

test('the select is a comfortable touch target with visible keyboard focus', () => {
  const rule = css.match(/#layout-style\s*\{[^}]*\}/);
  assert.ok(rule, 'style.css has no #layout-style rule');
  assert.match(rule[0], /min-height:\s*(4[4-9]|[5-9]\d)px/);
  assert.match(css, /#layout-style:focus-visible\s*\{/);
});

test('a style preference survives a size that cannot honor it', () => {
  assert.match(app, /preferredLayoutStyle\s*=\s*DEFAULT_LAYOUT_STYLE/);
  assert.equal(DEFAULT_LAYOUT_STYLE, 'freeform');
  assert.match(app, /effectiveLayoutStyle\(/);
  // The preference itself is only reassigned from an explicit user choice.
  assert.match(app, /onchange=[^\n]*preferredLayoutStyle=/);
  assert.match(app, /availabilityNote\(/);
});

test('the AI request carries the derived word profile and never the style name', () => {
  const payload = app.match(/Object\.freeze\(\{theme,size,difficulty,[^}]*\}\)/);
  assert.ok(payload, 'the immutable request payload has moved');
  assert.match(payload[0], /wordProfile/);
  assert.ok(!payload[0].includes('layoutStyle'), 'the server must depend on candidate requirements, not UI style names');
});

test('one frozen generation intent feeds both the AI request and the worker', () => {
  assert.match(app, /const intent=Object\.freeze\(/);
  // The worker payload is built from the snapshot, not by re-reading the controls after
  // the AI call resolves.
  assert.match(app, /generatePuzzle\(\{\.\.\.[a-zA-Z]+,history,words/);
  assert.ok(!/generatePuzzle\(\{theme,size,difficulty,history,words\}\)/.test(app), 'the worker call still re-reads live control state');
});

test('the worker receives an absolute deadline inside the termination backstop', () => {
  assert.match(app, /deadline:/);
  assert.match(app, /13500|13_500/);
  assert.match(app, /15000|15_000/);
  assert.match(worker, /deadline/);
});

test('the worker boundary keeps error codes stable and bounded', () => {
  assert.match(worker, /code/);
  assert.match(worker, /slice\(0,\s*\d+\)/, 'error strings crossing the boundary must be bounded');
  assert.ok(!worker.includes('error.stack'));
});

test('known layout failures get concise user-facing copy', () => {
  for (const code of ['american-theme-anchors-insufficient', 'american-fill-exhausted', 'american-deadline-exceeded']) {
    assert.ok(app.includes(code), `${code} has no user-facing message`);
  }
});

test('saved puzzles restore their style, defaulting old saves to Free form', () => {
  assert.match(app, /puzzle\.layoutStyle\s*(\?\?|\|\|)\s*'freeform'/);
});

test('the entry summary is style-aware', () => {
  assert.match(app, /featured theme entr/i);
  assert.match(app, /themed/, 'Free form keeps its existing wording');
});
