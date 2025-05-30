"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IngestionQueueService = void 0;
const events_1 = require("events");
const logger_1 = require("../utils/logger");
class IngestionQueueService extends events_1.EventEmitter {
    constructor(model, config) {
        super();
        this.isRunning = false;
        this.activeJobs = new Map();
        this.model = model;
        this.config = {
            concurrency: config?.concurrency || 4,
            pollInterval: config?.pollInterval || 5000,
            maxRetries: config?.maxRetries || 3,
            retryDelay: config?.retryDelay || 60000,
        };
        this.processors = new Map();
        logger_1.logger.info('[IngestionQueueService] Initialized with config:', this.config);
    }
    /**
     * Register a processor for a specific job type
     */
    registerProcessor(jobType, processor) {
        this.processors.set(jobType, processor);
        logger_1.logger.info(`[IngestionQueueService] Registered processor for job type: ${jobType}`);
    }
    /**
     * Start the queue processing
     */
    start() {
        if (this.isRunning) {
            logger_1.logger.warn('[IngestionQueueService] Queue is already running');
            return;
        }
        this.isRunning = true;
        logger_1.logger.info('[IngestionQueueService] Starting queue processing');
        // Start the polling loop
        this.poll();
    }
    /**
     * Stop the queue processing
     */
    async stop() {
        logger_1.logger.info('[IngestionQueueService] Stopping queue processing');
        this.isRunning = false;
        // Clear the poll timer
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
        }
        // Wait for active jobs to complete
        if (this.activeJobs.size > 0) {
            logger_1.logger.info(`[IngestionQueueService] Waiting for ${this.activeJobs.size} active jobs to complete`);
            await Promise.all(this.activeJobs.values());
        }
        logger_1.logger.info('[IngestionQueueService] Queue stopped');
    }
    /**
     * Add a job to the queue
     */
    async addJob(jobType, sourceIdentifier, options) {
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
    getStats() {
        return this.model.getStats();
    }
    /**
     * Get active job count
     */
    getActiveJobCount() {
        return this.activeJobs.size;
    }
    /**
     * Poll for new jobs and process them
     */
    async poll() {
        if (!this.isRunning) {
            return;
        }
        try {
            // Check if we have capacity for more jobs
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
                logger_1.logger.debug(`[IngestionQueueService] Found ${jobs.length} jobs to process`);
                // Process each job
                for (const job of jobs) {
                    if (this.activeJobs.size >= this.config.concurrency) {
                        break; // Reached concurrency limit
                    }
                    const processor = this.processors.get(job.jobType);
                    if (!processor) {
                        logger_1.logger.error(`[IngestionQueueService] No processor registered for job type: ${job.jobType}`);
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
        }
        catch (error) {
            logger_1.logger.error('[IngestionQueueService] Error during poll:', error);
        }
        // Schedule next poll
        this.scheduleNextPoll();
    }
    /**
     * Schedule the next poll
     */
    scheduleNextPoll() {
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
    async processJob(job, processor) {
        logger_1.logger.info(`[IngestionQueueService] Processing job ${job.id} (${job.jobType})`);
        try {
            // Mark job as started
            this.model.markAsStarted(job.id);
            this.emit('job:started', job);
            // Process the job
            await processor(job);
            // Mark job as completed
            this.model.markAsCompleted(job.id);
            this.emit('job:completed', job);
            logger_1.logger.info(`[IngestionQueueService] Job ${job.id} completed successfully`);
        }
        catch (error) {
            logger_1.logger.error(`[IngestionQueueService] Job ${job.id} failed:`, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            const failedStage = this.getFailedStage(job);
            // Check if we should retry
            if (job.attempts < this.config.maxRetries) {
                // Calculate exponential backoff
                const retryDelay = this.config.retryDelay * Math.pow(2, job.attempts - 1);
                this.model.markAsRetryable(job.id, errorMessage, failedStage, retryDelay);
                this.emit('job:retry', job, error);
                logger_1.logger.info(`[IngestionQueueService] Job ${job.id} will be retried after ${retryDelay}ms`);
            }
            else {
                // Max retries reached, mark as failed
                this.model.markAsFailed(job.id, errorMessage, failedStage);
                this.emit('job:failed', job, error);
                logger_1.logger.error(`[IngestionQueueService] Job ${job.id} permanently failed after ${job.attempts} attempts`);
            }
        }
    }
    /**
     * Determine which stage failed based on job status
     */
    getFailedStage(job) {
        // This is a simple implementation - in practice, the processor
        // would update the job status as it progresses through stages
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
    async cancelJob(jobId) {
        const job = this.model.getById(jobId);
        if (!job) {
            return false;
        }
        // If job is active, we can't cancel it mid-flight
        // (this could be enhanced with cancellation tokens in the future)
        if (this.activeJobs.has(jobId)) {
            logger_1.logger.warn(`[IngestionQueueService] Cannot cancel active job ${jobId}`);
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
    async retryJob(jobId) {
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
    async cleanupOldJobs(daysToKeep = 30) {
        return this.model.cleanupOldJobs(daysToKeep);
    }
}
exports.IngestionQueueService = IngestionQueueService;
//# sourceMappingURL=IngestionQueueService.js.map