// Basic logger implementation

const getTimestamp = (): string => {
  return new Date().toISOString();
};

export const logger = {
  info: (...args: any[]): void => {
    console.log(`[${getTimestamp()}] [INFO]`, ...args);
  },
  warn: (...args: any[]): void => {
    console.warn(`[${getTimestamp()}] [WARN]`, ...args);
  },
  error: (...args: any[]): void => {
    console.error(`[${getTimestamp()}] [ERROR]`, ...args);
  },
  debug: (...args: any[]): void => {
    // Basic check for a simple way to control debug logging, e.g., via env var
    // For now, always log debug messages during development.
    // In a real scenario, you might use process.env.NODE_ENV !== 'production'
    // or a dedicated config/env variable.
    console.debug(`[${getTimestamp()}] [DEBUG]`, ...args);
  },
};

// You could enhance this later with features like:
// - Log levels (e.g., only show INFO and above in production)
// - Writing logs to files
// - Integrating with third-party logging services
// - Adding module context automatically
