import { logger } from '../../utils/logger';
import { IngestionJob, IngestionJobModel } from '../../models/IngestionJobModel';
import { IIngestionWorker, ErrorClassification, ErrorCategory, StructuredError, WorkerProgressInfo } from './types';
import { 
  MAX_ERROR_INFO_LENGTH, 
  TRANSIENT_ERROR_PATTERNS, 
  PERMANENT_ERROR_PATTERNS,
  DEFAULT_RETRY_DELAY,
  MAX_RETRY_ATTEMPTS,
  INGESTION_STATUS
} from './constants';
import { ObjectPropositions } from '../../shared/types';

export abstract class BaseIngestionWorker implements IIngestionWorker {
  protected readonly workerName: string;
  
  constructor(
    protected ingestionJobModel: IngestionJobModel,
    workerName: string
  ) {
    this.workerName = workerName;
  }
  
  /**
   * Main execution method to be implemented by subclasses
   */
  abstract execute(job: IngestionJob): Promise<void>;
  
  /**
   * Update job progress with validation
   */
  protected async updateProgress(
    jobId: string, 
    stage: string, 
    percent: number, 
    message?: string
  ): Promise<void> {
    try {
      const progress: WorkerProgressInfo = {
        stage,
        percent: Math.min(100, Math.max(0, percent)),
        message: message || stage
      };
      
      await this.ingestionJobModel.update(jobId, { progress });
      logger.debug(`[${this.workerName}] Progress updated for job ${jobId}:`, progress);
    } catch (error) {
      logger.error(`[${this.workerName}] Failed to update progress for job ${jobId}:`, error);
      // Don't throw - progress update failures shouldn't fail the job
    }
  }
  
  /**
   * Format error information for storage
   */
  protected formatErrorInfo(error: any, context: Record<string, any> = {}): string {
    try {
      const structuredError: StructuredError = {
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
      if (errorString.length > MAX_ERROR_INFO_LENGTH) {
        structuredError.message = structuredError.message.substring(0, 200) + '...';
        if (structuredError.stack) {
          structuredError.stack = structuredError.stack.substring(0, 200) + '...';
        }
        errorString = JSON.stringify(structuredError);
      }
      
      return errorString;
    } catch (formatError) {
      logger.error(`[${this.workerName}] Error formatting error info:`, formatError);
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
  protected classifyError(error: any): ErrorClassification {
    const errorString = (error.toString() + ' ' + (error.message || '')).toLowerCase();
    const errorCode = error.code?.toLowerCase() || '';
    const statusCode = error.statusCode?.toString() || '';
    
    // Check for permanent errors first
    for (const pattern of PERMANENT_ERROR_PATTERNS) {
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
    for (const pattern of TRANSIENT_ERROR_PATTERNS) {
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
    const isTransient = category === ErrorCategory.NETWORK || 
                       category === ErrorCategory.STORAGE ||
                       category === ErrorCategory.AI_PROCESSING;
    
    return {
      isTransient,
      category,
      retryable: isTransient,
      retryDelay: isTransient ? DEFAULT_RETRY_DELAY : undefined
    };
  }
  
  /**
   * Determine error category
   */
  private getErrorCategory(error: any): ErrorCategory {
    const errorString = (error.toString() + ' ' + (error.message || '')).toLowerCase();
    
    if (errorString.includes('network') || 
        errorString.includes('econnrefused') ||
        errorString.includes('timeout') ||
        errorString.includes('fetch')) {
      return ErrorCategory.NETWORK;
    }
    
    if (errorString.includes('storage') || 
        errorString.includes('sqlite') ||
        errorString.includes('database') ||
        errorString.includes('disk')) {
      return ErrorCategory.STORAGE;
    }
    
    if (errorString.includes('parse') || 
        errorString.includes('invalid') ||
        errorString.includes('malformed')) {
      return ErrorCategory.PARSING;
    }
    
    if (errorString.includes('ai') || 
        errorString.includes('llm') ||
        errorString.includes('openai') ||
        errorString.includes('embedding')) {
      return ErrorCategory.AI_PROCESSING;
    }
    
    if (errorString.includes('permission') || 
        errorString.includes('access') ||
        errorString.includes('denied')) {
      return ErrorCategory.PERMISSION;
    }
    
    if (errorString.includes('memory') || 
        errorString.includes('resource') ||
        errorString.includes('limit')) {
      return ErrorCategory.RESOURCE;
    }
    
    return ErrorCategory.UNKNOWN;
  }
  
  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(error: any): number {
    // Check for rate limit headers
    if (error.headers?.['retry-after']) {
      const retryAfter = parseInt(error.headers['retry-after'], 10);
      if (!isNaN(retryAfter)) {
        return retryAfter * 1000; // Convert to milliseconds
      }
    }
    
    // Default exponential backoff
    return DEFAULT_RETRY_DELAY;
  }
  
  /**
   * Handle job failure with retry logic
   */
  protected async handleJobFailure(
    job: IngestionJob, 
    error: any, 
    context: Record<string, any> = {}
  ): Promise<void> {
    const classification = this.classifyError(error);
    const errorInfo = this.formatErrorInfo(error, {
      ...context,
      classification
    });
    
    logger.error(`[${this.workerName}] Job ${job.id} failed:`, {
      error: error.message,
      classification,
      attempts: job.attempts
    });
    
    if (classification.retryable && job.attempts < MAX_RETRY_ATTEMPTS) {
      // Calculate exponential backoff
      const baseDelay = classification.retryDelay || DEFAULT_RETRY_DELAY;
      const retryDelay = baseDelay * Math.pow(2, job.attempts - 1);
      
      await this.ingestionJobModel.markAsRetryable(
        job.id,
        errorInfo,
        job.status,
        retryDelay
      );
      
      logger.info(`[${this.workerName}] Job ${job.id} marked for retry (attempt ${job.attempts + 1}/${MAX_RETRY_ATTEMPTS}) with delay ${retryDelay}ms`);
    } else {
      // Permanent failure
      await this.ingestionJobModel.markAsFailed(
        job.id,
        errorInfo,
        job.status
      );
      
      logger.error(`[${this.workerName}] Job ${job.id} permanently failed after ${job.attempts} attempts`);
    }
  }
  
  /**
   * Helper method to run code in a transaction
   */
  protected async runInTransaction<T>(
    db: any, // Better-sqlite3 Database instance
    operation: () => T
  ): Promise<T> {
    const transaction = db.transaction(operation);
    try {
      return transaction();
    } catch (error) {
      logger.error(`[${this.workerName}] Transaction failed:`, error);
      throw error;
    }
  }

  /**
   * Transform propositions from AI-generated array format to ObjectPropositions format
   * Shared utility method for both PDF and URL ingestion
   */
  public static transformPropositions(
    propositions?: Array<{ type: 'main' | 'supporting' | 'action'; content: string }>
  ): ObjectPropositions {
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