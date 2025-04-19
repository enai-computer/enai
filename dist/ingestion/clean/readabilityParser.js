"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseHtml = parseHtml;
const jsdom_1 = require("jsdom");
const readability_1 = require("@mozilla/readability");
const logger_1 = require("../../utils/logger");
/**
 * Parses HTML content using Readability to extract the main article body.
 * @param html UTF-8 encoded HTML string.
 * @param url The original URL (used by Readability for base URI).
 * @returns A ReadabilityParsed object or null if parsing fails or no content found.
 */
function parseHtml(html, url) {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        // 1. Build DOM
        // JSDOM handles basic HTML parsing errors internally quite well.
        const dom = new jsdom_1.JSDOM(html, { url });
        // 2. Run Readability
        const reader = new readability_1.Readability(dom.window.document);
        const article = reader.parse(); // Returns Article object or null
        // 3. Check if Readability found meaningful content
        if (!article || !article.textContent) {
            logger_1.logger.debug(`[readabilityParser] Readability could not extract article from ${url}`);
            return null;
        }
        // 4. Normalize textContent and return full ReadabilityParsed object
        const normalizedTextContent = article.textContent.replace(/\s+/g, ' ').trim();
        // Map all fields from Readability's Article type to our ReadabilityParsed interface
        // Add null checks for fields that might be undefined/null in the source Article
        const parsedResult = {
            title: (_a = article.title) !== null && _a !== void 0 ? _a : '', // Default to empty string if title is null/undefined
            byline: (_b = article.byline) !== null && _b !== void 0 ? _b : null,
            dir: (_c = article.dir) !== null && _c !== void 0 ? _c : null,
            content: (_d = article.content) !== null && _d !== void 0 ? _d : '', // Default to empty string if content is null/undefined
            textContent: normalizedTextContent, // The normalized plain text
            length: (_e = article.length) !== null && _e !== void 0 ? _e : 0, // Default to 0 if length is null/undefined
            excerpt: (_f = article.excerpt) !== null && _f !== void 0 ? _f : null,
            siteName: (_g = article.siteName) !== null && _g !== void 0 ? _g : null,
        };
        logger_1.logger.debug(`[readabilityParser] Successfully parsed article "${parsedResult.title}" from ${url}`);
        return parsedResult;
    }
    catch (error) {
        logger_1.logger.error(`[readabilityParser] Error parsing HTML from ${url}:`, error);
        return null; // Return null on any parsing error
    }
}
//# sourceMappingURL=readabilityParser.js.map