"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseHtml = parseHtml;
const jsdom_1 = require("jsdom");
const readability_1 = require("@mozilla/readability");
const logger_1 = require("../../utils/logger");
/**
 * Parses HTML content using JSDOM and Readability to extract article text.
 *
 * @param html The HTML content string.
 * @param url The original URL (used by Readability for base URI resolution).
 * @returns The extracted article content, or null if Readability fails.
 */
function parseHtml(html, url) {
    var _a;
    // Configure a VirtualConsole to capture JSDOM errors
    const virtualConsole = new jsdom_1.VirtualConsole();
    // Send JSDOM errors to our logger, prefixed for clarity
    virtualConsole.on("error", (e) => { logger_1.logger.error(`[JSDOM Error][${url}]`, e); });
    virtualConsole.on("warn", (e) => { logger_1.logger.warn(`[JSDOM Warn][${url}]`, e); });
    // Optionally capture jsdomError, console.log, etc., if needed for debugging
    // virtualConsole.on("jsdomError", e => { logger.error(`[JSDOM InternalError][${url}]`, e); });
    // virtualConsole.on("log", (...args) => { logger.debug(`[JSDOM ConsoleLog][${url}]`, ...args); });
    try {
        // Create a JSDOM instance with the virtual console
        const dom = new jsdom_1.JSDOM(html, {
            url,
            virtualConsole, // Pass the configured virtual console
            runScripts: "dangerously", // Needed for some sites, but can cause errors/hangs
            resources: "usable" // Allows loading subresources like CSS if needed, might increase complexity
        });
        // Create a Readability instance
        const reader = new readability_1.Readability(dom.window.document);
        // Attempt to parse the article
        const article = reader.parse();
        // Check if parsing was successful
        if (article && article.textContent && article.title) {
            logger_1.logger.debug(`[readabilityParser] Successfully parsed content for ${url}. Title: ${article.title}`);
            return {
                title: article.title,
                byline: article.byline || null, // Ensure null if empty/undefined
                text: article.textContent, // Use textContent for plain text
                length: (_a = article.length) !== null && _a !== void 0 ? _a : 0, // Use Readability's calculated length, default to 0
            };
        }
        else {
            logger_1.logger.warn(`[readabilityParser] Readability could not parse article content for ${url}.`);
            return null;
        }
    }
    catch (error) {
        logger_1.logger.error(`[readabilityParser] Error parsing HTML for ${url}:`, error);
        return null; // Return null on any parsing error
    }
}
//# sourceMappingURL=readabilityParser.js.map