import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  restoredThemeSelection,
  selectedTheme,
  supportedThemes,
} from '../public/themes.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('theme picker lists every built-in theme and offers custom text', () => {
  assert.match(html, /<select[^>]+id="theme-preset"/);
  for (const theme of supportedThemes) {
    assert.match(html, new RegExp(`<option[^>]+value="${theme}"`, 'i'));
  }
  assert.match(html, /<option[^>]+value="">Custom theme…<\/option>/);
  assert.match(html, /id="theme"[^>]+placeholder="Choose a theme or create your own"/);
});

test('custom text takes precedence over the selected preset', () => {
  assert.equal(selectedTheme('  architecture  ', 'ocean'), 'architecture');
  assert.equal(selectedTheme('', 'space'), 'space');
  assert.equal(selectedTheme('   ', ''), '');
});

test('saved themes restore to the matching control', () => {
  assert.deepEqual(restoredThemeSelection('  OcEaN  '), { preset: 'ocean', custom: '' });
  assert.deepEqual(restoredThemeSelection('Architecture'), { preset: '', custom: 'Architecture' });
});
