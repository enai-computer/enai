import { EventEmitter } from 'events';
import { IngestionJobModel, IngestionJob } from '../../models/IngestionJobModel';
import { ObjectModel } from '../../models/ObjectModel';
import { ChunkSqlModel } from '../../models/ChunkModel';
import { EmbeddingSqlModel } from '../../models/EmbeddingModel';
import { IVectorStoreModel } from '../../shared/types/vector.types';
import { JobType, JobStatus } from '../../shared/types';
import { IIngestionWorker } from './types';
import { BaseService } from '../base/BaseService';
import { BaseServiceDependencies } from '../interfaces';
import { UrlIngestionWorker } from './UrlIngestionWorker';
import { PdfIngestionWorker } from './PdfIngestionWorker';
import { IngestionAiService } from './IngestionAIService';
import { PdfIngestionService } from './PdfIngestionService';
import { NotFoundError } from '../base/ServiceError';
import type { BrowserWindow } from 'electron';

export interface QueueConfig {
  concurrency?: number;
  pollInterval?: number; // milliseconds
  maxRetries?: number;
  retryDelay?: number; // milliseconds
}

export interface JobProcessor {
  (job: IngestionJob): Promise<void>;
}

interface IngestionQueueServiceDeps extends BaseServiceDependencies {
  ingestionJobModel: IngestionJobModel;
  objectModel: ObjectModel;
  chunkSqlModel: ChunkSqlModel;
  embeddingSqlModel: EmbeddingSqlModel;
  vectorModel: IVectorStoreModel;
  ingestionAiService: IngestionAiService;
  pdfIngestionService: PdfIngestionService;
  mainWindow?: BrowserWindow;
}

export class IngestionQueueService extends BaseService<IngestionQueueServiceDeps> {
  private readonly emitter: EventEmitter;
  private config: Required<QueueConfig>;
  private processors: Map<JobType, JobProcessor>;
  private activeJobs: Map<string, Promise<void>> = new Map();

  constructor(deps: IngestionQueueServiceDeps, config?: QueueConfig) {
    super('IngestionQueueService', deps);
    this.emitter = new EventEmitter();
    this.config = {
      concurrency: config?.concurrency || 12, // Increased for Tier 2 limits (5000 RPM). This applies to both URLs and PDFs
      pollInterval: config?.pollInterval || 5000,
      maxRetries: config?.maxRetries || 3, // @claude please validate how we're managing retries - does this map to attempts in IngestionJobModel's IngestionJobRow interface?
      retryDelay: config?.retryDelay || 70000,
    };
    this.processors = new Map();
    
    this.logInfo('Initialized with config:', this.config);
  }

  /**
   * Initialize the service and register ingestion workers
   */
  async initialize(): Promise<void> {
    await super.initialize();
    
    // Create worker instances with their dependencies
    const urlWorker = new UrlIngestionWorker(
      this.deps.objectModel,
      this.deps.ingestionJobModel,
      this.deps.ingestionAiService
    );
    
    const pdfWorker = new PdfIngestionWorker(
      this.deps.pdfIngestionService,
      this.deps.objectModel,
      this.deps.chunkSqlModel,
      this.deps.embeddingSqlModel,
      this.deps.vectorModel,
      this.deps.ingestionJobModel,
      this.deps.mainWindow
    );
    
    // Register workers as job processors
    this.registerProcessor('url', urlWorker.execute.bind(urlWorker));
    this.registerProcessor('pdf', pdfWorker.execute.bind(pdfWorker));
    
    this.logInfo('Workers registered successfully');
  }

  /**
   * Register a processor for a specific job type >> 
   */
  // @claude does this map to job_type in IngestionJobRow interface? Please evaluate and explain the naming convention here - is it intentional? 
  registerProcessor(jobType: JobType, processor: JobProcessor): void {
    this.processors.set(jobType, processor);
    this.logInfo(`Registered processor for job type: ${jobType}`);
  }

