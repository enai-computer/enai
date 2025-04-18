import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';

// Import the specific parsers
import * as ChromeHtmlParser from './chromeHtml';
import * as FirefoxJsonParser from './firefoxJson';
import * as SafariHtmlParser from './safariHtml'; // Assuming Safari exports HTML

// Marker for Netscape Bookmark File Format DOCTYPE
const NETSCAPE_DOCTYPE_MARKER = '<!doctype netscape-bookmark-file-1';

// TODO: Refine detection logic based on file content or structure
function detectFormat(content: string, fileExtension: string): 'chrome' | 'firefox' | 'safari' | 'unknown' {
  logger.debug(`[DetectParser] Detecting format for file extension: ${fileExtension}`);
  const trimmedContent = content.trim(); // Trim whitespace once

  // 1. Check for JSON format
  if (fileExtension === '.json') {
    if (trimmedContent.startsWith('{')) {
      logger.info('[DetectParser] Detected potential Firefox JSON format based on extension and content.');
      return 'firefox';
    }
  }
  // 2. Check for HTML (specifically Netscape Bookmark Format)
  else if (fileExtension === '.html') {
    // Check for the specific Netscape DOCTYPE marker (case-insensitive)
    if (trimmedContent.toLowerCase().startsWith(NETSCAPE_DOCTYPE_MARKER)) {
      logger.info('[DetectParser] Detected Netscape Bookmark format based on DOCTYPE.');
      // Chrome and Safari both use this format for HTML exports
      // We can use the 'chrome' parser for both, assuming safariHtml.ts is similar or identical
      // If Safari needs specific handling later, we might return 'safari' here
      return 'chrome';
    }
    // If DOCTYPE is missing, we could add secondary structural checks here if needed,
    // but for now, we'll avoid guessing to prevent false positives on random HTML files.
    logger.warn(`[DetectParser] HTML file extension found, but Netscape DOCTYPE marker is missing. File might not be a valid bookmark export: ${fileExtension}`);
  }

  // 3. If none of the above matched, format is unknown
  logger.warn(`[DetectParser] Could not determine specific bookmark format for file extension ${fileExtension}.`);
  return 'unknown';
}

/**
 * Reads a bookmark file, detects its format, and calls the appropriate parser.
 * @param filePath The absolute path to the bookmark file.
 * @returns A promise resolving to an array of extracted URL strings.
 */
export async function parseBookmarkFile(filePath: string): Promise<string[]> {
  logger.info(`[DetectParser] Starting parsing process for file: ${filePath}`);
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    logger.error(`[DetectParser] Failed to read file ${filePath}:`, error);
    throw new Error(`Failed to read bookmark file: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!content || content.trim() === '') {
    logger.warn(`[DetectParser] File is empty or contains only whitespace: ${filePath}`);
    return [];
  }

  const fileExtension = path.extname(filePath).toLowerCase();
  const format = detectFormat(content, fileExtension);

  let urls: string[] = [];

  try {
    switch (format) {
      case 'chrome':
        logger.info('[DetectParser] Using Chrome/HTML parser...');
        urls = ChromeHtmlParser.parse(content);
        break;
      case 'firefox':
        logger.info('[DetectParser] Using Firefox/JSON parser...');
        urls = FirefoxJsonParser.parse(content);
        break;
      case 'safari':
        // Assuming Safari exports HTML and can use the same parser as Chrome for now
        logger.info('[DetectParser] Using Safari/HTML parser (currently same as Chrome)...');
        urls = SafariHtmlParser.parse(content); // Or ChromeHtmlParser.parse(content);
        break;
      case 'unknown':
        logger.warn(`[DetectParser] Unknown or unsupported bookmark file format for: ${filePath}. Returning empty list.`);
        urls = [];
        break;
      default:
        logger.error(`[DetectParser] Unexpected format detected: ${format}`);
        urls = [];
        break;
    }
  } catch (parseError) {
    logger.error(`[DetectParser] Error occurred during parsing with format '${format}' for file ${filePath}:`, parseError);
    // Depending on desired behavior, either return empty or re-throw
    // Returning empty to avoid failing entire import for one parser error
    return [];
  }

  logger.info(`[DetectParser] Successfully parsed ${urls.length} URLs from ${filePath} using format '${format}'.`);
  return urls;
} 