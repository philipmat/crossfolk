// The single source of truth for public layout-style metadata, shared by the settings UI
// on the main thread and by the worker-side registry. It deliberately imports nothing:
// app.js reads it to build the Grid style selector without pulling a generator, a word
// bank or the solver onto the main thread.
//
// Style ids are stored data. `american` and `freeform` appear in saved puzzles, so they
// must stay stable even when the user-facing labels change.

// American is the default preference: its 9x9 release gate passes at 300/300 runs. Sizes
// it does not support fall back to Free form for that generation without losing this
// preference.
export const DEFAULT_LAYOUT_STYLE = 'american';
export const FALLBACK_LAYOUT_STYLE = 'freeform';

export const layoutStyles = Object.freeze([
  Object.freeze({
    id: 'american',
    label: 'American style',
    helper: 'Symmetric rectangular grid with every letter crossed.',
    // 13x13 is absent until it passes its own fill and timing gate, and 5x5 is Free form
    // by product decision.
    supportedSizes: Object.freeze([9]),
    wordProfile: 'american-anchors',
  }),
  Object.freeze({
    id: 'freeform',
    label: 'Free form',
    helper: 'An open, loosely shaped grid built around interlocking words.',
    supportedSizes: Object.freeze([5, 9, 13]),
    wordProfile: 'freeform-bank',
  }),
]);

export function layoutStyleById(id) {
  return layoutStyles.find((style) => style.id === id) ?? null;
}

export function supportsSize(id, size) {
  return layoutStyleById(id)?.supportedSizes.includes(Number(size)) ?? false;
}

export function wordProfileFor(id) {
  return layoutStyleById(id)?.wordProfile ?? null;
}

// The style a given size can actually honor. A size the preferred style does not support
// falls back for this generation only: callers keep the preference itself so returning to
// a supported size restores it.
export function effectiveLayoutStyle(preferredId, size) {
  if (supportsSize(preferredId, size)) return preferredId;
  return FALLBACK_LAYOUT_STYLE;
}

// Plain-language reason for an unavailable style, so a fallback selection is never
// conveyed only by a disabled control.
export function availabilityNote(id, size) {
  const style = layoutStyleById(id);
  if (!style || style.supportedSizes.includes(Number(size))) return '';

  const sizes = style.supportedSizes.map((value) => `${value}x${value}`).join(' and ');
  return `${style.label} is available for ${sizes} puzzles.`;
}
