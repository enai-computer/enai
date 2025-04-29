"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnsupportedContentTypeError = exports.FetchHTTPError = exports.FetchSizeLimitError = exports.FetchTimeoutError = void 0;
exports.fetchPage = fetchPage;
const logger_1 = require("../../utils/logger");
const iconv_lite_1 = __importDefault(require("iconv-lite"));
const node_html_parser_1 = require("node-html-parser"); // For parsing <meta> tags
// const MAX_REDIRECTS = 5; // Commented out: Standard fetch 'follow' handles redirects (~20 limit), manual limiting is complex.
const TIMEOUT_MS = 12000; // 12 seconds - Increased default timeout
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
const DEFAULT_USER_AGENT = 'JeffersClient/0.1 (+https://github.com/your-repo/jeffers)'; // TODO: Update repo URL
// --- Custom Error Classes ---
class FetchTimeoutError extends Error {
    constructor(message = `Fetch timed out after ${TIMEOUT_MS / 1000} seconds`) {
        super(message);
        this.name = 'FetchTimeoutError';
    }
}
exports.FetchTimeoutError = FetchTimeoutError;
class FetchSizeLimitError extends Error {
    constructor(message = `Response exceeded size limit of ${MAX_SIZE_BYTES / 1024 / 1024} MB`) {
        super(message);
        this.name = 'FetchSizeLimitError';
    }
}
exports.FetchSizeLimitError = FetchSizeLimitError;
class FetchHTTPError extends Error {
    constructor(response, message) {
        const defaultMessage = `HTTP error ${response.status} ${response.statusText} for URL ${response.url}`;
        super(message || defaultMessage);
        this.name = 'FetchHTTPError';
        this.status = response.status;
        this.statusText = response.statusText;
    }
}
exports.FetchHTTPError = FetchHTTPError;
class UnsupportedContentTypeError extends Error {
    constructor(contentType, message) {
        const typeInfo = contentType ? `(${contentType})` : '(Unknown Type)';
        super(message || `Content type ${typeInfo} is not supported for parsing.`);
        this.name = 'UnsupportedContentTypeError';
        this.contentType = contentType;
    }
}
exports.UnsupportedContentTypeError = UnsupportedContentTypeError;
/**
 * Fetches the HTML content of a given URL with size and time limits.
 * Detects character encoding and decodes to UTF-8.
 * Only processes responses with text/html or similar Content-Types.
 * @param urlString The URL to fetch.
 * @param options Optional overrides for limits.
 * @returns A promise resolving to FetchPageResult { html: string, finalUrl: string }.
 * @throws {FetchTimeoutError} If the request times out.
 * @throws {FetchSizeLimitError} If the response exceeds the size limit.
 * @throws {FetchHTTPError} If an HTTP error status (4xx, 5xx) is received.
 * @throws {UnsupportedContentTypeError} If the Content-Type is not suitable for parsing (e.g., image, pdf).
 * @throws {Error} For other network or fetch-related errors (original error preserved in `cause`).
 */
