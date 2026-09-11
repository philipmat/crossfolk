import { generatePuzzle } from './engine.js';
self.onmessage = ({data}) => {
  try { self.postMessage({puzzle: generatePuzzle(data)}); }
  catch (error) { self.postMessage({error: error.message, code: error.code}); }
};
