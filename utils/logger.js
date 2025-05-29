"use strict";
// Basic logger implementation
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
var getTimestamp = function () {
    return new Date().toISOString();
};
// Determine log level (e.g., from environment variable)
// Valid levels: 'trace', 'debug', 'info', 'warn', 'error'
// Default to 'info' if not set or invalid
var LOG_LEVEL = ((_a = process.env.LOG_LEVEL) === null || _a === void 0 ? void 0 : _a.toLowerCase()) || 'info';
var LEVEL_WEIGHTS = {
    trace: 1,
    debug: 2,
    info: 3,
    warn: 4,
    error: 5,
};
var CURRENT_LEVEL_WEIGHT = LEVEL_WEIGHTS[LOG_LEVEL] || LEVEL_WEIGHTS['info'];
exports.logger = {
    trace: function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.trace) {
            console.debug.apply(console, __spreadArray(["[".concat(getTimestamp(), "] [TRACE]")], args, false)); // Use console.debug for trace
        }
    },
    debug: function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.debug) {
            console.debug.apply(console, __spreadArray(["[".concat(getTimestamp(), "] [DEBUG]")], args, false));
        }
    },
    info: function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.info) {
            console.log.apply(console, __spreadArray(["[".concat(getTimestamp(), "] [INFO]")], args, false)); // Use console.log for info
        }
    },
    warn: function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.warn) {
            console.warn.apply(console, __spreadArray(["[".concat(getTimestamp(), "] [WARN]")], args, false));
        }
    },
    error: function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (CURRENT_LEVEL_WEIGHT <= LEVEL_WEIGHTS.error) {
            console.error.apply(console, __spreadArray(["[".concat(getTimestamp(), "] [ERROR]")], args, false));
        }
    },
};
console.log("[Logger] Initialized with level: ".concat(LOG_LEVEL.toUpperCase(), " (Weight: ").concat(CURRENT_LEVEL_WEIGHT, ")")); // Log initialization level
// You could enhance this later with features like:
// - Writing logs to files
// - Integrating with third-party logging services
// - Adding module context automatically
