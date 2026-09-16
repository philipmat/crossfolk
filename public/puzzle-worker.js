import { generatePuzzle } from './engine.js';
self.onmessage = ({data}) => {
  // `deadline` is the main thread's absolute timestamp (Date.now()-based), passed through
  // unchanged so normal exhaustion can return a useful error before the termination backstop fires.
  const {deadline} = data;
  try { self.postMessage({puzzle: generatePuzzle({...data, deadline})}); }
  catch (error) {
    // Bound and normalize whatever crosses this boundary: stack traces and arbitrary
    // thrown objects never reach the posted message.
    const message = String(error?.message ?? 'Could not generate this puzzle. Generate again.').slice(0, 300);
    const code = error?.code ? String(error.code).slice(0, 64) : undefined;
    self.postMessage({error: message, code});
  }
};
