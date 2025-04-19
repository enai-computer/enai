import os from 'os';
import PQueue from 'p-queue';
import { logger } from '../utils/logger';
import {
  fetchPage,
  FetchTimeoutError,
  FetchSizeLimitError,
  FetchHTTPError,
  UnsupportedContentTypeError,
} from '../ingestion/fetch/pageFetcher';
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
  url: string; // This is the canonicalUrl initially
  attempt: number;
}

// --- Core Job Processing Logic ---
async function processJob(job: IngestionJob): Promise<void> {
  logger.info(`[IngestionQueue] Processing job for bookmark ${job.bookmarkId}, URL: ${job.url}, Attempt: ${job.attempt}`);

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
    } catch(dbError) {
        logger.error(`[IngestionQueue] Failed to mark job as pending for bookmark ${job.bookmarkId}. Aborting job.`, dbError);
        // If we can't even mark it pending, something is wrong, don't proceed.
        return;
    }
  }

  try {
    // 1. Fetch the page
    const fetchResult = await fetchPage(job.url);
    logger.debug(`[IngestionQueue] Fetch successful for bookmark ${job.bookmarkId}, Final URL: ${fetchResult.finalUrl}`);

    // 2. Parse HTML with Readability
    const parsedContent = parseHtml(fetchResult.html, fetchResult.finalUrl);

    if (!parsedContent) {
      // Parsing failed or no content found
      logger.warn(`[IngestionQueue] Parsing failed or no content for bookmark ${job.bookmarkId}, URL: ${fetchResult.finalUrl}`);
      ContentModel.upsertContent({
        bookmarkId: job.bookmarkId,
        sourceUrl: fetchResult.finalUrl,
        status: 'parse_fail',
        parsedContent: null,
        fetchedAt: new Date(),
      });
    } else {
      // Parsing successful, store content
      logger.info(`[IngestionQueue] Parsing successful for bookmark ${job.bookmarkId}, Title: ${parsedContent.title}`);
      ContentModel.upsertContent({
        bookmarkId: job.bookmarkId,
        sourceUrl: fetchResult.finalUrl,
        status: 'ok',
        parsedContent: parsedContent,
        fetchedAt: new Date(),
      });
    }

  } catch (error: any) {
    // 3. Handle Fetch and Parsing Errors
    logger.warn(`[IngestionQueue] Error processing job for bookmark ${job.bookmarkId} (Attempt ${job.attempt}/${MAX_ATTEMPTS}):`, error);

    let status: ContentStatus = 'fetch_error'; // Default error status
    let isRetryable = false;

    if (error instanceof FetchTimeoutError) {
      status = 'timeout';
      isRetryable = true;
    } else if (error instanceof FetchSizeLimitError) {
      status = 'too_large';
      isRetryable = false;
    } else if (error instanceof FetchHTTPError) {
      status = 'http_error';
      // Retry only on server errors (5xx) or specific client errors (408, 429)
      if (error.status >= 500 || error.status === 408 || error.status === 429) {
        isRetryable = true;
      }
    } else if (error instanceof UnsupportedContentTypeError) {
        status = 'fetch_error'; // Or a more specific status like 'unsupported_type'
        isRetryable = false; // Don't retry unsupported types
    } else if (error.name === 'AbortError') {
        // Check the cause if available (from fetchPage logic)
        if (error.cause instanceof FetchTimeoutError) {
            status = 'timeout';
            isRetryable = true;
        } else if (error.cause instanceof FetchSizeLimitError) {
            status = 'too_large';
            isRetryable = false;
        }
        // Otherwise, keep default 'fetch_error'
    } else {
        // Assume other errors might be transient network issues
        isRetryable = true;
    }

    if (isRetryable && job.attempt < MAX_ATTEMPTS) {
      // Retry the job with exponential backoff + jitter
      const backoff = BASE_RETRY_DELAY_MS * Math.pow(2, job.attempt -1); // Exponential backoff (2s, 4s)
      const jitter = Math.random() * JITTER_MS; // Add random jitter (0-500ms)
      const delay = backoff + jitter;
      logger.info(`[IngestionQueue] Retrying job for bookmark ${job.bookmarkId} in ${(delay / 1000).toFixed(1)}s (Attempt ${job.attempt + 1})`);
      setTimeout(() => {
        queue.add(() => processJob({ ...job, attempt: job.attempt + 1 }));
      }, delay);
    } else {
      // Max attempts reached or error is not retryable, update DB with final error status
      logger.error(`[IngestionQueue] Job failed permanently for bookmark ${job.bookmarkId} after ${job.attempt} attempts. Status: ${status}`);
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
export function queueForContentIngestion(bookmarkId: string, url: string): void {
  logger.info(`[IngestionQueue] Queuing bookmark ${bookmarkId} for content ingestion. URL: ${url}`);
  const job: IngestionJob = {
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
