import { EventEmitter } from 'events';
import { IngestionJobModel, IngestionJob } from '../../models/IngestionJobModel';
import { JobType, JobStatus } from '../../shared/types';
import { logger } from '../../utils/logger';
import { IIngestionWorker } from './types';

export interface QueueConfig {
  concurrency?: number;
  pollInterval?: number; // milliseconds
  maxRetries?: number;
  retryDelay?: number; // milliseconds
}

export interface JobProcessor {
  (job: IngestionJob): Promise<void>;
}

export class IngestionQueueService extends EventEmitter {
  private model: IngestionJobModel;
  private config: Required<QueueConfig>;
  private processors: Map<JobType, JobProcessor>;
  public isRunning: boolean = false;
  private activeJobs: Map<string, Promise<void>> = new Map();
  private pollTimer?: NodeJS.Timeout;

  constructor(model: IngestionJobModel, config?: QueueConfig) {
    super();
    this.model = model;
    this.config = {
      concurrency: config?.concurrency || 12, // Increased for Tier 2 limits (5000 RPM). This applies to both URLs and PDFs
      pollInterval: config?.pollInterval || 5000,
      maxRetries: config?.maxRetries || 3, // @claude please validate how we're managing retries - does this map to attempts in IngestionJobModel's IngestionJobRow interface?
      retryDelay: config?.retryDelay || 70000,
    };
    this.processors = new Map();
    
    logger.info('[IngestionQueueService] Initialized with config:', this.config);
  }

  /**
   * Register a processor for a specific job type >> 
   */
  // @claude does this map to job_type in IngestionJobRow interface? Please evaluate and explain the naming convention here - is it intentional? 
  registerProcessor(jobType: JobType, processor: JobProcessor): void {
    this.processors.set(jobType, processor);
    logger.info(`[IngestionQueueService] Registered processor for job type: ${jobType}`);
  }

  /**
   * Start the queue processing
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('[IngestionQueueService] Queue is already running');
      return;
    }

    this.isRunning = true;
    logger.info('[IngestionQueueService] Starting queue processing');
    
    // Start the polling loop
    this.poll();
  }

  /**
   * Stop the queue processing
   */
  async stop(): Promise<void> {
    logger.info('[IngestionQueueService] Stopping queue processing');
    this.isRunning = false;

    // Clear the poll timer
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }

    // Wait for active jobs to complete
    if (this.activeJobs.size > 0) {
      logger.info(`[IngestionQueueService] Waiting for ${this.activeJobs.size} active jobs to complete`);
      await Promise.all(this.activeJobs.values());
    }

    logger.info('[IngestionQueueService] Queue stopped');
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
    const job = this.model.create({
      jobType,
      sourceIdentifier,
      originalFileName: options?.originalFileName,
      priority: options?.priority,
      jobSpecificData: options?.jobSpecificData,
    });

    this.emit('job:created', job);
    
    // If queue is running, trigger an immediate poll
    if (this.isRunning) {
      setImmediate(() => this.poll());
    }

