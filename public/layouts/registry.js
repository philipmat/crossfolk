// The one dispatch point from the engine to a layout generator.
//
// It validates the style id and the requested size against the shared metadata, calls
// exactly one generator, and stamps the authoritative `layoutStyle` and `layoutVersion` on
// the result. It holds no fallback order: a style that fails returns its own error, and a
// caller that wants a different style asks for a different style.

import {layoutStyleById, supportsSize} from './styles.js';
import {LayoutError} from './errors.js';
import {generateAmerican} from './american.js';
import {generateFreeform} from './freeform.js';

export {LayoutError} from './errors.js';

// Identifies the generated-data contract, separately from `layoutStyle`, which identifies
// the algorithm. Older version-2/3 and versionless saves still restore as Free form and
// are not rewritten.
export const LAYOUT_VERSION = 4;

const GENERATORS = Object.freeze({
  american: generateAmerican,
  freeform: generateFreeform,
});

export const registeredStyles = Object.freeze(Object.keys(GENERATORS));

export function createLayoutRegistry(generators = GENERATORS) {
  const generate = (styleId, options = {}) => {
    const style = layoutStyleById(styleId);
    const generator = generators[styleId];
    if (!style || !generator) throw new LayoutError(`Unknown grid style: ${styleId}.`, 'layout-style-unknown');
    if (!supportsSize(styleId, options.size)) {
      throw new LayoutError(`${style.label} does not support ${options.size}x${options.size} grids.`, 'layout-size-unsupported');
    }

    let result;
    try {
      result = generator(options);
    } catch (error) {
      // A style's own code survives; anything else becomes one stable value rather than
      // leaking an internal message shape to the worker boundary.
      if (error instanceof LayoutError) throw error;
      throw new LayoutError('Could not generate this puzzle. Generate again.', 'layout-generation-failed');
    }

    if (!result || !Array.isArray(result.grid) || !Array.isArray(result.entries)) {
      throw new LayoutError('Could not generate this puzzle. Generate again.', 'layout-generation-failed');
    }

    return {...result, layoutStyle: styleId, layoutVersion: LAYOUT_VERSION};
  };

  return {generate, styles: Object.freeze(Object.keys(generators))};
}

const registry = createLayoutRegistry();

export function generateLayout(styleId, options) {
  return registry.generate(styleId, options);
}
