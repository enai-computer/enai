"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = parse;
const logger_1 = require("../../utils/logger");
const node_html_parser_1 = require("node-html-parser");
/**
 * Parses Chrome/Chromium bookmarks HTML file content to extract URLs.
 * Uses node-html-parser to find all anchor tags and extract their href attributes.
 * @param content The HTML content as a string.
 * @returns An array of valid HTTP/HTTPS URL strings found in the file.
 */
function parse(content) {
    logger_1.logger.debug('[Parser:ChromeHTML] Starting parsing for content length:', content.length);
    const urls = [];
    try {
        const root = (0, node_html_parser_1.parse)(content);
        const anchors = root.querySelectorAll('a'); // Find all <a> elements
        logger_1.logger.debug(`[Parser:ChromeHTML] Found ${anchors.length} anchor tags.`);
        for (const anchor of anchors) {
            const href = anchor.getAttribute('href');
            if (href) {
                // Basic validation: only include http/https URLs
                if (href.startsWith('http:') || href.startsWith('https:')) {
                    urls.push(href);
                }
                else {
                    logger_1.logger.debug(`[Parser:ChromeHTML] Skipping non-http(s) href: ${href}`);
                }
            }
            else {
                // Sometimes bookmarks might have anchors without href (e.g., folder titles)
                // logger.debug('[Parser:ChromeHTML] Skipping anchor tag without href attribute.');
            }
        }
        logger_1.logger.info(`[Parser:ChromeHTML] Extracted ${urls.length} valid URLs.`);
    }
    catch (error) {
        logger_1.logger.error('[Parser:ChromeHTML] Failed to parse HTML content:', error);
        // Return empty array on error, as we can't be sure of partial results
        return [];
    }
    return urls;
}
//# sourceMappingURL=chromeHtml.js.map