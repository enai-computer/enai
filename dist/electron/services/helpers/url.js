"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = sha256;
exports.canonicaliseUrl = canonicaliseUrl;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Creates a SHA-256 hash of the input string.
 * @param input The string to hash.
 * @returns The hex-encoded SHA-256 hash.
 */
function sha256(input) {
    return crypto_1.default.createHash('sha256').update(input).digest('hex');
}
/**
 * Performs basic canonicalization on a URL.
 * - Converts to lowercase.
 * - Removes trailing slash.
 * - Removes 'www.' prefix (consider if this is always desired).
 * TODO: Implement more robust canonicalization (e.g., remove fragments, default ports, sort query params).
 * @param url The URL string to canonicalize.
 * @returns The canonicalized URL string.
 */
function canonicaliseUrl(url) {
    try {
        // Use URL constructor for basic parsing and normalization
        const parsed = new URL(url.trim());
        let hostname = parsed.hostname.toLowerCase();
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }
        let pathname = parsed.pathname;
        if (pathname.length > 1 && pathname.endsWith('/')) {
            pathname = pathname.slice(0, -1);
        }
        // Reconstruct, omitting fragments, username/password, and standard ports
        // Query parameters are kept as is for now.
        const canonical = `${parsed.protocol}//${hostname}${pathname}${parsed.search}`;
        return canonical;
    }
    catch (error) {
        // If URL parsing fails, return the original trimmed string (or handle error differently)
        console.warn(`[URL Helper] Failed to parse URL for canonicalization: ${url}`, error);
        return url.trim().toLowerCase(); // Basic fallback
    }
}
//# sourceMappingURL=url.js.map