  /**
   * Process available jobs in the queue.
   * This method is called by SchedulerService at regular intervals.
   */
  async processJobs(): Promise<void> {
    return this.execute('processJobs', async () => {
      await this.poll();
    });
  }

  /**
   * Add a job to the queue
   */
  async addJob(
    jobType: JobType,
    sourceIdentifier: string,
    options?: {
      originalFileName?: string;
      priority?: number;
      jobSpecificData?: any;
    }
  ): Promise<IngestionJob> {
    const job = this.deps.ingestionJobModel.create({
      jobType,
      sourceIdentifier,
      originalFileName: options?.originalFileName,
      priority: options?.priority,
      jobSpecificData: options?.jobSpecificData,
    });

    this.emitter.emit('job:created', job);
    
    // No longer auto-polling - SchedulerService will call processJobs

    return job;
  }

  /**
   * Create a URL ingestion job with duplicate checking.
   * Checks if the URL already exists in the objects table before creating a new job.
   * @param url - The URL to ingest
   * @param title - Optional title for the page
   * @returns Object containing jobId (if created) and alreadyExists flag
   */
  async createUrlIngestionJob(url: string, title?: string): Promise<{ jobId: string | null; alreadyExists: boolean }> {
    try {
      // Check if the URL already exists in the objects table
      const exists = await this.deps.objectModel.existsBySourceUri(url);
      
      if (exists) {
        this.logInfo(`URL already exists in objects: ${url}`);
        return { jobId: null, alreadyExists: true };
      }

      // Create a new ingestion job for the URL
      const job = await this.addJob('url', url, {
        originalFileName: title,
        jobSpecificData: {
          objectType: 'webpage',
          title: title
        }
      });

      this.logInfo(`Created URL ingestion job ${job.id} for: ${url}`);
      return { jobId: job.id, alreadyExists: false };

    } catch (error) {
      this.logError(`Error creating URL ingestion job for ${url}:`, error);
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): Record<JobStatus, number> {
    return this.deps.ingestionJobModel.getStats();
  }

  /**
   * Get active job count
   */
  getActiveJobCount(): number {
    return this.activeJobs.size;
  }

  /**
   * Poll for new jobs and process them
   */
  private async poll(): Promise<void> {

    try {
      // Check if we have capacity for more jobs >> @claude where is the maximum number of jobs defined and how does that map to availableSlots? What factors constrain the maximum number of jobs? Eg. memory, gpu...?
      const availableSlots = this.config.concurrency - this.activeJobs.size;
      if (availableSlots <= 0) {
        this.logDebug(`No available slots for processing (${this.activeJobs.size}/${this.config.concurrency} active)`);
        return;
      }

      // Get next jobs to process
      const jobTypes = Array.from(this.processors.keys());
      const jobs = this.deps.ingestionJobModel.getNextJobs(availableSlots, jobTypes);

      if (jobs.length > 0) {
        this.logDebug(`Found ${jobs.length} jobs to process`);
        
        // Process each job
        for (const job of jobs) {
          if (this.activeJobs.size >= this.config.concurrency) {
            break; // Reached concurrency limit
          }

          const processor = this.processors.get(job.jobType);
          if (!processor) {
            this.logError(`No processor registered for job type: ${job.jobType}`);
            this.deps.ingestionJobModel.markAsFailed(job.id, 'No processor registered for job type', 'processing_source');
            continue;
          }

          // Start processing the job
          const jobPromise = this.processJob(job, processor);
          this.activeJobs.set(job.id, jobPromise);

          // Clean up when done
          jobPromise.finally(() => {
            this.activeJobs.delete(job.id);
          });
        }
      }
    } catch (error) {
      this.logError('Error during poll:', error);
    }

  }

  /**
   * Process a single job
   */
  private async processJob(job: IngestionJob, processor: JobProcessor): Promise<void> {
    this.logInfo(`Processing job ${job.id} (${job.jobType}`);
    
    try {
      // Mark job as started
      this.deps.ingestionJobModel.markAsStarted(job.id);
      this.emitter.emit('job:started', job);

      // Process the job
      await processor(job);

      // Don't mark as completed - let jobs manage their own lifecycle
      // Multi-stage jobs (URL, PDF) will transition to 'vectorizing' 
      // and ChunkingService will mark them as 'completed'
      // this.deps.ingestionJobModel.markAsCompleted(job.id);
      
      // This event fires when the worker completes processing, not when the entire job is done
      // For multi-stage jobs (URL, PDF), ChunkingService will handle final completion
      this.emitter.emit('worker:completed', job);
      
      this.logInfo(`Job ${job.id} processed successfully`);
    } catch (error) {
      this.logError(`Job ${job.id} failed:`, error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedStage = this.getFailedStage(job);

      // Check if we should retry
      if (job.attempts < this.config.maxRetries) {
        // Calculate exponential backoff
        const retryDelay = this.config.retryDelay * Math.pow(2, job.attempts - 1); // @claude is this where we're setting maxretries? however we end up implementing max attempts, let's create a test to make sure it's hooked up properly.
        
        this.deps.ingestionJobModel.markAsRetryable(job.id, errorMessage, failedStage, retryDelay);
        this.emitter.emit('job:retry', job, error);
        
        this.logInfo(`Job ${job.id} will be retried after ${retryDelay}ms`);
      } else {
        // Max retries reached, mark as failed
        this.deps.ingestionJobModel.markAsFailed(job.id, errorMessage, failedStage);
        this.emitter.emit('worker:failed', job, error);
        
        this.logError(`Job ${job.id} permanently failed after ${job.attempts} attempts`);
      }
    }
  }

  /**
   * Determine which stage failed based on job status
   */
  private getFailedStage(job: IngestionJob): string {
    // This is a simple implementation - in practice, the processor would update the job status as it progresses through stages.
    // @claude is it implemented at all in terms of functional code? this would need to be aligned with the stage names. priority:p3
    // @claude how does or should this relate to const PROGRESS_STAGES? I see we have an alias for that in UrlIngestionWorker.
    switch (job.status) {
      case 'processing_source':
        return 'processing_source';
      case 'parsing_content':
        return 'parsing_content';
      case 'ai_processing':
        return 'ai_processing';
      case 'persisting_data':
        return 'persisting_data';
      case 'vectorizing':
        return 'vectorizing';
      default:
        return 'unknown';
    }
  }


  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.deps.ingestionJobModel.getById(jobId);
    if (!job) {
      return false;
    }

    // If job is active, we can't cancel it mid-flight
    // @claude how do we define active? how (if at all) does the definition of active relate to the ability of a job to be cancelled? priority:p2
    if (this.activeJobs.has(jobId)) {
      this.logWarn(`Cannot cancel active job ${jobId}`);
      return false;
    }

    // Update job status to cancelled
    const success = this.deps.ingestionJobModel.update(jobId, { 
      status: 'cancelled',
      completedAt: Date.now()
    });

    if (success) {
      this.emitter.emit('job:cancelled', job);
    }

    return success;
  }

  /**
   * Retry a failed job immediately
   */
  async retryJob(jobId: string): Promise<boolean> {
    const job = this.deps.ingestionJobModel.getById(jobId);
    if (!job || (job.status !== 'failed' && job.status !== 'retry_pending')) {
      return false;
    }

    // Reset the job for immediate retry
    const success = this.deps.ingestionJobModel.update(jobId, {
      status: 'queued',
      nextAttemptAt: Date.now(),
      errorInfo: undefined,
      failedStage: undefined
    });

    // No longer auto-polling - SchedulerService will handle scheduling

    return success;
  }

  /**
   * Clean up old completed/failed jobs
   */
  async cleanupOldJobs(daysToKeep: number = 30): Promise<number> {
    return this.deps.ingestionJobModel.cleanupOldJobs(daysToKeep);
  }

  /**
   * Create a LOM ingestion job from an existing WOM object.
   * This is used when bookmarking a page that's already in Working Memory.
   * 
   * TRIGGERING MECHANISMS:
   * 1. User-initiated: Called when user explicitly bookmarks a WOM page (via bookmarkHandlers.ts)
   * 2. TODO: Automatic transition - A background job could periodically check for WOM objects
   *    that meet transition criteria (e.g., accessed frequently, marked as important, etc.)
   *    Implementation would require:
   *    - SchedulerService job to run every N hours
   *    - Query WOM objects by age/access patterns
   *    - Batch transition eligible objects
   *    - Respect rate limits and system resources
   * 
   * @param objectId - The ID of the object to transition from WOM to LOM
   * @returns The created ingestion job, or null if already in LOM
   */
  async createLomJobFromWomObject(objectId: string): Promise<IngestionJob | null> {
    return this.execute('createLomJobFromWomObject', async () => {
      const object = await this.deps.objectModel.getById(objectId);
      if (!object) {
        throw new NotFoundError('Object', objectId);
      }

      // Check if already has LOM vectors by searching for any LOM layer vectors with this objectId
      const lomVectors = await this.deps.vectorModel.querySimilarByText('', {
        k: 1,
        filter: {
          objectId,
          layer: 'lom'
        }
      });

      if (lomVectors.length > 0) {
        this.logInfo(`[WOM→LOM] Object ${objectId} already in LOM`);
        return null;
      }

      // Queue full LOM ingestion with chunking
      return this.addJob('url', object.source_uri, {
        originalFileName: object.title,
        jobSpecificData: {
          objectId, // Reuse existing object
          objectType: object.object_type,
          title: object.title,
          fromWom: true
        }
      });
    });
  }

  /**
   * Cleanup method for graceful shutdown.
   * Waits for all active jobs to complete.
   */
  async cleanup(): Promise<void> {
    this.logInfo('Cleanup requested, waiting for active jobs to complete...');
    
    if (this.activeJobs.size > 0) {
      this.logInfo(`Waiting for ${this.activeJobs.size} active jobs to complete`);
      
      // Wait for all active jobs with timeout
      const timeout = 30000; // 30 seconds
      const startTime = Date.now();
      
      while (this.activeJobs.size > 0) {
        if (Date.now() - startTime > timeout) {
          this.logWarn(`Cleanup timeout: ${this.activeJobs.size} jobs still active`);
          break;
        }
        
        await Promise.race([
          Promise.all(this.activeJobs.values()),
          new Promise(resolve => setTimeout(resolve, 1000))
        ]);
      }
    }
    
    this.logInfo('IngestionQueueService cleanup completed');
  }

  /**
   * Health check for the service.
   * Checks for stuck jobs and database connectivity.
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check database connectivity
      const stats = await this.getStats();
      
      // Check for jobs stuck in processing state for too long
      const processingStatuses: JobStatus[] = ['processing_source', 'parsing_content', 'ai_processing', 'persisting_data'];
      const processingJobs: IngestionJob[] = [];
      
      // getByStatus only accepts a single status, so we need to call it multiple times
      for (const status of processingStatuses) {
        const jobs = await this.deps.ingestionJobModel.getByStatus(status);
        processingJobs.push(...jobs);
      }
      const stuckThreshold = 300000; // 5 minutes
      const now = Date.now();
      
      const stuckJobs = processingJobs.filter(job => {
        const processingTime = now - (job.lastAttemptAt || job.createdAt);
        return processingTime > stuckThreshold;
      });
      
      if (stuckJobs.length > 0) {
        this.logWarn(`Health check warning: ${stuckJobs.length} jobs appear to be stuck`);
        return false;
      }
      
      return true;
    } catch (error) {
      this.logError('Health check failed:', error);
      return false;
    }
  }

  // EventEmitter proxy methods for backward compatibility
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  once(event: string | symbol, listener: (...args: any[]) => void): this {
    this.emitter.once(event, listener);
    return this;
  }

  off(event: string | symbol, listener: (...args: any[]) => void): this {
    this.emitter.off(event, listener);
    return this;
  }

  removeAllListeners(event?: string | symbol): this {
    this.emitter.removeAllListeners(event);
    return this;
  }
}