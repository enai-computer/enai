import os from 'os';
import path from 'path';
import { Worker } from 'worker_threads';
import PQueue from 'p-queue';
import { logger } from '../utils/logger';
import { fetchPageWithFallback } from '../ingestion/fetch/fetchMethod';
import { cleanTextForEmbedding } from '../ingestion/clean/textCleaner';
import { ObjectModel } from '../models/ObjectModel';
import { ObjectStatus, ReadabilityParsed } from '../shared/types';

// --- Constants ---
const DEFAULT_MAX_CONCURRENCY = 16;
const DEFAULT_JOB_PRIORITY = 1;
const MAX_ERROR_INFO_LENGTH = 1024; // Limit stored error message length
const WORKER_TIMEOUT_MS = 30000; // 30 seconds timeout for the worker

// Resolve the path to the Readability worker script RELATIVE to the built file location
const readabilityWorkerPath = path.resolve(
  __dirname,
  '../workers/readabilityWorker.js',
);
logger.info(`[IngestionQueue] Readability worker path resolved to: ${readabilityWorkerPath}`);

// Helper function to run Readability in a worker
async function parseHtmlInWorker(html: string, url: string): Promise<ReadabilityParsed | null> {
  return new Promise((resolve, reject) => {
    // Check if file exists before creating worker
    // Note: This check might not be strictly necessary but can help debugging path issues
    try {
      require.resolve(readabilityWorkerPath);
    } catch (err) {
      logger.error(`[IngestionQueue] Readability worker file not found at: ${readabilityWorkerPath}`);
      return reject(new Error(`Worker file not found: ${readabilityWorkerPath}`));
    }

    logger.debug(`[IngestionQueue] Creating Readability worker for URL: ${url}`);
    const worker = new Worker(readabilityWorkerPath);
    let timeoutId: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      worker.removeAllListeners('message');
      worker.removeAllListeners('error');
      worker.removeAllListeners('exit');
      worker.terminate().catch(err => logger.error('[IngestionQueue] Error terminating worker:', err));
      logger.debug(`[IngestionQueue] Readability worker cleaned up for URL: ${url}`);
    };

    timeoutId = setTimeout(() => {
      logger.warn(`[IngestionQueue] Readability worker timed out for URL: ${url}`);
      cleanup();
      reject(new Error('Readability worker timed out'));
    }, WORKER_TIMEOUT_MS);

    worker.on('message', (message: { result?: ReadabilityParsed | null; error?: string }) => {
      logger.debug(`[IngestionQueue] Received message from worker for URL ${url}:`, message);
      cleanup();
      if (message.error) {
        reject(new Error(message.error));
      } else {
        // The worker sends { result: null } or { result: ReadabilityParsed }
        resolve(message.result === undefined ? null : message.result);
      }
    });

    worker.on('error', (error) => {
      logger.error(`[IngestionQueue] Readability worker error for URL ${url}:`, error);
      cleanup();
      reject(error);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        logger.error(`[IngestionQueue] Readability worker stopped with exit code ${code} for URL ${url}`);
        // Reject if it hasn't already resolved/rejected via message/error/timeout
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
      cleanup(); // Ensure cleanup happens on exit too
    });

    logger.debug(`[IngestionQueue] Sending data to worker for URL: ${url}`);
    worker.postMessage({ html, url });
  });
}

// --- Queue Configuration ---
const cpuCount = os.cpus().length;
const defaultConcurrency = Math.max(2, Math.min(cpuCount * 2, DEFAULT_MAX_CONCURRENCY));
const concurrency = Number(process.env.INGEST_CONCURRENCY) || defaultConcurrency;

logger.info(`[IngestionQueue] Initializing with concurrency: ${concurrency} (Default: ${defaultConcurrency}, Max Cap: ${DEFAULT_MAX_CONCURRENCY})`);

// --- Queue Instance ---
const queue = new PQueue({ concurrency });

// --- Job Interface ---
interface IngestionJob {
  objectId: string;
  sourceUri: string;
}

// Keep track of URIs currently being processed OR already queued
const processingUris = new Set<string>(); // Actively running jobs
const queuedUris = new Set<string>();     // Jobs waiting in the queue

