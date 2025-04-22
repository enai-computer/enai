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
const fetchMethod_1 = require("../ingestion/fetch/fetchMethod");
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
// Keep track of URLs currently being processed to avoid duplicates
const processingUrls = new Set();
// --- Core Job Processing Logic ---
async function processJob(job) {
    logger_1.logger.info(`[IngestionQueue] Processing job for bookmark ${job.bookmarkId}, URL: ${job.url}, Attempt: ${job.attempt}`);
    // Basic check to prevent race conditions if a URL gets added again quickly
    if (processingUrls.has(job.url)) {
        logger_1.logger.warn(`[IngestionQueue] URL ${job.url} is already being processed. Skipping duplicate job for bookmark ${job.bookmarkId}.`);
        return;
    }
    processingUrls.add(job.url);
    // Determine fetch options (if any are needed/configured)
    // For now, using defaults by passing an empty object
    const fetchOptions = {};
    try {
        // 1. Fetch the page using the new fallback method
        logger_1.logger.debug(`[IngestionQueue] Calling fetchPageWithFallback for URL: ${job.url}`);
        const fetchResult = await (0, fetchMethod_1.fetchPageWithFallback)(job.url, fetchOptions);
        logger_1.logger.debug(`[IngestionQueue] Fetch successful for bookmark ${job.bookmarkId}, Final URL: ${fetchResult.finalUrl}`);
        // 2. Parse HTML with Readability
        const parsedContent = (0, readabilityParser_1.parseHtml)(fetchResult.html, fetchResult.finalUrl);
        if (!parsedContent) {
            // Parsing failed or no content found
            logger_1.logger.warn(`[IngestionQueue] Parsing failed or no content for bookmark ${job.bookmarkId}, URL: ${fetchResult.finalUrl}`);
            await ContentModel.upsertContent({
                bookmarkId: job.bookmarkId,
                sourceUrl: fetchResult.finalUrl, // Use final URL from fetch result
                status: 'parse_fail',
                parsedContent: null,
                fetchedAt: new Date(),
                // Add other fields as required by your model
            });
        }
        else {
            // Parsing successful, store content
            logger_1.logger.info(`[IngestionQueue] Parsing successful for bookmark ${job.bookmarkId}, Title: ${parsedContent.title}`);
            await ContentModel.upsertContent({
                bookmarkId: job.bookmarkId,
                sourceUrl: fetchResult.finalUrl, // Use final URL from fetch result
                status: 'ok',
                parsedContent: parsedContent,
                fetchedAt: new Date(),
                // Add other fields as required by your model
            });
        }
    }
    catch (error) {
        logger_1.logger.error(`[IngestionQueue] Error processing job for bookmark ${job.bookmarkId}, URL: ${job.url}, Attempt: ${job.attempt}`, error);
        // Determine final status based on error type? Optional, default to generic fail
        let finalStatus = 'fetch_fail';
        // Example: Check for specific Browserbase errors if needed
        // if (error.name === 'BrowserbaseRateLimitError') { ... }
        // Record the failure in the ContentModel
        await ContentModel.upsertContent({
            bookmarkId: job.bookmarkId,
            sourceUrl: job.url, // Use original URL on fetch failure
            status: finalStatus,
            parsedContent: null,
            fetchedAt: undefined, // Changed from null to undefined
            errorInfo: `${error.name}: ${error.message}` // Store error details
        });
        // Re-throw the error so the queue knows the job failed
        // P-Queue's retry logic will handle subsequent attempts if configured
        throw error;
    }
    finally {
        // Always remove the URL from the processing set
        processingUrls.delete(job.url);
    }
}
// --- Public API ---
/**
 * Adds a bookmark URL to the ingestion queue.
 * Called by BookmarkService after a new bookmark is inserted.
 * @param bookmarkId The ID of the bookmark record.
 * @param url The canonical URL to fetch content from.
 */
async function queueForContentIngestion(bookmarkId, url) {
    // Basic URL validation (optional)
    if (!url || !url.startsWith('http')) {
        logger_1.logger.warn(`[IngestionQueue] Invalid URL provided for bookmark ${bookmarkId}: ${url}. Skipping.`);
        return;
    }
    // Check if already processing to avoid adding duplicates immediately
    if (processingUrls.has(url)) {
        logger_1.logger.info(`[IngestionQueue] URL ${url} is currently being processed. Not adding duplicate for bookmark ${bookmarkId}.`);
        return;
    }
    logger_1.logger.info(`[IngestionQueue] Queuing ingestion for bookmark ${bookmarkId}, URL: ${url}`);
    // Add job to the queue with retry logic handled by p-retry within processJob or by PQueue itself
    // PQueue handles retries via the 'retry' option on add, simplifying processJob
    await queue.add(async () => {
        // Initial attempt
        await processJob({ bookmarkId, url, attempt: 1 });
    }, {
        priority: 1, // Optional priority
        // P-Queue retry logic (alternative to p-retry inside processJob)
        // retry: {
        //   limit: MAX_ATTEMPTS - 1, // Number of retries (total attempts = limit + 1)
        //   delay: (attemptCount) => {
        //     // Exponential backoff with jitter
        //     const baseDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attemptCount - 1);
        //     const jitter = Math.random() * JITTER_MS;
        //     const totalDelay = Math.round(baseDelay + jitter);
        //     logger.debug(`[IngestionQueue] Retrying job for ${url}, Attempt: ${attemptCount + 1}, Delay: ${totalDelay}ms`);
        //     return totalDelay;
        //   },
        //   // Optional: specify methods to retry on (e.g., only network errors)
        //   // methods: ['GET'],
        //   // statusCodes: [429, 500, 502, 503, 504] // Example HTTP statuses to retry on
        // },
        // Custom handling if needed:
        // job: { bookmarkId, url, attempt: 1 } // Pass initial job data
    }).catch(error => {
        // This catch is for errors *after* all retries fail (if using PQueue retry)
        // or if the initial add() throws an error.
        logger_1.logger.error(`[IngestionQueue] Job ultimately failed for bookmark ${bookmarkId}, URL: ${url} after all retries:`, error);
        // Final failure state should already be logged by processJob's catch block
    });
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