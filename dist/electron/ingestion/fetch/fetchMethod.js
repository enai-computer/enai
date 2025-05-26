"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPageWithFallback = fetchPageWithFallback;
const pageFetcher_1 = require("./pageFetcher");
const logger_1 = require("../../utils/logger");
/**
 * Fetches page content, trying a plain fetch first and falling back to Browserbase
 * for specific recoverable errors.
 *
 * @param url The URL to fetch.
 * @param options Optional fetch options (currently only passed to plain fetch).
 *                // TODO: Consider if Browserbase needs separate/mapped options.
 * @returns A promise resolving to FetchPageResult { html: string, finalUrl: string }.
 * @throws {Error} Throws errors from the underlying fetchers if they are not handled
 *                 or if the fallback also fails.
 */
async function fetchPageWithFallback(url, 
// Add options if needed, matching pageFetcher's options for now
options = {}) {
    try {
        logger_1.logger.debug(`[fetchMethod] Attempting plain fetch for: ${url}`);
        // Pass options only to the plain fetcher initially
        const result = await (0, pageFetcher_1.fetchPage)(url, options);
        logger_1.logger.info(`[fetchMethod] Plain fetch successful for: ${url}`);
        return result;
    }
    catch (plainFetchError) {
        logger_1.logger.warn(`[fetchMethod] Plain fetch failed for ${url}: ${plainFetchError?.name ?? 'UnknownError'} - ${plainFetchError?.message ?? 'No message'}`);
        // Determine if we should fallback
        // Fallback for Timeout, HTTP errors, Unsupported Content Type, and generic network errors
        // DO NOT fallback for Size Limit errors.
        const shouldFallback = (plainFetchError instanceof pageFetcher_1.FetchTimeoutError ||
            plainFetchError instanceof pageFetcher_1.FetchHTTPError ||
            plainFetchError instanceof pageFetcher_1.UnsupportedContentTypeError ||
            // Catch other general errors but specifically exclude Size Limit
            (!(plainFetchError instanceof pageFetcher_1.FetchSizeLimitError) && plainFetchError instanceof Error));
        if (shouldFallback) {
            logger_1.logger.info(`[fetchMethod] Browserbase fallback disabled. Not attempting fallback for: ${url}`);
            // BROWSERBASE DISABLED - Comment out the following block to re-enable
            /*
            logger.info(`[fetchMethod] Falling back to Browserbase for: ${url}`);
            try {
              // Options are not currently passed to Browserbase fetcher.
              // Add if needed: await fetchWithBrowserbase(url, browserbaseOptions);
              const browserbaseResult = await fetchWithBrowserbase(url);
              logger.info(`[fetchMethod] Browserbase fallback successful for: ${url}`);
              return browserbaseResult;
            } catch (browserbaseError: any) {
              logger.error(
                `[fetchMethod] Browserbase fallback ALSO failed for ${url}: ${browserbaseError?.name ?? 'UnknownError'} - ${browserbaseError?.message ?? 'No message'}`,
              );
              // Throw the Browserbase error if the fallback fails, making it the final error source
              throw browserbaseError;
            }
            */
            // Since browserbase is disabled, throw the original error
            throw plainFetchError;
        }
        else {
            // Don't fallback for FetchSizeLimitError or non-error throws
            logger_1.logger.warn(`[fetchMethod] Not falling back to Browserbase for ${url}. Original error type: ${plainFetchError?.name ?? 'UnknownError'}`);
            // Re-throw the original error if no fallback is attempted
            throw plainFetchError;
        }
    }
}
//# sourceMappingURL=fetchMethod.js.map