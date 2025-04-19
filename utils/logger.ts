// Basic logger implementation

const getTimestamp = (): string => {
  return new Date().toISOString();
};

// Determine log level (e.g., from environment variable)
// Valid levels: 'trace', 'debug', 'info', 'warn', 'error'
// Default to 'info' if not set or invalid
const LOG_LEVEL = process.env.LOG_LEVEL?.toLowerCase() || 'info';
const LEVEL_WEIGHTS: { [key: string]: number } = {
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
};
const CURRENT_LEVEL_WEIGHT = LEVEL_WEIGHTS[LOG_LEVEL] || LEVEL_WEIGHTS['info'];

export const logger = {
  trace: (...args: any[]): void => {
    if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.trace) {
        console.debug(`[${getTimestamp()}] [TRACE]`, ...args); // Use console.debug for trace
    }
  },
  debug: (...args: any[]): void => {
    if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.debug) {
        console.debug(`[${getTimestamp()}] [DEBUG]`, ...args);
    }
  },
  info: (...args: any[]): void => {
    if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.info) {
        console.log(`[${getTimestamp()}] [INFO]`, ...args); // Use console.log for info
    }
  },
  warn: (...args: any[]): void => {
    if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.warn) {
        console.warn(`[${getTimestamp()}] [WARN]`, ...args);
    }
  },
  error: (...args: any[]): void => {
    if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.error) {
        console.error(`[${getTimestamp()}] [ERROR]`, ...args);
    }
  },
};

console.log(`[Logger] Initialized with level: ${LOG_LEVEL.toUpperCase()} (Weight: ${CURRENT_LEVEL_WEIGHT})`); // Log initialization level

// You could enhance this later with features like:
// - Writing logs to files
// - Integrating with third-party logging services
// - Adding module context automatically
