"use strict";
// Basic logger implementation
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const getTimestamp = () => {
    return new Date().toISOString();
};
// Determine log level (e.g., from environment variable)
// Valid levels: 'trace', 'debug', 'info', 'warn', 'error'
// Default to 'info' if not set or invalid
const LOG_LEVEL = ((_a = process.env.LOG_LEVEL) === null || _a === void 0 ? void 0 : _a.toLowerCase()) || 'info';
const LEVEL_WEIGHTS = {
    trace: 1,
    debug: 2,
    info: 3,
    warn: 4,
    error: 5,
};
const CURRENT_LEVEL_WEIGHT = LEVEL_WEIGHTS[LOG_LEVEL] || LEVEL_WEIGHTS['info'];
exports.logger = {
    trace: (...args) => {
        if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.trace) {
            console.debug(`[${getTimestamp()}] [TRACE]`, ...args); // Use console.debug for trace
        }
    },
    debug: (...args) => {
        if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.debug) {
            console.debug(`[${getTimestamp()}] [DEBUG]`, ...args);
        }
    },
    info: (...args) => {
        if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.info) {
            console.log(`[${getTimestamp()}] [INFO]`, ...args); // Use console.log for info
        }
    },
    warn: (...args) => {
        if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.warn) {
            console.warn(`[${getTimestamp()}] [WARN]`, ...args);
        }
    },
    error: (...args) => {
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
//# sourceMappingURL=logger.js.map