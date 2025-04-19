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
exports.queueForContentIngestion = queueForContentIngestion;
exports.getQueueSize = getQueueSize;
exports.getQueuePendingCount = getQueuePendingCount;
const os_1 = __importDefault(require("os"));
const p_queue_1 = __importDefault(require("p-queue"));
const logger_1 = require("../utils/logger");
const pageFetcher_1 = require("../ingestion/fetch/pageFetcher");
const readabilityParser_1 = require("../ingestion/clean/readabilityParser");
const ContentModel = __importStar(require("../models/ContentModel"));
// --- Queue Configuration ---
const MAX_ATTEMPTS = 3;
// Determine concurrency based on CPU cores, minimum of 2, max reasonable (e.g., 16)
const cpuCount = os_1.default.cpus().length;
const concurrency = Math.max(2, Math.min(cpuCount * 2, 16));
const BASE_RETRY_DELAY_MS = 2000; // Base delay: 2 seconds
const JITTER_MS = 500; // Max random jitter: 0.5 seconds
logger_1.logger.info(`[IngestionQueue] Initializing with concurrency: ${concurrency}`);
// --- Queue Instance ---
const queue = new p_queue_1.default({ concurrency });
// --- Core Job Processing Logic ---
async function processJob(job) {
    logger_1.logger.info(`[IngestionQueue] Processing job for bookmark ${job.bookmarkId}, URL: ${job.url}, Attempt: ${job.attempt}`);
    // Ensure the row exists and mark as pending on the first attempt
    if (job.attempt === 1) {
        try {
            ContentModel.upsertContent({
                bookmarkId: job.bookmarkId,
                sourceUrl: job.url, // Use canonical URL initially
                status: 'pending',
                parsedContent: null,
                fetchedAt: new Date(),
            });
        }
        catch (dbError) {
            logger_1.logger.error(`[IngestionQueue] Failed to mark job as pending for bookmark ${job.bookmarkId}. Aborting job.`, dbError);
            // If we can't even mark it pending, something is wrong, don't proceed.
            return;
        }
    }
    try {
        // 1. Fetch the page
        const fetchResult = await (0, pageFetcher_1.fetchPage)(job.url);
        logger_1.logger.debug(`[IngestionQueue] Fetch successful for bookmark ${job.bookmarkId}, Final URL: ${fetchResult.finalUrl}`);
        // 2. Parse HTML with Readability
        const parsedContent = (0, readabilityParser_1.parseHtml)(fetchResult.html, fetchResult.finalUrl);
        if (!parsedContent) {
            // Parsing failed or no content found
            logger_1.logger.warn(`[IngestionQueue] Parsing failed or no content for bookmark ${job.bookmarkId}, URL: ${fetchResult.finalUrl}`);
            ContentModel.upsertContent({
                bookmarkId: job.bookmarkId,
                sourceUrl: fetchResult.finalUrl,
                status: 'parse_fail',
                parsedContent: null,
                fetchedAt: new Date(),
            });
        }
        else {
            // Parsing successful, store content
            logger_1.logger.info(`[IngestionQueue] Parsing successful for bookmark ${job.bookmarkId}, Title: ${parsedContent.title}`);
            ContentModel.upsertContent({
                bookmarkId: job.bookmarkId,
                sourceUrl: fetchResult.finalUrl,
                status: 'ok',
                parsedContent: parsedContent,
                fetchedAt: new Date(),
            });
        }
    }
    catch (error) {
        // 3. Handle Fetch and Parsing Errors
        logger_1.logger.warn(`[IngestionQueue] Error processing job for bookmark ${job.bookmarkId} (Attempt ${job.attempt}/${MAX_ATTEMPTS}):`, error);
        let status = 'fetch_error'; // Default error status
        let isRetryable = false;
        if (error instanceof pageFetcher_1.FetchTimeoutError) {
            status = 'timeout';
            isRetryable = true;
        }
        else if (error instanceof pageFetcher_1.FetchSizeLimitError) {
            status = 'too_large';
            isRetryable = false;
        }
        else if (error instanceof pageFetcher_1.FetchHTTPError) {
            status = 'http_error';
            // Retry only on server errors (5xx) or specific client errors (408, 429)
            if (error.status >= 500 || error.status === 408 || error.status === 429) {
                isRetryable = true;
            }
        }
        else if (error instanceof pageFetcher_1.UnsupportedContentTypeError) {
            status = 'fetch_error'; // Or a more specific status like 'unsupported_type'
            isRetryable = false; // Don't retry unsupported types
        }
        else if (error.name === 'AbortError') {
            // Check the cause if available (from fetchPage logic)
            if (error.cause instanceof pageFetcher_1.FetchTimeoutError) {
                status = 'timeout';
                isRetryable = true;
            }
            else if (error.cause instanceof pageFetcher_1.FetchSizeLimitError) {
                status = 'too_large';
                isRetryable = false;
            }
            // Otherwise, keep default 'fetch_error'
        }
        else {
            // Assume other errors might be transient network issues
            isRetryable = true;
        }
        if (isRetryable && job.attempt < MAX_ATTEMPTS) {
            // Retry the job with exponential backoff + jitter
            const backoff = BASE_RETRY_DELAY_MS * Math.pow(2, job.attempt - 1); // Exponential backoff (2s, 4s)
            const jitter = Math.random() * JITTER_MS; // Add random jitter (0-500ms)
            const delay = backoff + jitter;
            logger_1.logger.info(`[IngestionQueue] Retrying job for bookmark ${job.bookmarkId} in ${(delay / 1000).toFixed(1)}s (Attempt ${job.attempt + 1})`);
            setTimeout(() => {
                queue.add(() => processJob(Object.assign(Object.assign({}, job), { attempt: job.attempt + 1 })));
            }, delay);
        }
        else {
            // Max attempts reached or error is not retryable, update DB with final error status
            logger_1.logger.error(`[IngestionQueue] Job failed permanently for bookmark ${job.bookmarkId} after ${job.attempt} attempts. Status: ${status}`);
            // Use updateContentStatus, assuming a 'pending' record might already exist
            // If it doesn't exist, this won't do anything, which might be acceptable, or we could upsert with error status.
            // Let's use upsert to ensure a record exists, even if it's just the error status.
            ContentModel.upsertContent({
                bookmarkId: job.bookmarkId,
                sourceUrl: job.url, // Use original URL if fetch failed before getting final URL
                status: status,
                parsedContent: null,
                fetchedAt: new Date(),
            });
        }
    }
}
// --- Public API ---
/**
 * Adds a bookmark URL to the ingestion queue.
 * Called by BookmarkService after a new bookmark is inserted.
 * @param bookmarkId The ID of the bookmark record.
 * @param url The canonical URL to fetch content from.
 */
function queueForContentIngestion(bookmarkId, url) {
    logger_1.logger.info(`[IngestionQueue] Queuing bookmark ${bookmarkId} for content ingestion. URL: ${url}`);
    const job = {
        bookmarkId,
        url,
        attempt: 1,
    };
    // Add the job processing function to the queue
    queue.add(() => processJob(job));
}
/**
 * Gets the number of currently pending tasks in the queue.
 */
function getQueueSize() {
    return queue.size;
}
/**
 * Gets the number of tasks currently being processed.
 */
function getQueuePendingCount() {
    return queue.pending;
}
// Optional: Add functions to pause, resume, clear the queue if needed later.
// TODO: Add EventEmitter logic for progress updates later.
//# sourceMappingURL=ingestionQueue.js.map