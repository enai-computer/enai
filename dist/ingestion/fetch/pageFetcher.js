"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FetchError = void 0;
exports.fetchPage = fetchPage;
const logger_1 = require("../../utils/logger");
const iconv_lite_1 = __importDefault(require("iconv-lite"));
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const TIMEOUT_MS = 8000; // 8 seconds
const MAX_REDIRECTS = 5;
/**
 * Represents errors specific to the page fetching process.
 */
class FetchError extends Error {
    constructor(message, status, httpStatusCode) {
        super(message);
        this.name = 'FetchError';
        this.status = status;
        this.httpStatusCode = httpStatusCode;
    }
}
exports.FetchError = FetchError;
/**
 * Fetches the HTML content of a given URL with constraints.
 *
 * @param initialUrl The URL to fetch.
 * @returns A promise resolving to { html: string, finalUrl: string }.
 * @throws {FetchError} If fetching fails due to timeout, size limits, HTTP errors, etc.
 */
async function fetchPage(initialUrl) {
    var _a;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let currentUrl = initialUrl;
    let redirectCount = 0;
    let response;
    try {
        logger_1.logger.debug(`[pageFetcher] Fetching URL: ${currentUrl}`);
        while (redirectCount <= MAX_REDIRECTS) {
            response = await fetch(currentUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'JeffersApp/0.1 (Page Ingestion Bot)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                },
                redirect: 'manual', // We handle redirects manually to count them
            });
            // Handle redirects
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (location) {
                    redirectCount++;
                    if (redirectCount > MAX_REDIRECTS) {
                        throw new FetchError(`Redirect limit (${MAX_REDIRECTS}) exceeded`, 'redirect_limit');
                    }
                    currentUrl = new URL(location, currentUrl).toString(); // Resolve relative URLs
                    logger_1.logger.debug(`[pageFetcher] Redirecting to: ${currentUrl} (${redirectCount}/${MAX_REDIRECTS})`);
                    response = undefined; // Clear response before retrying
                    continue; // Re-fetch the new URL
                }
                else {
                    // Treat missing Location header on redirect as an error
                    throw new FetchError(`Redirect status ${response.status} received without Location header`, 'http_error', response.status);
                }
            }
            // Check for non-successful status codes (after handling redirects)
            if (!response.ok) {
                throw new FetchError(`HTTP error ${response.status} ${response.statusText}`, 'http_error', response.status);
            }
            // We got a successful response, break the redirect loop
            break;
        }
        // If loop finished without a valid response (e.g., only redirects within limit)
        if (!response) {
            throw new FetchError('Failed to fetch final URL after redirects', 'network_error');
        }
        // Check content length header if available
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_SIZE_BYTES) {
            throw new FetchError(`Content-Length (${contentLength}) exceeds limit of ${MAX_SIZE_BYTES} bytes`, 'too_large');
        }
        if (!response.body) {
            throw new FetchError('Response body is null', 'network_error');
        }
        // Stream and decode the response body
        const reader = response.body.getReader();
        let receivedLength = 0;
        const chunks = [];
        let firstChunk = null;
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            // value can be undefined in some environments, ensure it exists
            if (!value)
                continue;
            receivedLength += value.length;
            if (receivedLength > MAX_SIZE_BYTES) {
                await reader.cancel(); // Stop reading
                throw new FetchError(`Downloaded size exceeded limit of ${MAX_SIZE_BYTES} bytes`, 'too_large');
            }
            chunks.push(value);
            if (!firstChunk) {
                firstChunk = value;
            }
        }
        const fullBuffer = Buffer.concat(chunks);
        // Detect character encoding
        let charset = 'utf-8'; // Default
        const contentTypeHeader = response.headers.get('content-type');
        if (contentTypeHeader) {
            const match = contentTypeHeader.match(/charset=([^;]+)/i);
            if (match && match[1]) {
                charset = match[1].trim().toLowerCase();
                logger_1.logger.debug(`[pageFetcher] Detected charset from header: ${charset}`);
            }
        }
        // If not found in header, try detecting from <meta> tag in the first chunk
        if (charset === 'utf-8' && firstChunk) {
            // Use the full buffer for meta tag detection for robustness, but limit scan range
            const headContent = fullBuffer.slice(0, 1024).toString('ascii');
            const metaMatch = headContent.match(/<meta.*?charset=["\']?([^"\\s\'>]+)/i);
            if (metaMatch && metaMatch[1]) {
                charset = metaMatch[1].trim().toLowerCase();
                logger_1.logger.debug(`[pageFetcher] Detected charset from meta tag: ${charset}`);
            }
        }
        // Decode the buffer
        let html;
        if (iconv_lite_1.default.encodingExists(charset)) {
            html = iconv_lite_1.default.decode(fullBuffer, charset);
        }
        else {
            // If encoding is unknown or unsupported, try UTF-8 as a fallback
            logger_1.logger.warn(`[pageFetcher] Unsupported or unknown charset: ${charset}. Falling back to UTF-8.`);
            try {
                html = fullBuffer.toString('utf-8');
            }
            catch (decodeError) {
                logger_1.logger.error(`[pageFetcher] Failed to decode content even with UTF-8 fallback for ${currentUrl}`, decodeError);
                throw new FetchError('Failed to decode content', 'charset_error');
            }
        }
        clearTimeout(timeout);
        logger_1.logger.debug(`[pageFetcher] Successfully fetched and decoded ${currentUrl} (Final URL: ${response.url || currentUrl})`);
        // finalUrl should be the URL *after* all redirects were followed
        return { html, finalUrl: currentUrl };
    }
    catch (error) {
        clearTimeout(timeout);
        // Ensure response body stream is closed/cancelled on error
        if ((_a = response === null || response === void 0 ? void 0 : response.body) === null || _a === void 0 ? void 0 : _a.locked) {
            try {
                await response.body.cancel();
            }
            catch ( /* Ignore cancellation errors */_b) { /* Ignore cancellation errors */ }
        }
        if (error instanceof FetchError) {
            logger_1.logger.warn(`[pageFetcher] Fetch failed for ${initialUrl} -> ${currentUrl}: ${error.status} - ${error.message}`);
            throw error;
        }
        else if (error instanceof Error && error.name === 'AbortError') {
            logger_1.logger.warn(`[pageFetcher] Fetch timed out for ${initialUrl} -> ${currentUrl}`);
            throw new FetchError('Request timed out', 'timeout');
        }
        else {
            logger_1.logger.error(`[pageFetcher] Unknown network error fetching ${initialUrl} -> ${currentUrl}:`, error);
            throw new FetchError(error instanceof Error ? error.message : 'Unknown network error', 'network_error');
        }
    }
}
//# sourceMappingURL=pageFetcher.js.map