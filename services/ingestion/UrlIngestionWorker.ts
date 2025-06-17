import { logger } from '../../utils/logger';
import { IngestionJob, IngestionJobModel } from '../../models/IngestionJobModel';
import { ObjectModel } from '../../models/ObjectModel';
import { fetchPageWithFallback } from '../../ingestion/fetch/fetchMethod';
import { cleanTextForEmbedding } from '../../ingestion/clean/textCleaner';
import { Worker } from 'worker_threads';
import path from 'path';
import { ReadabilityParsed, ObjectPropositions, JobStatus } from '../../shared/types';
import { BaseIngestionWorker } from './BaseIngestionWorker';
import { INGESTION_STATUS, PROGRESS_STAGES, WORKER_TIMEOUT_MS } from './constants';
import { getUrlJobData } from './types';
import Database from 'better-sqlite3';
import { IngestionAiService } from './IngestionAIService';

// Resolve the path to the Readability worker script
// In production, the worker is bundled and located in dist/workers/
// When bundled, __dirname points to the dist/electron directory
// @claude can you resolve the when bundled and in production comments above - why are they different? is it in dist/workers or dist/electron/workers? 
const readabilityWorkerPath = path.resolve(
  process.cwd(),
  'dist/workers/readabilityWorker.js',
);

// Helper function to run Readability in a worker
async function parseHtmlInWorker(html: string, url: string): Promise<ReadabilityParsed | null> {
  return new Promise((resolve, reject) => {
    // Check if file exists before creating worker
    try {
      require.resolve(readabilityWorkerPath);
    } catch (err) {
      logger.error(`[UrlIngestionWorker] Readability worker file not found at: ${readabilityWorkerPath}`);
      return reject(new Error(`Worker file not found: ${readabilityWorkerPath}`));
    }

    logger.debug(`[UrlIngestionWorker] Creating Readability worker for URL: ${url}`);
    const worker = new Worker(readabilityWorkerPath);
    let timeoutId: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      worker.removeAllListeners('message');
      worker.removeAllListeners('error');
      worker.removeAllListeners('exit');
      worker.terminate().catch(err => logger.error('[UrlIngestionWorker] Error terminating worker:', err));
      logger.debug(`[UrlIngestionWorker] Readability worker cleaned up for URL: ${url}`);
    };

    timeoutId = setTimeout(() => {
      logger.warn(`[UrlIngestionWorker] Readability worker timed out for URL: ${url}`);
      cleanup();
      reject(new Error('Readability worker timed out'));
    }, WORKER_TIMEOUT_MS);

    worker.on('message', (message: { result?: ReadabilityParsed | null; error?: string }) => {
      logger.debug(`[UrlIngestionWorker] Received message from worker for URL ${url}:`, message);
      cleanup();
      if (message.error) {
        reject(new Error(message.error));
      } else {
        // The worker sends { result: null } or { result: ReadabilityParsed }
        resolve(message.result === undefined ? null : message.result);
      }
    });

    worker.on('error', (error) => {
      logger.error(`[UrlIngestionWorker] Readability worker error for URL ${url}:`, error);
      cleanup(); // @claude please add a 1000 maximum character size for all these errors
      reject(error);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        logger.error(`[UrlIngestionWorker] Readability worker stopped with exit code ${code} for URL ${url}`);
        // Reject if it hasn't already resolved/rejected via message/error/timeout
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
      cleanup(); // Ensure cleanup happens on exit too
    });

    logger.debug(`[UrlIngestionWorker] Sending data to worker for URL: ${url}`);
    worker.postMessage({ html, url }); // @claude is it possible that these data messages are sending all of the content to the worker? if so, or maybe in either case, we should have maximum 1000 characters for these messages.
  });
}

export class UrlIngestionWorker extends BaseIngestionWorker {
  private objectModel: ObjectModel;
  private db: Database.Database;
  private ingestionAiService: IngestionAiService;

  constructor(
    objectModel: ObjectModel,
    ingestionJobModel: IngestionJobModel,
    ingestionAiService: IngestionAiService
  ) {
    super(ingestionJobModel, 'UrlIngestionWorker');
    this.objectModel = objectModel;
    this.ingestionAiService = ingestionAiService;
    // Get the database instance for transaction support
    this.db = objectModel.getDatabase();
  }

