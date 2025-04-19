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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookmarksService = void 0;
const logger_1 = require("../utils/logger");
const fs_1 = require("fs"); // Import fs for file deletion
const BookmarkModel = __importStar(require("../models/BookmarkModel")); // Import model functions
const url_1 = require("./helpers/url"); // Import helpers
const detect_1 = require("../ingestion/parsers/detect"); // Import the actual parser entry point
const ingestionQueue_1 = require("./ingestionQueue"); // Import the queue function
// Import necessary types when parsing/deduping logic is added
// import { BookmarkData, BookmarkRecord } from '../shared/types';
// Deduplication logic is now handled within importFromFile
class BookmarksService {
    /**
     * Imports bookmarks from a given file path (HTML or JSON).
     * 1. Parses the file to extract URLs (using ingestion/parsers/detect).
     * 2. Canonicalises and hashes each URL.
     * 3. Inserts into the database if the hash is new.
     * 4. Deletes the temporary file.
     * 5. Returns the count of *new* bookmarks added to the DB.
     * @param filePath - The absolute path to the temporary bookmark export file.
     * @returns The number of new bookmarks successfully added.
     */
    static async importFromFile(filePath) {
        logger_1.logger.info(`[BookmarkService] Starting import from file: ${filePath}`);
        let newBookmarksCount = 0;
        try {
            // 1. Parse file content using the dedicated ingestion function
            const potentialUrls = await (0, detect_1.parseBookmarkFile)(filePath);
            if (!potentialUrls.length) {
                logger_1.logger.warn(`[BookmarkService] No potential URLs found or parsed from file: ${filePath}`);
                // Don't delete the file here, the finally block handles it
                return 0;
            }
            logger_1.logger.info(`[BookmarkService] Parsed ${potentialUrls.length} potential bookmark entries via ingestion parser.`);
            // Process URLs and insert new ones
            const processedHashes = new Set(); // Avoid processing same canonical URL twice from one file
            let invalidUrlCount = 0;
            for (const rawUrl of potentialUrls) {
                let canonicalUrl;
                try {
                    canonicalUrl = (0, url_1.canonicaliseUrl)(rawUrl);
                    // Basic check if canonicalization resulted in something usable
                    if (!canonicalUrl.startsWith('http:') && !canonicalUrl.startsWith('https:')) {
                        throw new Error('Invalid protocol after canonicalization');
                    }
                }
                catch (e) {
                    logger_1.logger.warn(`[BookmarkService] Skipping invalid or non-HTTP(S) URL: ${rawUrl}`);
                    invalidUrlCount++;
                    continue;
                }
                const urlHash = (0, url_1.sha256)(canonicalUrl);
                if (processedHashes.has(urlHash)) {
                    continue; // Already processed this canonical URL from this file
                }
                processedHashes.add(urlHash);
                // 3. Insert if new (delegates deduplication to the DB constraint)
                try {
                    const { wasNew, id } = BookmarkModel.insertIfNew(canonicalUrl, urlHash);
                    if (wasNew && id !== null) { // Ensure id is not null before converting
                        newBookmarksCount++;
                        const bookmarkIdString = String(id); // Convert number id to string
                        logger_1.logger.debug(`[BookmarkService] Added new bookmark: ID ${bookmarkIdString}, Hash ${urlHash}`);
                        // Queue this ID (as string) and canonical URL for content ingestion
                        (0, ingestionQueue_1.queueForContentIngestion)(bookmarkIdString, canonicalUrl);
                    }
                }
                catch (dbError) {
                    logger_1.logger.error(`[BookmarkService] Database error inserting hash ${urlHash} for URL ${canonicalUrl}:`, dbError);
                    // Decide whether to continue or abort import on DB error
                }
            }
            logger_1.logger.info(`[BookmarkService] Import processing complete. Added ${newBookmarksCount} new bookmarks. Skipped ${invalidUrlCount} invalid URLs.`);
            // 5. Return the count of new bookmarks added to the DB
            return newBookmarksCount;
        }
        catch (error) {
            // Catch errors from parsing (now in parseBookmarkFile) or unexpected issues
            logger_1.logger.error(`[BookmarkService] Error during import processing for file ${filePath}:`, error);
            throw error; // Re-throw to be caught by the IPC handler
        }
        finally {
            // 4. Delete the temporary file regardless of success or failure
            try {
                logger_1.logger.info(`[BookmarkService] Attempting to delete temporary file: ${filePath}`);
                await fs_1.promises.unlink(filePath);
                logger_1.logger.info(`[BookmarkService] Successfully deleted temporary file: ${filePath}`);
            }
            catch (unlinkError) {
                // Log failure to delete, but don't let it hide the original error (if any)
                logger_1.logger.error(`[BookmarkService] Failed to delete temporary file ${filePath}:`, unlinkError);
            }
        }
    }
}
exports.BookmarksService = BookmarksService;
// Note: If the service becomes stateful, export an instance instead:
// export const bookmarkService = new BookmarksService(); 
//# sourceMappingURL=bookmarkService.js.map