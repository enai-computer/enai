"use strict";
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
// --- Queue Configuration ---
// const MAX_ATTEMPTS = 3; // Retry logic might be handled differently or outside
// Determine concurrency based on CPU cores, minimum of 2, max reasonable (e.g., 16)
const cpuCount = os_1.default.cpus().length;
const concurrency = Math.max(2, Math.min(cpuCount * 2, 16));
// const BASE_RETRY_DELAY_MS = 2000; // Base delay: 2 seconds
// const JITTER_MS = 500; // Max random jitter: 0.5 seconds
logger_1.logger.info(`[IngestionQueue] Initializing with concurrency: ${concurrency}`);
// --- Queue Instance ---
const queue = new p_queue_1.default({ concurrency });
// Keep track of URIs currently being processed to avoid duplicates
const processingUris = new Set(); // Renamed from processingUrls
const MAX_ERROR_INFO_LENGTH = 1024; // Limit stored error message length
// --- Core Job Processing Logic ---
async function processJob(job, objectModel) {
    logger_1.logger.info(`[IngestionQueue] Processing job for object ${job.objectId}, URI: ${job.sourceUri}`);
    // Basic check to prevent race conditions if a URI gets added again quickly
    if (processingUris.has(job.sourceUri)) {
        logger_1.logger.warn(`[IngestionQueue] URI ${job.sourceUri} is already being processed. Skipping duplicate job for object ${job.objectId}.`);
        return;
    }
    processingUris.add(job.sourceUri);
    const fetchOptions = {}; // Keep empty for now
    try {
        // 1. Fetch the page using the new fallback method
        logger_1.logger.debug(`[IngestionQueue] Calling fetchPageWithFallback for URI: ${job.sourceUri}`);
        const fetchResult = await (0, fetchMethod_1.fetchPageWithFallback)(job.sourceUri, fetchOptions);
        logger_1.logger.debug(`[IngestionQueue] Fetch successful for object ${job.objectId}, Final URL: ${fetchResult.finalUrl}`);
        // 2. Parse HTML with Readability
        // parseHtml can return ReadabilityParsed | null
        const parsedContent = (0, readabilityParser_1.parseHtml)(fetchResult.html, fetchResult.finalUrl);
        // Check handles null or empty content scenario
        if (!parsedContent) {
            // Parsing failed or no content found
            logger_1.logger.warn(`[IngestionQueue] Parsing failed or no content for object ${job.objectId}, URL: ${fetchResult.finalUrl}`);
            // Use objectModel.update to set status and error
            await objectModel.update(job.objectId, Object.assign(Object.assign({ status: 'error', errorInfo: 'Parsing failed or no content found after fetch.' }, (fetchResult.finalUrl !== job.sourceUri && { sourceUri: fetchResult.finalUrl })), { 
                // Clear potentially stale fields
                parsedContentJson: null, parsedAt: undefined }));
        }
        else {
            // Parsing successful, store content and update status
            logger_1.logger.info(`[IngestionQueue] Parsing successful for object ${job.objectId}, Title: ${parsedContent.title}`);
            // Use objectModel.update to store result
            await objectModel.update(job.objectId, Object.assign({ status: 'parsed', title: parsedContent.title, parsedContentJson: JSON.stringify(parsedContent), parsedAt: new Date(), errorInfo: null }, (fetchResult.finalUrl !== job.sourceUri && { sourceUri: fetchResult.finalUrl })));
        }
    }
    catch (error) {
        logger_1.logger.error(`[IngestionQueue] Error processing job for object ${job.objectId}, URI: ${job.sourceUri}`, error);
        // Determine final status based on error type? Optional, default to generic error
        let finalStatus = 'error'; // Generic error status
        // Example: Check for specific error types if needed
        // if (error instanceof NetworkError) { finalStatus = 'fetch_error'; }
        // Truncate error message if too long
        const errorMessage = `${error.name}: ${error.message}`;
        const truncatedErrorInfo = errorMessage.length > MAX_ERROR_INFO_LENGTH
            ? errorMessage.substring(0, MAX_ERROR_INFO_LENGTH) + '...'
            : errorMessage;
        // Record the failure using objectModel.update
        await objectModel.update(job.objectId, {
            status: finalStatus,
            errorInfo: truncatedErrorInfo, // Store truncated error details
            parsedContentJson: null, // Ensure parsed content is cleared
            parsedAt: undefined, // Use undefined to match type Date | undefined
        });
        // Do not re-throw here; the queue should know the job finished (failed)
        // Retry logic might be handled elsewhere or not implemented yet
    }
    finally {
        // Always remove the URI from the processing set
        processingUris.delete(job.sourceUri);
    }
}
// --- Public API ---
/**
 * Adds an object to the ingestion queue for fetching and parsing.
 * Typically called after a new object (e.g., bookmark) is created with status 'new' or 'fetched'.
 * @param objectId The UUID of the object record.
 * @param sourceUri The canonical URI to fetch content from.
 * @param objectModel The instantiated ObjectModel to use for DB operations.
 */
async function queueForContentIngestion(objectId, sourceUri, objectModel) {
    // Basic URI validation (optional)
    if (!sourceUri || !sourceUri.startsWith('http')) {
        logger_1.logger.warn(`[IngestionQueue] Invalid URI provided for object ${objectId}: ${sourceUri}. Skipping.`);
        // Optional: Update object status to error?
        // await objectModel.update(objectId, { status: 'error', errorInfo: 'Invalid source URI' });
        return;
    }
    // Check if already processing to avoid adding duplicates immediately
    if (processingUris.has(sourceUri)) {
        logger_1.logger.debug(`[IngestionQueue] URI ${sourceUri} is currently being processed. Not adding duplicate for object ${objectId}.`);
        return;
    }
    logger_1.logger.debug(`[IngestionQueue] Queuing ingestion for object ${objectId}, URI: ${sourceUri}`);
    // Optionally update status to 'fetched' or similar before adding to queue?
    // This might depend on whether 'new' objects are directly queued or only 'fetched' ones.
    // Let's assume for now it might be called for 'new' objects.
    // await objectModel.update(objectId, { status: 'fetching' }); // Example: Set status before queueing
    // Add job to the queue. Retry logic TBD/simplified for now.
    await queue.add(async () => {
        await processJob({ objectId, sourceUri }, objectModel);
    }, {
        priority: 1, // Optional priority
        // Retry logic removed for now, needs reconsideration
    }).catch(error => {
        // This catch handles errors during queue.add() itself, not job failures
        logger_1.logger.error(`[IngestionQueue] Failed to add job for object ${objectId}, URI: ${sourceUri} to the queue:`, error);
        // If adding fails, potentially update object status back to 'new' or 'error'?
        // Consider updating status to 'error' here
        // try {
        //   await objectModel.update(objectId, { status: 'error', errorInfo: 'Failed to add to ingestion queue' });
        // } catch (updateError) {
        //   logger.error(`[IngestionQueue] Failed to update status after queue add failure for object ${objectId}:`, updateError);
        // }
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
// TODO: Re-evaluate retry strategy (e.g., using object status and a poller instead of p-queue retries).
//# sourceMappingURL=ingestionQueue.js.map