async function fetchPage(urlString, options = {}) {
    const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    const maxSizeBytes = options.maxSizeBytes ?? MAX_SIZE_BYTES;
    const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    const controller = new AbortController();
    const startTime = Date.now(); // Start timer for logging
    const timeoutId = setTimeout(() => {
        const elapsedMs = Date.now() - startTime;
        logger_1.logger.warn(`[pageFetcher] Timeout triggered for ${urlString} after ${elapsedMs}ms (limit: ${timeoutMs}ms)`);
        const err = new FetchTimeoutError(`Fetch timed out for ${urlString} after ${elapsedMs}ms`);
        controller.abort(err); // Pass only the error instance
    }, timeoutMs);
    let response;
    try {
        logger_1.logger.debug(`[pageFetcher] Fetching URL: ${urlString}`);
        response = await fetch(urlString, {
            signal: controller.signal,
            redirect: 'follow', // Standard fetch handles redirects
            headers: {
                'User-Agent': userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/*;q=0.8,*/*;q=0.7',
                'Accept-Encoding': 'gzip, br', // Added Accept-Encoding
            },
        });
        // We got a response, clear the timeout
        clearTimeout(timeoutId);
        // --- Early Content-Length Check ---
        const declaredLen = Number(response.headers.get('content-length') ?? 0);
        if (declaredLen && declaredLen > maxSizeBytes) {
            const errMsg = `Declared Content-Length ${declaredLen} bytes exceeds limit of ${maxSizeBytes} bytes for ${response.url}`;
            logger_1.logger.warn(`[pageFetcher] ${errMsg}`);
            throw new FetchSizeLimitError(errMsg);
        }
        // --- End Early Content-Length Check ---
        // Check for HTTP errors (4xx, 5xx)
        if (!response.ok) {
            // Body might be useful for debugging, but avoid reading large error pages
            // Consider adding optional small body read here if needed.
            throw new FetchHTTPError(response);
        }
        // --- MIME Type Check ---
        const contentTypeHeader = response.headers.get('content-type');
        const contentType = contentTypeHeader?.split(';')[0].trim().toLowerCase(); // Get MIME type part
        if (contentType && !contentType.startsWith('text/') &&
            contentType !== 'application/xhtml+xml' &&
            contentType !== 'application/xml') {
            throw new UnsupportedContentTypeError(contentTypeHeader);
        }
        // Allow proceeding if content type is missing, rely on parsing later
        // --- Size Limit Check and Body Reading ---
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('Response body is not readable');
        }
        const chunks = [];
        let receivedLength = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            chunks.push(value);
            receivedLength += value.length;
            if (receivedLength > maxSizeBytes) {
                const elapsedMs = Date.now() - startTime;
                const errMsg = `Response body exceeded size limit of ${maxSizeBytes / 1024 / 1024} MB after ${elapsedMs}ms (received ${receivedLength} bytes) for ${response.url}`;
                logger_1.logger.warn(`[pageFetcher] ${errMsg}`);
                const err = new FetchSizeLimitError(errMsg);
                // await reader.cancel(err); // Removed redundant cancel call
                controller.abort(err); // Abort the controller with the specific error
                break; // Exit loop after aborting
            }
        }
        // Check if the loop was exited due to abort (size limit)
        if (controller.signal.aborted && controller.signal.reason instanceof FetchSizeLimitError) {
            // This ensures the error is thrown even if reader.cancel() doesn't immediately reject the fetch promise
            throw controller.signal.reason;
        }
        const bodyBuffer = Buffer.concat(chunks);
        logger_1.logger.debug(`[pageFetcher] Fetched ${receivedLength} bytes from ${response.url}`);
        // --- Charset Detection and Decoding ---
        let encoding = 'utf-8'; // Default
        if (contentTypeHeader) {
            // Re-check header now that we have the full buffer if needed (though initial check is usually enough)
            const match = contentTypeHeader.match(/charset=([^;]+)/i);
            if (match && match[1]) {
                const detected = match[1].trim().toLowerCase();
                if (iconv_lite_1.default.encodingExists(detected)) {
                    encoding = detected;
                    logger_1.logger.debug(`[pageFetcher] Detected encoding from Content-Type header: ${encoding}`);
                }
                else {
                    logger_1.logger.warn(`[pageFetcher] Unsupported encoding in Content-Type header: ${detected}`);
                }
            }
        }
        // If no valid encoding from header, try parsing HTML meta tags
        // TODO: This assumes UTF-8/ASCII compatibility for meta tag sniffing.
        // Pages with incompatible multi-byte encodings (e.g., Shift-JIS) might fail detection here.
        if (encoding === 'utf-8' && contentType?.includes('html')) {
            const headChunk = bodyBuffer.subarray(0, 1024).toString('utf-8'); // Tentative decode
            try {
                const root = (0, node_html_parser_1.parse)(headChunk, { lowerCaseTagName: true });
                const metaCharset = root.querySelector('meta[charset]');
                const metaHttpEquiv = root.querySelector('meta[http-equiv="content-type" i]');
                if (metaCharset) {
                    const detected = metaCharset.getAttribute('charset')?.trim().toLowerCase();
                    if (detected && iconv_lite_1.default.encodingExists(detected)) {
                        encoding = detected;
                        logger_1.logger.debug(`[pageFetcher] Detected encoding from <meta charset>: ${encoding}`);
                    }
                }
                else if (metaHttpEquiv) {
                    const contentAttr = metaHttpEquiv.getAttribute('content');
                    const match = contentAttr?.match(/charset=([^;]+)/i);
                    if (match && match[1]) {
                        const detected = match[1].trim().toLowerCase();
                        if (iconv_lite_1.default.encodingExists(detected)) {
                            encoding = detected;
                            logger_1.logger.debug(`[pageFetcher] Detected encoding from <meta http-equiv>: ${encoding}`);
                        }
                        else {
                            logger_1.logger.warn(`[pageFetcher] Unsupported encoding in <meta http-equiv>: ${detected}`);
                        }
                    }
                }
            }
            catch (parseError) {
                logger_1.logger.warn('[pageFetcher] Error parsing head chunk for meta tags', parseError);
                // Fallback to default UTF-8
            }
        }
        // Decode the full buffer
        const decodedHtml = iconv_lite_1.default.decode(bodyBuffer, encoding);
        // Log byte count at trace level
        logger_1.logger.trace(`[pageFetcher] Decoded ${bodyBuffer.length} bytes from ${response.url} (final encoding: ${encoding})`);
        return {
            html: decodedHtml,
            finalUrl: response.url, // URL after redirects
        };
    }
    catch (error) {
        // Ensure timeout is cleared on any error
        clearTimeout(timeoutId);
        // Log and re-throw specific known errors
        if (error instanceof FetchTimeoutError ||
            error instanceof FetchSizeLimitError ||
            error instanceof FetchHTTPError ||
            error instanceof UnsupportedContentTypeError) {
            logger_1.logger.warn(`[pageFetcher] Fetch failed for ${urlString}: ${error.name} - ${error.message}`);
            throw error;
        }
        else if (error.name === 'AbortError') {
            // Handle aborts triggered by our specific errors
            if (controller.signal.reason instanceof FetchTimeoutError ||
                controller.signal.reason instanceof FetchSizeLimitError) {
                logger_1.logger.warn(`[pageFetcher] Fetch aborted for ${urlString}: ${controller.signal.reason.name}`);
                throw controller.signal.reason;
            }
            // Otherwise, it might be an external abort or unexpected AbortError
            logger_1.logger.error(`[pageFetcher] Fetch aborted unexpectedly for ${urlString}:`, error);
            // Preserve original error using cause
            const abortErr = new Error(`Fetch aborted unexpectedly for ${urlString}: ${error.message}`);
            abortErr.cause = error; // Assign cause separately
            throw abortErr;
        }
        else {
            // Handle other unexpected errors
            logger_1.logger.error(`[pageFetcher] Unexpected fetch error for ${urlString}:`, error);
            // Preserve original error using cause
            const unexpectedErr = new Error(`Unexpected fetch error for ${urlString}: ${error.message || 'Unknown error'}`);
            unexpectedErr.cause = error; // Assign cause separately
            throw unexpectedErr;
        }
    }
}
//# sourceMappingURL=pageFetcher.js.map