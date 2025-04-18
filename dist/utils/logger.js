"use strict";
// Basic logger implementation
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const getTimestamp = () => {
    return new Date().toISOString();
};
exports.logger = {
    info: (...args) => {
        console.log(`[${getTimestamp()}] [INFO]`, ...args);
    },
    warn: (...args) => {
        console.warn(`[${getTimestamp()}] [WARN]`, ...args);
    },
    error: (...args) => {
        console.error(`[${getTimestamp()}] [ERROR]`, ...args);
    },
    debug: (...args) => {
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
//# sourceMappingURL=logger.js.map