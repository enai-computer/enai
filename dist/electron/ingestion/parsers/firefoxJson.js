"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = parse;
const logger_1 = require("../../utils/logger");
// Recursive helper function to traverse the bookmark tree
function findUrisRecursive(node, urls) {
    // Check if the current node is a bookmark and has a valid URI
    if (node.uri && (node.uri.startsWith('http:') || node.uri.startsWith('https:'))) {
        urls.push(node.uri);
    }
    else if (node.uri) {
        // Log potentially invalid URIs (e.g., place:, data:, javascript:)
        logger_1.logger.debug(`[Parser:FirefoxJSON] Skipping non-http(s) uri: ${node.uri.substring(0, 50)}...`);
    }
    // If the node has children, recursively process them
    if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
            findUrisRecursive(child, urls);
        }
    }
}
/**
 * Parses Firefox bookmarks JSON backup content to extract URLs.
 * Recursively traverses the JSON structure to find all entries with a 'uri' property.
 * @param content The JSON content as a string.
 * @returns An array of valid HTTP/HTTPS URL strings found in the file.
 */
function parse(content) {
    logger_1.logger.debug('[Parser:FirefoxJSON] Starting parsing for content length:', content.length);
    const urls = [];
    try {
        const rootNode = JSON.parse(content);
        // The root node itself might not be a bookmark but usually contains children
        // Start the recursion from the root
        findUrisRecursive(rootNode, urls);
        logger_1.logger.info(`[Parser:FirefoxJSON] Extracted ${urls.length} valid URLs.`);
    }
    catch (error) {
        logger_1.logger.error('[Parser:FirefoxJSON] Failed to parse JSON content or traverse structure:', error);
        // Return empty array on error
        return [];
    }
    return urls;
}
//# sourceMappingURL=firefoxJson.js.map