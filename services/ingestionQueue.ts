import os from 'os';
import PQueue from 'p-queue';
import { logger } from '../utils/logger';
import { fetchPageWithFallback } from '../ingestion/fetch/fetchMethod';
import { parseHtml } from '../ingestion/clean/readabilityParser';
import * as ContentModel from '../models/ContentModel';
import { ContentStatus } from '../models/ContentModel'; // Import the type

// --- Queue Configuration ---
const MAX_ATTEMPTS = 3;
// Determine concurrency based on CPU cores, minimum of 2, max reasonable (e.g., 16)
const cpuCount = os.cpus().length;
const concurrency = Math.max(2, Math.min(cpuCount * 2, 16));
const BASE_RETRY_DELAY_MS = 2000; // Base delay: 2 seconds
const JITTER_MS = 500; // Max random jitter: 0.5 seconds

logger.info(`[IngestionQueue] Initializing with concurrency: ${concurrency}`);

// --- Queue Instance ---
const queue = new PQueue({ concurrency });

// --- Job Interface ---
interface IngestionJob {
  bookmarkId: string;
  url: string;
  attempt: number; // Current attempt number (starts at 1)
}

// Keep track of URLs currently being processed to avoid duplicates
const processingUrls = new Set<string>();

// --- Core Job Processing Logic ---
async function processJob(job: IngestionJob): Promise<void> {
  logger.info(`[IngestionQueue] Processing job for bookmark ${job.bookmarkId}, URL: ${job.url}, Attempt: ${job.attempt}`);

  // Basic check to prevent race conditions if a URL gets added again quickly
  if (processingUrls.has(job.url)) {
      logger.warn(`[IngestionQueue] URL ${job.url} is already being processed. Skipping duplicate job for bookmark ${job.bookmarkId}.`);
      return;
  }
  processingUrls.add(job.url);

  // Determine fetch options (if any are needed/configured)
  // For now, using defaults by passing an empty object
  const fetchOptions = {};

  try {
    // 1. Fetch the page using the new fallback method
    logger.debug(`[IngestionQueue] Calling fetchPageWithFallback for URL: ${job.url}`);
    const fetchResult = await fetchPageWithFallback(job.url, fetchOptions);
    logger.debug(`[IngestionQueue] Fetch successful for bookmark ${job.bookmarkId}, Final URL: ${fetchResult.finalUrl}`);

    // 2. Parse HTML with Readability
    const parsedContent = parseHtml(fetchResult.html, fetchResult.finalUrl);

    if (!parsedContent) {
      // Parsing failed or no content found
      logger.warn(`[IngestionQueue] Parsing failed or no content for bookmark ${job.bookmarkId}, URL: ${fetchResult.finalUrl}`);
      await ContentModel.upsertContent({
        bookmarkId: job.bookmarkId,
        sourceUrl: fetchResult.finalUrl, // Use final URL from fetch result
        status: 'parse_fail',
        parsedContent: null,
        fetchedAt: new Date(),
        // Add other fields as required by your model
      });
    } else {
      // Parsing successful, store content
      logger.info(`[IngestionQueue] Parsing successful for bookmark ${job.bookmarkId}, Title: ${parsedContent.title}`);
      await ContentModel.upsertContent({
        bookmarkId: job.bookmarkId,
        sourceUrl: fetchResult.finalUrl, // Use final URL from fetch result
        status: 'ok',
        parsedContent: parsedContent,
        fetchedAt: new Date(),
        // Add other fields as required by your model
      });
    }

  } catch (error: any) {
    logger.error(`[IngestionQueue] Error processing job for bookmark ${job.bookmarkId}, URL: ${job.url}, Attempt: ${job.attempt}`, error);

    // Determine final status based on error type? Optional, default to generic fail
    let finalStatus: ContentStatus = 'fetch_fail';
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

  } finally {
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
export async function queueForContentIngestion(bookmarkId: string, url: string): Promise<void> {
  // Basic URL validation (optional)
  if (!url || !url.startsWith('http')) {
    logger.warn(`[IngestionQueue] Invalid URL provided for bookmark ${bookmarkId}: ${url}. Skipping.`);
    return;
  }

  // Check if already processing to avoid adding duplicates immediately
  if (processingUrls.has(url)) {
    logger.info(`[IngestionQueue] URL ${url} is currently being processed. Not adding duplicate for bookmark ${bookmarkId}.`);
    return;
  }

  logger.info(`[IngestionQueue] Queuing ingestion for bookmark ${bookmarkId}, URL: ${url}`);

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
    logger.error(`[IngestionQueue] Job ultimately failed for bookmark ${bookmarkId}, URL: ${url} after all retries:`, error);
    // Final failure state should already be logged by processJob's catch block
  });
}

/**
 * Gets the number of currently pending tasks in the queue.
 */
export function getQueueSize(): number {
    return queue.size;
}

/**
 * Gets the number of tasks currently being processed.
 */
export function getQueuePendingCount(): number {
    return queue.pending;
}

// Optional: Add functions to pause, resume, clear the queue if needed later.

// TODO: Add EventEmitter logic for progress updates later.
