// Small portable logger shared by the local server and deployment adapters.
// Keep the output format readable in plain console streams and platform logs.
export function createLogger(consoleLike = console, now = () => new Date()) {
  const write = (level, args) => consoleLike.log(`${now().toISOString()} [${level}]`, ...args);

  return Object.freeze({
    debug: (...args) => write('DEBUG', args),
    info: (...args) => write('INFO', args),
    warn: (...args) => write('WARN', args),
    error: (...args) => write('ERROR', args)
  });
}

export const logger = createLogger();
