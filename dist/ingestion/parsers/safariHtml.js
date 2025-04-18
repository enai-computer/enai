"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = parse;
const logger_1 = require("../../utils/logger");
/**
 * Parses Safari bookmarks Plist file content to extract URLs.
 * Placeholder implementation.
 * NOTE: Safari often exports as HTML, so this might be less common or need adjustment.
 * @param content The Plist/XML content as a string.
 * @returns An array of URL strings.
 */
function parse(content) {
    logger_1.logger.debug('[Parser:SafariPlist] Received content length:', content.length);
    // TODO: Implement actual Safari bookmarks Plist parsing logic.
    // Example: Use a library like plist to parse the file.
    // Safari's default export is usually HTML, similar to Chrome.
    logger_1.logger.warn('[Parser:SafariPlist] Parsing logic not implemented - returning dummy data.');
    return [
        'https://www.apple.com/from-safari',
        'https://developer.apple.com/from-safari',
    ];
}
//# sourceMappingURL=safariHtml.js.map