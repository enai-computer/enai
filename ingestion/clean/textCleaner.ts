import { logger } from '../../utils/logger';

/**
 * Cleans text extracted from Readability for embedding purposes.
 *
 * - Normalizes Unicode characters to their canonical composition form (NFC).
 * - Converts non-breaking spaces (NBSP) and zero-width spaces to regular spaces.
 * - Collapses horizontal whitespace (spaces, tabs) while preserving single newlines.
 * - Reduces 3+ consecutive newlines to exactly two (common paragraph marker).
 * - Strips control characters (except common whitespace like \n, \r, \t).
 * - Trims leading/trailing whitespace.
 *
 * @param text The raw text content (e.g., from ReadabilityParsed.textContent).
 * @returns The cleaned text string, or an empty string if input is falsy.
 */
export function cleanTextForEmbedding(text: string): string {
  if (!text) return '';

  try {
    let cleaned = text.normalize('NFC');

    // Convert NBSP and zero-width to plain space
    cleaned = cleaned.replace(/\u00A0|\u200B/g, ' ');

    // Collapse runs of *horizontal* whitespace (tabs, spaces) but keep newlines
    cleaned = cleaned.replace(/[^\S\r\n]+/g, ' ');

    // Reduce 3+ newlines → exactly 2 (paragraph marker)
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Strip control chars (ASCII 0-31 and 127-159) except for HT (9), LF (10), CR (13)
    // eslint-disable-next-line no-control-regex
    cleaned = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

    return cleaned.trim();
  } catch (error) {
    logger.error('[textCleaner] Error cleaning text:', error);
    // Fallback: return the original text trimmed, to avoid losing data
    return text.trim();
  }
} 