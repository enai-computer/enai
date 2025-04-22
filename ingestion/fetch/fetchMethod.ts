import {
  fetchPage as fetchPagePlain,
  FetchSizeLimitError,
  FetchTimeoutError,
  FetchHTTPError,
  FetchPageResult, // Import the result type
  UnsupportedContentTypeError, // Keep importing other errors if needed downstream
} from './pageFetcher';
import {
  fetchWithBrowserbase,
  // Import Browserbase errors if needed for specific handling later
  // BrowserbaseAuthError,
  // BrowserbaseConnectionError,
  // BrowserbaseEmptyResultError,
  // BrowserbaseRateLimitError,
  // BrowserbaseTimeoutError
} from './browserbaseFetch';
import { logger } from '../../utils/logger';

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
export async function fetchPageWithFallback(
  url: string,
  // Add options if needed, matching pageFetcher's options for now
  options: {
    timeoutMs?: number;
    maxSizeBytes?: number;
    userAgent?: string;
  } = {}
): Promise<FetchPageResult> {
  try {
    logger.debug(`[fetchMethod] Attempting plain fetch for: ${url}`);
    // Pass options only to the plain fetcher initially
    const result = await fetchPagePlain(url, options);
    logger.info(`[fetchMethod] Plain fetch successful for: ${url}`);
    return result;
  } catch (plainFetchError: any) {
    logger.warn(
      `[fetchMethod] Plain fetch failed for ${url}: ${plainFetchError?.name ?? 'UnknownError'} - ${plainFetchError?.message ?? 'No message'}`,
    );

    // Determine if we should fallback
    // Fallback for Timeout, HTTP errors, Unsupported Content Type, and generic network errors
    // DO NOT fallback for Size Limit errors.
    const shouldFallback = (
      plainFetchError instanceof FetchTimeoutError ||
      plainFetchError instanceof FetchHTTPError ||
      plainFetchError instanceof UnsupportedContentTypeError ||
      // Catch other general errors but specifically exclude Size Limit
      (!(plainFetchError instanceof FetchSizeLimitError) && plainFetchError instanceof Error)
    );

    if (shouldFallback) {
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
    } else {
      // Don't fallback for FetchSizeLimitError or non-error throws
      logger.warn(`[fetchMethod] Not falling back to Browserbase for ${url}. Original error type: ${plainFetchError?.name ?? 'UnknownError'}`);
      // Re-throw the original error if no fallback is attempted
      throw plainFetchError;
    }
  }
}
 