// --- Core Job Processing Logic ---
async function processJob(job: IngestionJob, objectModel: ObjectModel): Promise<void> {
  // Note: queuedUris check happens *before* adding to queue.
  // processingUris check happens here to cover the moment between queue start and this function call.
  logger.info(`[IngestionQueue] Processing job for object ${job.objectId}, URI: ${job.sourceUri}`);

  if (processingUris.has(job.sourceUri)) {
    logger.warn(`[IngestionQueue] URI ${job.sourceUri} is already being processed (race condition?). Skipping duplicate job for object ${job.objectId}.`);
    return; // Should ideally not happen if queuedUris works, but belt-and-suspenders
  }
  processingUris.add(job.sourceUri);

  const fetchOptions = {};

  try {
    // 1. Fetch the page
    logger.debug(`[IngestionQueue] Calling fetchPageWithFallback for URI: ${job.sourceUri}`);
    const fetchResult = await fetchPageWithFallback(job.sourceUri, fetchOptions);
    logger.debug(`[IngestionQueue] Fetch successful for object ${job.objectId}, Final URL: ${fetchResult.finalUrl}`);

    // 2. Parse HTML in Worker
    logger.debug(`[IngestionQueue] Calling parseHtmlInWorker for URL: ${fetchResult.finalUrl}`);
    // parseHtmlInWorker already handles timeout and errors, returning promise
    const parsedContent = await parseHtmlInWorker(fetchResult.html, fetchResult.finalUrl);

    // Check handles null or empty content scenario
    if (!parsedContent) {
      // Parsing failed or no content found
      logger.warn(`[IngestionQueue] Parsing failed or no content (via worker) for object ${job.objectId}, URL: ${fetchResult.finalUrl}`);
      // Use objectModel.update to set status and error
      await objectModel.update(job.objectId, {
          status: 'error',
          errorInfo: 'Parsing failed or no content found (via worker).',
          // Optionally update sourceUri if it changed due to redirects
          ...(fetchResult.finalUrl !== job.sourceUri && { sourceUri: fetchResult.finalUrl }),
          parsedContentJson: null,
          cleanedText: null, // Also clear cleaned text on parse failure
          parsedAt: undefined,
      });
    } else {
      // Parsing successful, clean the text and store content
      logger.info(`[IngestionQueue] Parsing successful (via worker) for object ${job.objectId}, Title: ${parsedContent.title}`);

      // 3. Clean the extracted text for embedding
      const cleanedText = cleanTextForEmbedding(parsedContent.textContent);
      logger.debug(`[IngestionQueue] Cleaned text length: ${cleanedText.length} for object ${job.objectId}`);

      // 4. Use objectModel.update to store result including cleaned text
      await objectModel.update(job.objectId, {
          status: 'parsed',
          title: parsedContent.title,
          parsedContentJson: JSON.stringify(parsedContent),
          cleanedText: cleanedText,
          parsedAt: new Date(),
          errorInfo: null,
          ...(fetchResult.finalUrl !== job.sourceUri && { sourceUri: fetchResult.finalUrl })
      });
    }

  } catch (error: any) {
    logger.error(`[IngestionQueue] Error processing job for object ${job.objectId}, URI: ${job.sourceUri}`, error);

    // Determine final status based on error type? Optional, default to generic error
    let finalStatus: ObjectStatus = 'error'; // Generic error status
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
        parsedContentJson: null,
        cleanedText: null,
        parsedAt: undefined,
    });

    // Do not re-throw here; the queue should know the job finished (failed)
    // Retry logic might be handled elsewhere or not implemented yet

  } finally {
    // Always remove the URI from the processing set when job finishes/errors
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
export async function queueForContentIngestion(objectId: string, sourceUri: string, objectModel: ObjectModel): Promise<void> {
  // Basic URI validation (optional)
  if (!sourceUri || !sourceUri.startsWith('http')) {
    logger.warn(`[IngestionQueue] Invalid URI provided for object ${objectId}: ${sourceUri}. Skipping.`);
    return;
  }

  // Check if already processing OR queued to avoid duplicates
  if (processingUris.has(sourceUri) || queuedUris.has(sourceUri)) {
    logger.debug(`[IngestionQueue] URI ${sourceUri} is currently processing or already queued. Not adding duplicate for object ${objectId}.`);
    return;
  }

  logger.debug(`[IngestionQueue] Queuing ingestion for object ${objectId}, URI: ${sourceUri}`);
  queuedUris.add(sourceUri); // Add to queued set *before* adding to PQueue

  await queue.add(async () => {
    try {
      await processJob({ objectId, sourceUri }, objectModel);
    } finally {
      // Remove from queued set when the job function *finishes* (success or error)
      // Note: processingUris is handled inside processJob's finally block
      queuedUris.delete(sourceUri);
    }
  }, {
    priority: DEFAULT_JOB_PRIORITY,
  }).catch(async (error) => { // Make catch async
    // This catch handles errors during queue.add() itself OR errors thrown from processJob that weren't caught inside it
    logger.error(`[IngestionQueue] Failed to add or process job for object ${objectId}, URI: ${sourceUri} in the queue:`, error);

    // Ensure URI is removed from queued set if queue.add fails or job crashes unexpectedly
    queuedUris.delete(sourceUri);
    processingUris.delete(sourceUri); // Also clear from processing just in case

    // If adding fails or job crashes hard, update object status to 'error'
    try {
      await objectModel.update(objectId, { status: 'error', errorInfo: `Failed during queue operation: ${error?.message ?? error}` });
    } catch (updateError) {
      logger.error(`[IngestionQueue] CRITICAL: Failed to update status to 'error' after queue failure for object ${objectId}:`, updateError);
    }
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

// --- Graceful Shutdown Handling ---
async function shutdownQueue(): Promise<void> {
  logger.info('[IngestionQueue] Shutting down... Waiting for active jobs to finish.');
  // Stop adding new items
  // Wait for queue to become idle (all pending tasks finished)
  await queue.onIdle();
  logger.info('[IngestionQueue] Queue is idle. Shutdown complete.');
  // Optional: Clear the queue if tasks should not resume on restart
  // queue.clear(); // Uncomment if persistence isn't used and restart should be clean
}

let isShuttingDown = false;
process.on('SIGINT', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info('[IngestionQueue] Received SIGINT. Starting graceful shutdown...');
  try {
    await shutdownQueue();
    process.exit(0);
  } catch (err) {
    logger.error('[IngestionQueue] Error during SIGINT shutdown:', err);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info('[IngestionQueue] Received SIGTERM. Starting graceful shutdown...');
  try {
    await shutdownQueue();
    process.exit(0);
  } catch (err) {
    logger.error('[IngestionQueue] Error during SIGTERM shutdown:', err);
    process.exit(1);
  }
});

// TODO: Add EventEmitter logic for progress updates later.
// TODO: Re-evaluate retry strategy (e.g., using object status and a poller instead of p-queue retries).
