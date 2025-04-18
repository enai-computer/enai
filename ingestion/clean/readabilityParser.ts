import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { ReadabilityParsed } from '../../shared/types'; // Path seems correct
import { logger } from '../../utils/logger';

/**
 * Parses HTML content using Readability to extract the main article body.
 * @param html UTF-8 encoded HTML string.
 * @param url The original URL (used by Readability for base URI).
 * @returns A ReadabilityParsed object or null if parsing fails or no content found.
 */
export function parseHtml(
  html: string,
  url: string
): ReadabilityParsed | null {
  try {
    // 1. Build DOM
    // JSDOM handles basic HTML parsing errors internally quite well.
    const dom = new JSDOM(html, { url });

    // 2. Run Readability
    const reader = new Readability(dom.window.document);
    const article = reader.parse(); // Returns Article object or null

    // 3. Check if Readability found meaningful content
    if (!article || !article.textContent) {
      logger.debug(`[readabilityParser] Readability could not extract article from ${url}`);
      return null;
    }

    // 4. Normalize textContent and return full ReadabilityParsed object
    const normalizedTextContent = article.textContent.replace(/\s+/g, ' ').trim();

    // Map all fields from Readability's Article type to our ReadabilityParsed interface
    // Add null checks for fields that might be undefined/null in the source Article
    const parsedResult: ReadabilityParsed = {
      title: article.title ?? '', // Default to empty string if title is null/undefined
      byline: article.byline ?? null,
      dir: article.dir ?? null,
      content: article.content ?? '', // Default to empty string if content is null/undefined
      textContent: normalizedTextContent, // The normalized plain text
      length: article.length ?? 0, // Default to 0 if length is null/undefined
      excerpt: article.excerpt ?? null,
      siteName: article.siteName ?? null,
    };

    logger.debug(`[readabilityParser] Successfully parsed article "${parsedResult.title}" from ${url}`);
    return parsedResult;

  } catch (error) {
    logger.error(`[readabilityParser] Error parsing HTML from ${url}:`, error);
    return null; // Return null on any parsing error
  }
} 