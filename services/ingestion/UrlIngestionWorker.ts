import { logger } from '../../utils/logger';
import { IngestionJob, IngestionJobModel } from '../../models/IngestionJobModel';
import { ObjectModel } from '../../models/ObjectModel';
import { fetchPageWithFallback } from '../../ingestion/fetch/fetchMethod';
import { cleanTextForEmbedding } from '../../ingestion/clean/textCleaner';
import { Worker } from 'worker_threads';
import path from 'path';
import { ReadabilityParsed, ObjectPropositions } from '../../shared/types';
import { BaseIngestionWorker } from './BaseIngestionWorker';
import { INGESTION_STATUS, PROGRESS_STAGES, WORKER_TIMEOUT_MS } from './constants';
import { getUrlJobData } from './types';
import Database from 'better-sqlite3';
import { LLMService } from '../LLMService';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { JobStatus } from '../../shared/types';

// Resolve the path to the Readability worker script
// In production, the worker is bundled and located in dist/workers/
// When bundled, __dirname points to the dist/electron directory
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
      cleanup();
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
    worker.postMessage({ html, url });
  });
}

export class UrlIngestionWorker extends BaseIngestionWorker {
  private objectModel: ObjectModel;
  private db: Database.Database;
  private llmService: LLMService;

  constructor(
    objectModel: ObjectModel,
    ingestionJobModel: IngestionJobModel,
    llmService: LLMService
  ) {
    super(ingestionJobModel, 'UrlIngestionWorker');
    this.objectModel = objectModel;
    this.llmService = llmService;
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
      await this.updateProgress(job.id, PROGRESS_STAGES.CLEANING, 55, 'Generating document summary');
      const summaryData = await this.generateObjectSummary(cleanedText, parsedContent.title || '');

      // Update to persisting status
      await this.ingestionJobModel.update(job.id, {
        status: INGESTION_STATUS.PERSISTING_DATA
      });
      
      await this.updateProgress(job.id, PROGRESS_STAGES.PERSISTING, 60, 'Saving parsed content');

      // 4. Create or update the object in the database (with transaction)
      const jobData = getUrlJobData(job.jobSpecificData);
      let objectId = job.relatedObjectId || jobData.relatedObjectId;
      
      // Run database operations in a transaction
      // Note: ObjectModel methods are async, so we'll handle the transaction differently
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

      // Mark job as awaiting chunking instead of completed
      await this.ingestionJobModel.update(job.id, {
        status: 'awaiting_chunking' as JobStatus,
        chunking_status: 'pending',
        relatedObjectId: objectId 
      });
      logger.info(`[${this.workerName}] URL job ${job.id} processed, object ${objectId}, awaiting chunking.`);

    } catch (error: any) {
      // Use base class error handling
      await this.handleJobFailure(job, error, {
        url: sourceUri,
        stage: job.status
      });
    }
  }

  /**
   * Generate object-level summary, propositions, and key topics using LLM
   */
  private async generateObjectSummary(
    text: string, 
    title: string
  ): Promise<{ summary: string; propositions: ObjectPropositions; tags: string[] }> {
    const systemPrompt = `You are an expert document analyst. Based on the following text from a web page, please perform the following tasks:
1. Write a comprehensive summary of the document's key information and arguments (approximately 200-400 words).
2. Extract key propositions categorized as:
   - main: Primary claims or key facts
   - supporting: Supporting details or evidence
   - actions: Any actionable items or recommendations
3. Provide a list of 5-7 relevant keywords or tags as a JSON array of strings.

Return your response as a JSON object with the keys: "summary", "propositions" (with "main", "supporting", and "actions" arrays), and "tags".`;

    try {
      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(`Title: ${title}\n\nDocument Text:\n${text.substring(0, 50000)}`) // Limit text length
      ];

      const response = await this.llmService.generateChatResponse(
        messages, 
        { 
          userId: 'system', 
          taskType: 'summarization', 
          priority: 'balanced_throughput' 
        },
        {
          temperature: 0.1,
          outputFormat: 'json_object',
          maxTokens: 2000
        }
      );
      
      // Parse the response
      const parsed = JSON.parse(response.content as string);
      
      // Ensure proper structure with defaults
      return {
        summary: parsed.summary || '',
        propositions: {
          main: parsed.propositions?.main || [],
          supporting: parsed.propositions?.supporting || [],
          actions: parsed.propositions?.actions || []
        },
        tags: parsed.tags || []
      };
    } catch (error) {
      logger.error('[UrlIngestionWorker] Failed to generate object summary:', error);
      // Return minimal defaults on error
      return {
        summary: `Summary of: ${title}`,
        propositions: { main: [], supporting: [], actions: [] },
        tags: []
      };
    }
  }
}