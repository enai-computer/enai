"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBookmarkFile = parseBookmarkFile;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const logger_1 = require("../../utils/logger");
// Import the specific parsers
const ChromeHtmlParser = __importStar(require("./chromeHtml"));
const FirefoxJsonParser = __importStar(require("./firefoxJson"));
const SafariHtmlParser = __importStar(require("./safariHtml")); // Assuming Safari exports HTML
// Marker for Netscape Bookmark File Format DOCTYPE
const NETSCAPE_DOCTYPE_MARKER = '<!doctype netscape-bookmark-file-1';
// TODO: Refine detection logic based on file content or structure
function detectFormat(content, fileExtension) {
    logger_1.logger.debug(`[DetectParser] Detecting format for file extension: ${fileExtension}`);
    const trimmedContent = content.trim(); // Trim whitespace once
    // 1. Check for JSON format
    if (fileExtension === '.json') {
        if (trimmedContent.startsWith('{')) {
            logger_1.logger.info('[DetectParser] Detected potential Firefox JSON format based on extension and content.');
            return 'firefox';
        }
    }
    // 2. Check for HTML (specifically Netscape Bookmark Format)
    else if (fileExtension === '.html') {
        // Check for the specific Netscape DOCTYPE marker (case-insensitive)
        if (trimmedContent.toLowerCase().startsWith(NETSCAPE_DOCTYPE_MARKER)) {
            logger_1.logger.info('[DetectParser] Detected Netscape Bookmark format based on DOCTYPE.');
            // Chrome and Safari both use this format for HTML exports
            // We can use the 'chrome' parser for both, assuming safariHtml.ts is similar or identical
            // If Safari needs specific handling later, we might return 'safari' here
            return 'chrome';
        }
        // If DOCTYPE is missing, we could add secondary structural checks here if needed,
        // but for now, we'll avoid guessing to prevent false positives on random HTML files.
        logger_1.logger.warn(`[DetectParser] HTML file extension found, but Netscape DOCTYPE marker is missing. File might not be a valid bookmark export: ${fileExtension}`);
    }
    // 3. If none of the above matched, format is unknown
    logger_1.logger.warn(`[DetectParser] Could not determine specific bookmark format for file extension ${fileExtension}.`);
    return 'unknown';
}
/**
 * Reads a bookmark file, detects its format, and calls the appropriate parser.
 * @param filePath The absolute path to the bookmark file.
 * @returns A promise resolving to an array of extracted URL strings.
 */
async function parseBookmarkFile(filePath) {
    logger_1.logger.info(`[DetectParser] Starting parsing process for file: ${filePath}`);
    let content;
    try {
        content = await fs_1.promises.readFile(filePath, 'utf-8');
    }
    catch (error) {
        logger_1.logger.error(`[DetectParser] Failed to read file ${filePath}:`, error);
        throw new Error(`Failed to read bookmark file: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!content || content.trim() === '') {
        logger_1.logger.warn(`[DetectParser] File is empty or contains only whitespace: ${filePath}`);
        return [];
    }
    const fileExtension = path_1.default.extname(filePath).toLowerCase();
    const format = detectFormat(content, fileExtension);
    let urls = [];
    try {
        switch (format) {
            case 'chrome':
                logger_1.logger.info('[DetectParser] Using Chrome/HTML parser...');
                urls = ChromeHtmlParser.parse(content);
                break;
            case 'firefox':
                logger_1.logger.info('[DetectParser] Using Firefox/JSON parser...');
                urls = FirefoxJsonParser.parse(content);
                break;
            case 'safari':
                // Assuming Safari exports HTML and can use the same parser as Chrome for now
                logger_1.logger.info('[DetectParser] Using Safari/HTML parser (currently same as Chrome)...');
                urls = SafariHtmlParser.parse(content); // Or ChromeHtmlParser.parse(content);
                break;
            case 'unknown':
                logger_1.logger.warn(`[DetectParser] Unknown or unsupported bookmark file format for: ${filePath}. Returning empty list.`);
                urls = [];
                break;
            default:
                logger_1.logger.error(`[DetectParser] Unexpected format detected: ${format}`);
                urls = [];
                break;
        }
    }
    catch (parseError) {
        logger_1.logger.error(`[DetectParser] Error occurred during parsing with format '${format}' for file ${filePath}:`, parseError);
        // Depending on desired behavior, either return empty or re-throw
        // Returning empty to avoid failing entire import for one parser error
        return [];
    }
    logger_1.logger.info(`[DetectParser] Successfully parsed ${urls.length} URLs from ${filePath} using format '${format}'.`);
    return urls;
}
//# sourceMappingURL=detect.js.map