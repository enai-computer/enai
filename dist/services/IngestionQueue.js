"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestionQueue = void 0;
const p_queue_1 = __importDefault(require("p-queue"));
const os_1 = __importDefault(require("os"));
const logger_1 = require("../utils/logger");
const pageFetcher_1 = require("../ingestion/fetch/pageFetcher");
const readabilityParser_1 = require("../ingestion/clean/readabilityParser");
const ContentModel_1 = require("../models/ContentModel");
class IngestionQueueService {
    constructor() {
        // Calculate concurrency based on CPU cores, minimum 1, maximum reasonable number (e.g., 8)
        const concurrency = Math.max(1, Math.min(os_1.default.cpus().length * 2, 8));
        logger_1.logger.info(`[IngestionQueue] Initializing with concurrency: ${concurrency}`);
        this.queue = new p_queue_1.default({ concurrency });
        // Optional: Log queue events for monitoring
        this.queue.on('active', () => {
            logger_1.logger.debug(`[IngestionQueue] Active: ${this.queue.size} tasks pending, ${this.queue.pending} tasks running.`);
        });
        this.queue.on('idle', () => {
            logger_1.logger.info('[IngestionQueue] Queue is idle.');
        });
        this.queue.on('error', error => {
            logger_1.logger.error('[IngestionQueue] Unhandled queue error: ', error);
        });
    }
    /**
     * Adds a bookmark URL to the queue for content ingestion.
     * @param bookmarkId The ID of the bookmark record in the database.
     * @param url The canonical URL of the bookmark to process.
     */
    queueForContentIngestion(bookmarkId, url) {
        logger_1.logger.info(`[IngestionQueue] Queuing ingestion for bookmark ID ${bookmarkId}, URL: ${url}`);
        this.queue.add(() => this._processItem(bookmarkId, url))
            .catch(error => {
            // Catch errors specifically from the _processItem task if they weren't handled internally
            logger_1.logger.error(`[IngestionQueue] Failed processing task for bookmark ID ${bookmarkId}:`, error);
            // Attempt to save error status even if task failed unexpectedly
            this._saveErrorStatus(bookmarkId, url, 'fetch_error'); // Generic fallback status
        });
    }
    /**
     * The core processing logic for a single queued item.
     * Fetches, parses, and saves content to the DB.
     * Internal errors during steps should be caught and result in saving an error status.
     */
    async _processItem(bookmarkId, url) {
        var _a;
        logger_1.logger.debug(`[IngestionQueue] Processing bookmark ID ${bookmarkId}, URL: ${url}`);
        let fetchResult;
        let finalUrl = url; // Keep track of the URL after redirects, default to original
        try {
            // 1. Fetch Page Content
            fetchResult = await (0, pageFetcher_1.fetchPage)(url);
            finalUrl = fetchResult.finalUrl; // Update finalUrl after successful fetch
            // 2. Parse HTML Content
            const parsedArticle = (0, readabilityParser_1.parseHtml)(fetchResult.html, finalUrl);
            if (!parsedArticle) {
                throw new Error('Readability parsing returned null'); // Treat null parse as an error
            }
            // 3. Save Successful Result to DB
            await (0, ContentModel_1.saveContent)({
                bookmarkId: bookmarkId,
                rawHtml: fetchResult.html, // Save raw HTML
                text: parsedArticle.text,
                metadata: {
                    title: parsedArticle.title,
                    byline: parsedArticle.byline,
                    length: parsedArticle.length,
                    sourceUrl: finalUrl, // Store final URL in metadata
                },
                // Status is determined within saveContent based on content presence
            });
            logger_1.logger.info(`[IngestionQueue] Successfully ingested content for bookmark ID ${bookmarkId}`);
        }
        catch (error) {
            // --- Centralized Error Handling --- 
            let status = 'error'; // Default error status
            let errorMessage = error instanceof Error ? error.message : 'Unknown processing error';
            if (error instanceof pageFetcher_1.FetchError) {
                status = error.status; // Use specific status from FetchError (e.g., 'timeout', 'http_error')
                errorMessage = error.message;
                logger_1.logger.warn(`[IngestionQueue] Fetch failed for ID ${bookmarkId} (URL: ${finalUrl}): ${status} - ${errorMessage}`);
                // *** Specific handling for timeout as per user request ***
                if (status === 'timeout') {
                    await this._saveErrorStatus(bookmarkId, finalUrl, status, errorMessage);
                    return; // Do not rethrow timeout errors, let queue continue
                }
                // For other FetchErrors, log and save status below
            }
            else if (errorMessage.includes('Readability parsing returned null')) {
                status = 'parse_fail';
                logger_1.logger.warn(`[IngestionQueue] Parsing failed for ID ${bookmarkId} (URL: ${finalUrl}): ${errorMessage}`);
                // Log and save status below
            }
            else if ((_a = error.message) === null || _a === void 0 ? void 0 : _a.includes('DB missing `content` table')) {
                // Error from saveContent about missing table - already logged in ContentModel
                // Stop processing, but don't try to save status (as table is missing)
                logger_1.logger.error(`[IngestionQueue] Aborting processing for ID ${bookmarkId} due to missing content table.`);
                // DO NOT attempt this._saveErrorStatus here
                return; // Stop processing this item
            }
            else {
                // General unexpected error during processing (parsing, saving)
                // Log only message and stack, not the full error object
                logger_1.logger.error(`[IngestionQueue] Unexpected error processing ID ${bookmarkId} (URL: ${finalUrl}): ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined // Log stack if available
                );
                // Log and save status below
            }
            // Save error status for non-timeout FetchErrors and other caught errors (except missing table)
            await this._saveErrorStatus(bookmarkId, finalUrl, status, errorMessage);
            // Do not rethrow other handled errors to allow queue processing to continue
            // Only unhandled exceptions in queue.add().catch() will be logged as critical.
        }
    }
    /**
     * Helper to save an error status to the content table.
     * Now uses the dedicated ContentModel.saveErrorStatus function.
     */
    async _saveErrorStatus(bookmarkId, sourceUrl, status, errorMessage) {
        try {
            // Call the dedicated function in ContentModel
            await (0, ContentModel_1.saveErrorStatus)(bookmarkId, status, errorMessage);
            // Logging is now handled within saveErrorStatus
        }
        catch (dbError) {
            // Log if even saving the error status fails
            logger_1.logger.error(`[IngestionQueue] CRITICAL: Failed to save error status '${status}' for bookmark ID ${bookmarkId}:`, dbError);
        }
    }
    // Optional: Method to get queue size/status
    get status() {
        return {
            size: this.queue.size,
            pending: this.queue.pending,
            isIdle: this.queue.size === 0 && this.queue.pending === 0, // Correctly determine idle state
        };
    }
}
// Export a singleton instance of the service
exports.ingestionQueue = new IngestionQueueService();
//# sourceMappingURL=IngestionQueue.js.map