    return job;
  }

  /**
   * Get queue statistics
   */
  getStats(): Record<JobStatus, number> {
    return this.model.getStats();
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
    if (!this.isRunning) {
      return;
    }

    try {
      // Check if we have capacity for more jobs >> @claude where is the maximum number of jobs defined and how does that map to availableSlots? What factors constrain the maximum number of jobs? Eg. memory, gpu...?
      const availableSlots = this.config.concurrency - this.activeJobs.size;
      if (availableSlots <= 0) {
        // Schedule next poll and return
        this.scheduleNextPoll();
        return;
      }

      // Get next jobs to process
      const jobTypes = Array.from(this.processors.keys());
      const jobs = this.model.getNextJobs(availableSlots, jobTypes);

      if (jobs.length > 0) {
        logger.debug(`[IngestionQueueService] Found ${jobs.length} jobs to process`);
        
        // Process each job
        for (const job of jobs) {
          if (this.activeJobs.size >= this.config.concurrency) {
            break; // Reached concurrency limit
          }

          const processor = this.processors.get(job.jobType);
          if (!processor) {
            logger.error(`[IngestionQueueService] No processor registered for job type: ${job.jobType}`);
            this.model.markAsFailed(job.id, 'No processor registered for job type', 'processing_source');
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
      logger.error('[IngestionQueueService] Error during poll:', error);
    }

    // Schedule next poll
    this.scheduleNextPoll();
  }

  /**
   * Schedule the next poll
   */
  private scheduleNextPoll(): void {
    if (this.isRunning && !this.pollTimer) {
      this.pollTimer = setTimeout(() => {
        this.pollTimer = undefined;
        this.poll();
      }, this.config.pollInterval);
    }
  }

  /**
   * Process a single job
   */
  private async processJob(job: IngestionJob, processor: JobProcessor): Promise<void> {
    logger.info(`[IngestionQueueService] Processing job ${job.id} (${job.jobType})`);
    
    try {
      // Mark job as started
      this.model.markAsStarted(job.id);
      this.emit('job:started', job);

      // Process the job
      await processor(job);

      // Don't mark as completed - let jobs manage their own lifecycle
      // Multi-stage jobs (URL, PDF) will transition to 'vectorizing' 
      // and ChunkingService will mark them as 'completed'
      // this.model.markAsCompleted(job.id);
      
      // This event fires when the worker completes processing, not when the entire job is done
      // For multi-stage jobs (URL, PDF), ChunkingService will handle final completion
      this.emit('worker:completed', job);
      
      logger.info(`[IngestionQueueService] Job ${job.id} processed successfully`);
    } catch (error) {
      logger.error(`[IngestionQueueService] Job ${job.id} failed:`, error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedStage = this.getFailedStage(job);

      // Check if we should retry
      if (job.attempts < this.config.maxRetries) {
        // Calculate exponential backoff
        const retryDelay = this.config.retryDelay * Math.pow(2, job.attempts - 1); // @claude is this where we're setting maxretries? however we end up implementing max attempts, let's create a test to make sure it's hooked up properly.
        
        this.model.markAsRetryable(job.id, errorMessage, failedStage, retryDelay);
        this.emit('job:retry', job, error);
        
        logger.info(`[IngestionQueueService] Job ${job.id} will be retried after ${retryDelay}ms`);
      } else {
        // Max retries reached, mark as failed
        this.model.markAsFailed(job.id, errorMessage, failedStage);
        this.emit('worker:failed', job, error);
        
        logger.error(`[IngestionQueueService] Job ${job.id} permanently failed after ${job.attempts} attempts`);
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
    const job = this.model.getById(jobId);
    if (!job) {
      return false;
    }

    // If job is active, we can't cancel it mid-flight
    // @claude how do we define active? how (if at all) does the definition of active relate to the ability of a job to be cancelled? priority:p2
    if (this.activeJobs.has(jobId)) {
      logger.warn(`[IngestionQueueService] Cannot cancel active job ${jobId}`);
      return false;
    }

    // Update job status to cancelled
    const success = this.model.update(jobId, { 
      status: 'cancelled',
      completedAt: Date.now()
    });

    if (success) {
      this.emit('job:cancelled', job);
    }

    return success;
  }

  /**
   * Retry a failed job immediately
   */
  async retryJob(jobId: string): Promise<boolean> {
    const job = this.model.getById(jobId);
    if (!job || (job.status !== 'failed' && job.status !== 'retry_pending')) {
      return false;
    }

    // Reset the job for immediate retry
    const success = this.model.update(jobId, {
      status: 'queued',
      nextAttemptAt: Date.now(),
      errorInfo: undefined,
      failedStage: undefined
    });

    if (success && this.isRunning) {
      // Trigger immediate poll
      setImmediate(() => this.poll());
    }

    return success;
  }

  /**
   * Clean up old completed/failed jobs
   */
  async cleanupOldJobs(daysToKeep: number = 30): Promise<number> {
    return this.model.cleanupOldJobs(daysToKeep);
  }
}