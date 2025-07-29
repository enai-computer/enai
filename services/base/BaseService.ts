import { logger } from '../../utils/logger';
import { performanceTracker } from '../../utils/performanceTracker';
import type Database from 'better-sqlite3';

/**
 * Abstract base class for all services in the Jeffers application.
 * Provides common functionality like logging, error handling, and lifecycle management.
 */
export abstract class BaseService<TDeps = {}> {
  protected readonly logger = logger;
  protected readonly serviceName: string;
  protected readonly deps: TDeps;

  constructor(serviceName: string, deps: TDeps) {
    this.serviceName = serviceName;
    this.deps = deps;
  }

  /**
   * Initialize the service. Override this method to perform any async initialization.
   * Called during application bootstrap.
   */
  async initialize(): Promise<void> {
    // Override in subclasses if needed
  }

  /**
   * Cleanup resources used by the service. Override this method to perform cleanup.
   * Called during application shutdown.
   */
  async cleanup(): Promise<void> {
    // Override in subclasses if needed
  }

  /**
   * Health check for the service. Override to implement custom health checks.
   * @returns true if the service is healthy, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    // Override in subclasses to implement actual health checks
    return true;
  }

  /**
   * Execute an async operation with automatic logging and error handling.
   * @param operation The operation name for logging
   * @param fn The async function to execute
   * @param context Optional context object for logging
   * @param options Optional execution options
   */
  protected async execute<T>(
    operation: string,
    fn: () => Promise<T>,
    context?: Record<string, any>,
    options?: { trackPerformance?: boolean; correlationId?: string }
  ): Promise<T> {
    const startTime = Date.now();
    const logContext = context ? `, context: ${JSON.stringify(context)}` : '';
    
    this.logger.debug(`[${this.serviceName}] ${operation} started${logContext}`);
    
    // Optional performance tracking
    if (options?.trackPerformance && options.correlationId) {
      performanceTracker.recordEvent(
        options.correlationId,
        this.serviceName,
        `${operation}_start`,
        context
      );
    }
    
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      
      this.logger.debug(`[${this.serviceName}] ${operation} completed in ${duration}ms`);
      
      // Record completion in performance tracker
      if (options?.trackPerformance && options.correlationId) {
        performanceTracker.recordEvent(
          options.correlationId,
          this.serviceName,
          `${operation}_complete`,
          { duration }
        );
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`[${this.serviceName}] ${operation} failed after ${duration}ms:`, error);
      
      // Record failure in performance tracker
      if (options?.trackPerformance && options.correlationId) {
        performanceTracker.recordEvent(
          options.correlationId,
          this.serviceName,
          `${operation}_error`,
          { duration, error: error instanceof Error ? error.message : 'Unknown error' }
        );
      }
      
      throw error;
    }
  }


  /**
   * Log an info message with service context
   */
  protected logInfo(message: string, ...args: any[]): void {
    this.logger.info(`[${this.serviceName}] ${message}`, ...args);
  }

  /**
   * Log a debug message with service context
   */
  protected logDebug(message: string, ...args: any[]): void {
    this.logger.debug(`[${this.serviceName}] ${message}`, ...args);
  }

  /**
   * Log a warning message with service context
   */
  protected logWarn(message: string, ...args: any[]): void {
    this.logger.warn(`[${this.serviceName}] ${message}`, ...args);
  }

  /**
   * Log an error message with service context
   */
  protected logError(message: string, error?: any, ...args: any[]): void {
    if (error) {
      this.logger.error(`[${this.serviceName}] ${message}`, error, ...args);
    } else {
      this.logger.error(`[${this.serviceName}] ${message}`, ...args);
    }
  }

  /**
   * Execute a function within a database transaction.
   * Note: The callback MUST be synchronous as better-sqlite3 doesn't support async transactions.
   * @param db The database instance
   * @param fn The synchronous function to execute within the transaction
   * @returns The result of the function
   */
  protected withTransaction<T>(
    db: Database.Database,
    fn: () => T
  ): T {
    const transaction = db.transaction(fn);
    
    try {
      const result = transaction();
      this.logDebug('Transaction completed successfully');
      return result;
    } catch (error) {
      this.logError('Transaction failed:', error);
      throw error;
    }
  }

  /**
   * Execute a function and create a compensating action if it fails.
   * This is useful for operations that involve external systems that can't be rolled back.
   * @param action The main action to execute
   * @param compensate The compensating action to run if the main action fails
   * @returns The result of the action
   */
  protected async withCompensation<T>(
    action: () => Promise<T>,
    compensate: () => Promise<void>
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      this.logWarn('Action failed, executing compensation...');
      try {
        await compensate();
        this.logDebug('Compensation completed successfully');
      } catch (compensationError) {
        this.logError('Compensation failed:', compensationError);
        // Re-throw original error with compensation failure noted
        if (error instanceof Error) {
          error.message = `${error.message} (compensation also failed: ${compensationError})`;
        }
      }
      throw error;
    }
  }
}