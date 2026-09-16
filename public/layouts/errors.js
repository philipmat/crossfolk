// Stable, machine-facing failure codes for layout generation. They cross the worker
// boundary and reach `app.js`, so the strings are a contract: user-facing copy may change
// freely, these values may not.
//
// The module imports nothing so both the registry and an individual style can throw
// without importing each other.

export const LAYOUT_ERROR_CODES = Object.freeze([
  'layout-style-unknown',
  'layout-size-unsupported',
  'layout-generation-failed',
  'american-theme-anchors-insufficient',
  'american-fill-exhausted',
  'american-deadline-exceeded',
]);

export class LayoutError extends Error {
  static codes = Object.freeze(new Set(LAYOUT_ERROR_CODES));

  constructor(message, code) {
    super(message);
    this.name = 'LayoutError';
    this.code = LayoutError.codes.has(code) ? code : 'layout-generation-failed';
  }
}
