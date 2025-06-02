"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseIngestionWorker = void 0;
const logger_1 = require("../../utils/logger");
const types_1 = require("./types");
const constants_1 = require("./constants");
class BaseIngestionWorker {
    constructor(ingestionJobModel, workerName) {
        this.ingestionJobModel = ingestionJobModel;
        this.workerName = workerName;
    }
    /**
     * Update job progress with validation
     */
    async updateProgress(jobId, stage, percent, message) {
        try {
            const progress = {
                stage,
                percent: Math.min(100, Math.max(0, percent)),
                message: message || stage
            };
            await this.ingestionJobModel.update(jobId, { progress });
            logger_1.logger.debug(`[${this.workerName}] Progress updated for job ${jobId}:`, progress);
        }
        catch (error) {
            logger_1.logger.error(`[${this.workerName}] Failed to update progress for job ${jobId}:`, error);
            // Don't throw - progress update failures shouldn't fail the job
        }
    }
    /**
     * Format error information for storage
     */
    formatErrorInfo(error, context = {}) {
        try {
            const structuredError = {
                type: error.name || error.code || 'UnknownError',
                message: error.message || 'Processing failed',
                category: this.classifyError(error).category,
                context: {
                    ...context,
                    workerName: this.workerName,
                    ...(error.statusCode && { statusCode: error.statusCode }),
                    ...(error.code && { code: error.code })
                },
                timestamp: new Date().toISOString()
            };
            // Add stack trace for development
            if (process.env.NODE_ENV !== 'production' && error.stack) {
                structuredError.stack = error.stack.split('\n').slice(0, 5).join(' | ');
            }
            let errorString = JSON.stringify(structuredError);
            // Truncate if too long
            if (errorString.length > constants_1.MAX_ERROR_INFO_LENGTH) {
                structuredError.message = structuredError.message.substring(0, 200) + '...';
                if (structuredError.stack) {
                    structuredError.stack = structuredError.stack.substring(0, 200) + '...';
                }
                errorString = JSON.stringify(structuredError);
            }
            return errorString;
        }
        catch (formatError) {
            logger_1.logger.error(`[${this.workerName}] Error formatting error info:`, formatError);
            return JSON.stringify({
                type: 'ErrorFormattingFailed',
                message: error.toString().substring(0, 200),
                timestamp: new Date().toISOString()
            });
        }
    }
    /**
     * Classify error for retry logic
     */
    classifyError(error) {
        const errorString = (error.toString() + ' ' + (error.message || '')).toLowerCase();
        const errorCode = error.code?.toLowerCase() || '';
        const statusCode = error.statusCode?.toString() || '';
        // Check for permanent errors first
        for (const pattern of constants_1.PERMANENT_ERROR_PATTERNS) {
            if (errorString.includes(pattern.toLowerCase()) ||
                errorCode.includes(pattern.toLowerCase()) ||
                statusCode === pattern) {
                return {
                    isTransient: false,
                    category: this.getErrorCategory(error),
                    retryable: false
                };
            }
        }
        // Check for transient errors
        for (const pattern of constants_1.TRANSIENT_ERROR_PATTERNS) {
            if (errorString.includes(pattern.toLowerCase()) ||
                errorCode.includes(pattern.toLowerCase()) ||
                statusCode === pattern) {
                return {
                    isTransient: true,
                    category: this.getErrorCategory(error),
                    retryable: true,
                    retryDelay: this.calculateRetryDelay(error)
                };
            }
        }
        // Default classification based on error type
        const category = this.getErrorCategory(error);
        const isTransient = category === types_1.ErrorCategory.NETWORK ||
            category === types_1.ErrorCategory.STORAGE ||
            category === types_1.ErrorCategory.AI_PROCESSING;
        return {
            isTransient,
            category,
            retryable: isTransient,
            retryDelay: isTransient ? constants_1.DEFAULT_RETRY_DELAY : undefined
        };
    }
    /**
     * Determine error category
     */
    getErrorCategory(error) {
        const errorString = (error.toString() + ' ' + (error.message || '')).toLowerCase();
        if (errorString.includes('network') ||
            errorString.includes('econnrefused') ||
            errorString.includes('timeout') ||
            errorString.includes('fetch')) {
            return types_1.ErrorCategory.NETWORK;
        }
        if (errorString.includes('storage') ||
            errorString.includes('sqlite') ||
            errorString.includes('database') ||
            errorString.includes('disk')) {
            return types_1.ErrorCategory.STORAGE;
        }
        if (errorString.includes('parse') ||
            errorString.includes('invalid') ||
            errorString.includes('malformed')) {
            return types_1.ErrorCategory.PARSING;
        }
        if (errorString.includes('ai') ||
            errorString.includes('llm') ||
            errorString.includes('openai') ||
            errorString.includes('embedding')) {
            return types_1.ErrorCategory.AI_PROCESSING;
        }
        if (errorString.includes('permission') ||
            errorString.includes('access') ||
            errorString.includes('denied')) {
            return types_1.ErrorCategory.PERMISSION;
        }
        if (errorString.includes('memory') ||
            errorString.includes('resource') ||
            errorString.includes('limit')) {
            return types_1.ErrorCategory.RESOURCE;
        }
        return types_1.ErrorCategory.UNKNOWN;
    }
    /**
     * Calculate retry delay with exponential backoff
     */
    calculateRetryDelay(error) {
        // Check for rate limit headers
        if (error.headers?.['retry-after']) {
            const retryAfter = parseInt(error.headers['retry-after'], 10);
            if (!isNaN(retryAfter)) {
                return retryAfter * 1000; // Convert to milliseconds
            }
        }
        // Default exponential backoff
        return constants_1.DEFAULT_RETRY_DELAY;
    }
    /**
     * Handle job failure with retry logic
     */
    async handleJobFailure(job, error, context = {}) {
        const classification = this.classifyError(error);
        const errorInfo = this.formatErrorInfo(error, {
            ...context,
            classification
        });
        logger_1.logger.error(`[${this.workerName}] Job ${job.id} failed:`, {
            error: error.message,
            classification,
            attempts: job.attempts
        });
        if (classification.retryable && job.attempts < constants_1.MAX_RETRY_ATTEMPTS) {
            // Calculate exponential backoff
            const baseDelay = classification.retryDelay || constants_1.DEFAULT_RETRY_DELAY;
            const retryDelay = baseDelay * Math.pow(2, job.attempts - 1);
            await this.ingestionJobModel.markAsRetryable(job.id, errorInfo, job.status, retryDelay);
            logger_1.logger.info(`[${this.workerName}] Job ${job.id} marked for retry (attempt ${job.attempts + 1}/${constants_1.MAX_RETRY_ATTEMPTS}) with delay ${retryDelay}ms`);
        }
        else {
            // Permanent failure
            await this.ingestionJobModel.markAsFailed(job.id, errorInfo, job.status);
            logger_1.logger.error(`[${this.workerName}] Job ${job.id} permanently failed after ${job.attempts} attempts`);
        }
    }
    /**
     * Helper method to run code in a transaction
     */
    async runInTransaction(db, // Better-sqlite3 Database instance
    operation) {
        const transaction = db.transaction(operation);
        try {
            return transaction();
        }
        catch (error) {
            logger_1.logger.error(`[${this.workerName}] Transaction failed:`, error);
            throw error;
        }
    }
    /**
     * Transform propositions from AI-generated array format to ObjectPropositions format
     * Shared utility method for both PDF and URL ingestion
     */
    static transformPropositions(propositions) {
        if (!propositions) {
            return { main: [], supporting: [], actions: [] };
        }
        return {
            main: propositions.filter(p => p.type === 'main').map(p => p.content),
            supporting: propositions.filter(p => p.type === 'supporting').map(p => p.content),
            actions: propositions.filter(p => p.type === 'action').map(p => p.content)
        };
    }
}
exports.BaseIngestionWorker = BaseIngestionWorker;
//# sourceMappingURL=BaseIngestionWorker.js.map