  async execute(job: IngestionJob): Promise<void> {
    const sourceUri = job.sourceIdentifier;
    logger.info(`[${this.workerName}] Processing URL job ${job.id}: ${sourceUri}`);
    
    try {
      // Update job status to processing_source
      await this.ingestionJobModel.update(job.id, {
        status: INGESTION_STATUS.PROCESSING_SOURCE
      });
      
      await this.updateProgress(job.id, PROGRESS_STAGES.FETCHING, 0, 'Starting URL fetch');

      // 1. Fetch the page
      logger.debug(`[${this.workerName}] Fetching URL: ${sourceUri}`);
      const fetchOptions = {};
      const fetchResult = await fetchPageWithFallback(sourceUri, fetchOptions);
      logger.debug(`[${this.workerName}] Fetch successful, Final URL: ${fetchResult.finalUrl}`);

      // Update to parsing status
      // @claude how do PROGRESS_STAGES and INGESTION_STATUS relate to each other? Is progress the action that's being taken on the status?
      await this.ingestionJobModel.update(job.id, {
        status: INGESTION_STATUS.PARSING_CONTENT
      });
      
      await this.updateProgress(job.id, PROGRESS_STAGES.PARSING, 30, 'Parsing HTML content');

      // 2. Parse HTML in Worker
      logger.debug(`[${this.workerName}] Parsing HTML for URL: ${fetchResult.finalUrl}`);
      const parsedContent = await parseHtmlInWorker(fetchResult.html, fetchResult.finalUrl);

      if (!parsedContent) {
        // Parsing failed or no content found
        logger.warn(`[${this.workerName}] Parsing failed or no content for job ${job.id}`);
        await this.ingestionJobModel.markAsFailed(
          job.id, 
          this.formatErrorInfo({
            name: 'ParsingFailed',
            message: 'Failed to extract content from webpage'
          }, { url: fetchResult.finalUrl }),
          INGESTION_STATUS.PARSING_CONTENT
        );
        return;
      }

      logger.info(`[${this.workerName}] Parsing successful, Title: ${parsedContent.title}`);

      // 3. Clean the extracted text for embedding
      await this.updateProgress(job.id, PROGRESS_STAGES.CLEANING, 50, 'Cleaning text for embeddings');
      const cleanedText = cleanTextForEmbedding(parsedContent.textContent);
      logger.debug(`[${this.workerName}] Cleaned text length: ${cleanedText.length}`);

      // 3.5. Generate object-level summary, propositions, and key topics
      await this.ingestionJobModel.update(job.id, { status: INGESTION_STATUS.AI_PROCESSING });
      await this.updateProgress(job.id, PROGRESS_STAGES.SUMMARIZING, 55, 'Generating document summary');
      
      let summaryData;
      try {
        const aiContent = await this.ingestionAiService.generateObjectSummary(
          cleanedText, 
          parsedContent.title || '', 
          job.id // Using job ID as object ID for logging
        );
        
        // Transform AiGeneratedContent to the expected format
        summaryData = {
          summary: aiContent.summary,
          propositions: BaseIngestionWorker.transformPropositions(aiContent.propositions),
          tags: aiContent.tags
        };
      } catch (error) {
        logger.error(`[${this.workerName}] Failed to generate object summary for job ${job.id}:`, error);
        // Fallback behavior - caller decides
        summaryData = {
          summary: `Summary of: ${parsedContent.title || 'Untitled'}`,
          propositions: { main: [], supporting: [], actions: [] },
          tags: []
        };
      }

      // Update to persisting status
      await this.ingestionJobModel.update(job.id, {
        status: INGESTION_STATUS.PERSISTING_DATA
      });
      
      await this.updateProgress(job.id, PROGRESS_STAGES.PERSISTING, 60, 'Saving parsed content');

      // 4. Create or update the object in the database (with transaction)
      const jobData = getUrlJobData(job.jobSpecificData);
      let objectId = job.relatedObjectId || jobData.relatedObjectId;
      
      // Create or update object and mark job as vectorizing in a single operation
      // This ensures we don't have orphaned objects if job update fails
      try {
        if (!objectId) {
          // Create new object
          const newObject = await this.objectModel.create({
            objectType: 'web_page',
            sourceUri: fetchResult.finalUrl,
            title: parsedContent.title,
            status: 'parsed',
            rawContentRef: null,
            parsedContentJson: JSON.stringify(parsedContent),
            cleanedText: cleanedText,
            errorInfo: null,
            parsedAt: new Date(),
            // Object-level summary fields
            summary: summaryData.summary,
            propositionsJson: JSON.stringify(summaryData.propositions),
            tagsJson: JSON.stringify(summaryData.tags),
            summaryGeneratedAt: new Date()
          });
          objectId = newObject.id;
        } else {
          // Update existing object
          await this.objectModel.update(objectId, {
            status: 'parsed',
            title: parsedContent.title,
            parsedContentJson: JSON.stringify(parsedContent),
            cleanedText: cleanedText,
            parsedAt: new Date(),
            errorInfo: null,
            // Object-level summary fields
            summary: summaryData.summary,
            propositionsJson: JSON.stringify(summaryData.propositions),
            tagsJson: JSON.stringify(summaryData.tags),
            summaryGeneratedAt: new Date(),
            ...(fetchResult.finalUrl !== sourceUri && { sourceUri: fetchResult.finalUrl })
          });
        }

        await this.updateProgress(job.id, PROGRESS_STAGES.FINALIZING, 100, 'URL processing completed');

        // Mark job as vectorizing with the object ID
        // If this fails, at least we have the object created
        await this.ingestionJobModel.update(job.id, {
          status: 'vectorizing' as JobStatus,
          chunking_status: 'pending',
          relatedObjectId: objectId 
        });
        
        logger.info(`[${this.workerName}] Successfully created/updated object ${objectId} and marked job ${job.id.substring(0, 8)} as vectorizing`);
        
      } catch (error) {
        // If we created an object but failed to update the job, log it
        if (objectId && !job.relatedObjectId) {
          logger.error(`[${this.workerName}] Created object ${objectId} but failed to update job ${job.id}:`, error);
        }
        throw error; // Re-throw to trigger job failure handling
      }

    } catch (error: any) {
      // Use base class error handling
      await this.handleJobFailure(job, error, {
        url: sourceUri,
        stage: job.status
      });
    }
  }

}