// This file's primary logic has been moved to electron/workers/readabilityWorker.ts
// It can be deleted or kept empty if needed for structural reasons.

// import { JSDOM } from 'jsdom'; // Removed
// import { Readability } from '@mozilla/readability'; // Removed
// import { ReadabilityParsed } from '../../shared/types'; // Removed (unless other utils remain)
// import { logger } from '../../utils/logger'; // Removed (unless other utils remain)

/**
 * Parses HTML content using Readability to extract the main article body.
 * @param html UTF-8 encoded HTML string.
 * @param url The original URL (used by Readability for base URI).
 * @returns A ReadabilityParsed object or null if parsing fails or no content found.
 *
 * @deprecated Logic moved to electron/workers/readabilityWorker.ts
 */
// export function parseHtml(...) { ... } // Function removed 