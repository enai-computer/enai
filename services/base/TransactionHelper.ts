import { Database } from 'better-sqlite3';
import { logger } from '../../utils/logger';
import { performanceTracker } from '../../utils/performanceTracker';

/**
 * Result of a transactional operation with external service
 */
export interface TransactionResult<TData> {
  success: boolean;
  data?: TData;
  error?: Error;
  rollbackPerformed?: boolean;
  retryCount?: number;
  duration?: number;
}

/**
 * Configuration for external service operations
 */
export interface ExternalServiceConfig<TSqlResult, TExternalResult> {
  name: string;
  serviceName?: string; // For better logging context
  retryable?: boolean;
  maxRetries?: number;
  cleanup?: (data: TSqlResult | TExternalResult) => Promise<void>;
  circuitBreaker?: CircuitBreakerConfig;
  maxConcurrent?: number;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  resetTimeout: number; // Time in ms before attempting to close
  halfOpenMaxAttempts: number; // Max attempts in half-open state
}

/**
 * Circuit breaker states
 */
enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker for external services
 */
class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenAttempts: number = 0;
  
  constructor(private config: CircuitBreakerConfig) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime < this.config.resetTimeout) {
        throw new Error('Circuit breaker is OPEN - service unavailable');
      }
      // Try to transition to half-open
      this.state = CircuitState.HALF_OPEN;
      this.halfOpenAttempts = 0;
    }
    
    if (this.state === CircuitState.HALF_OPEN && 
        this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
      this.state = CircuitState.OPEN;
      throw new Error('Circuit breaker is OPEN - half-open attempts exhausted');
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
    this.halfOpenAttempts = 0;
  }
  
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts++;
    }
    
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }
  
  getState(): CircuitState {
    return this.state;
  }
}

/**
 * Manages concurrent operations limit
 */
class ConcurrencyLimiter {
  private activeOperations: number = 0;
  private queue: Array<() => void> = [];
  
  constructor(private maxConcurrent: number) {}
  
  async acquire(): Promise<void> {
    if (this.activeOperations < this.maxConcurrent) {
      this.activeOperations++;
      return;
    }
    
    // Wait in queue
    await new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }
  
  release(): void {
    this.activeOperations--;
    const next = this.queue.shift();
    if (next) {
      this.activeOperations++;
      next();
    }
  }
}

/**
 * Simplified transaction helper for SQLite + external service operations.
 * Handles the common pattern of:
 * 1. Perform SQLite operations in a transaction
 * 2. Call external service (e.g., ChromaDB)
 * 3. Update SQLite with external service results
 * 4. Handle failures gracefully
 */
export class TransactionHelper {
  private static circuitBreakers = new Map<string, CircuitBreaker>();
  private static concurrencyLimiters = new Map<string, ConcurrencyLimiter>();
  
  /**
   * Execute operations with SQLite transaction and external service coordination.
   * 
   * @param db Database connection
   * @param sqlOperations Function containing SQLite operations (runs in transaction)
   * @param externalOperation External service operation (e.g., ChromaDB call)
   * @param finalizeOperation Final SQLite operations after external service success
   * @param config Configuration for the external service
   * @returns Transaction result with success status and data
   */
  static async executeWithExternal<TSqlResult, TExternalResult, TFinalResult>(
    db: Database,
    sqlOperations: () => TSqlResult,
    externalOperation: (sqlResult: TSqlResult) => Promise<TExternalResult>,
    finalizeOperation: (sqlResult: TSqlResult, externalResult: TExternalResult) => TFinalResult,
    config: ExternalServiceConfig<TSqlResult, TExternalResult>
  ): Promise<TransactionResult<TFinalResult>> {
    const startTime = Date.now();
    const logContext = config.serviceName || 'TransactionHelper';
    let sqlResult: TSqlResult | undefined;
    let externalResult: TExternalResult | undefined;
    let finalResult: TFinalResult | undefined;
    let retryCount = 0;

    // Get or create circuit breaker
    const circuitBreaker = config.circuitBreaker 
      ? this.getOrCreateCircuitBreaker(config.name, config.circuitBreaker)
      : null;
    
    // Get or create concurrency limiter
    const limiter = config.maxConcurrent
      ? this.getOrCreateConcurrencyLimiter(config.name, config.maxConcurrent)
      : null;

    try {
      // Step 1: Execute SQL operations in transaction
      const sqlStartTime = Date.now();
      try {
        sqlResult = db.transaction(() => sqlOperations())();
        performanceTracker.trackOperation(
          `${config.name}_sql`,
          Date.now() - sqlStartTime
        );
      } catch (error) {
        logger.error(`[${logContext}] SQL transaction failed for ${config.name}:`, error);
        performanceTracker.incrementCounter(`${config.name}_sql_failures`);
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          duration: Date.now() - startTime,
        };
      }

      // Step 2: Execute external operation with retry logic and circuit breaker
      const maxRetries = config.retryable ? (config.maxRetries || 3) : 0;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            logger.debug(`[${logContext}] Retrying ${config.name} (attempt ${attempt + 1}/${maxRetries + 1})`);
            // Simple exponential backoff with jitter
            const backoff = Math.min(Math.pow(2, attempt) * 1000, 10000);
            const jitter = Math.random() * 0.3 * backoff;
            await new Promise(resolve => setTimeout(resolve, backoff + jitter));
          }

          // Acquire concurrency limit if configured
          if (limiter) {
            await limiter.acquire();
          }

          try {
            const externalStartTime = Date.now();
            
            // Execute with circuit breaker if configured
            if (circuitBreaker) {
              externalResult = await circuitBreaker.execute(() => 
                externalOperation(sqlResult)
              );
            } else {
              externalResult = await externalOperation(sqlResult);
            }
            
            performanceTracker.trackOperation(
              `${config.name}_external`,
              Date.now() - externalStartTime
            );
            performanceTracker.incrementCounter(`${config.name}_external_success`);
            retryCount = attempt;
            break; // Success, exit retry loop
          } finally {
            // Always release concurrency limit
            if (limiter) {
              limiter.release();
            }
          }

        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          performanceTracker.incrementCounter(`${config.name}_external_failures`);
          
          if (attempt === maxRetries) {
            logger.error(`[${logContext}] External operation failed after ${maxRetries + 1} attempts:`, lastError);
            
            // Attempt cleanup if provided
            if (config.cleanup && sqlResult) {
              try {
                await config.cleanup(sqlResult);
                logger.info(`[${logContext}] Cleanup completed for ${config.name}`);
              } catch (cleanupError) {
                logger.error(`[${logContext}] Cleanup failed for ${config.name}:`, cleanupError);
              }
            }

            return {
              success: false,
              error: lastError,
              rollbackPerformed: !!config.cleanup,
              retryCount: attempt,
              duration: Date.now() - startTime,
            };
          }
        }
      }

      // Step 3: Finalize with SQL operations
      const finalizeStartTime = Date.now();
      try {
        finalResult = db.transaction(() => 
          finalizeOperation(sqlResult!, externalResult!)
        )();
        performanceTracker.trackOperation(
          `${config.name}_finalize`,
          Date.now() - finalizeStartTime
        );
      } catch (error) {
        logger.error(`[${logContext}] Finalization failed for ${config.name}:`, error);
        performanceTracker.incrementCounter(`${config.name}_finalize_failures`);
        
        // Attempt to clean up external resources
        if (config.cleanup && externalResult) {
          try {
            await config.cleanup(externalResult);
            logger.info(`[${logContext}] External cleanup completed after finalization failure`);
          } catch (cleanupError) {
            logger.error(`[${logContext}] External cleanup failed:`, cleanupError);
          }
        }

        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          rollbackPerformed: !!config.cleanup,
          retryCount,
          duration: Date.now() - startTime,
        };
      }

      performanceTracker.incrementCounter(`${config.name}_success`);
      return {
        success: true,
        data: finalResult,
        retryCount,
        duration: Date.now() - startTime,
      };

    } catch (error) {
      // Catch-all for unexpected errors
      logger.error(`[${logContext}] Unexpected error in ${config.name}:`, error);
      performanceTracker.incrementCounter(`${config.name}_unexpected_errors`);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Simple SQLite-only transaction wrapper for operations that don't involve external services.
   * This is just a convenience wrapper around better-sqlite3's transaction API.
   */
  static transaction<T>(db: Database, operations: () => T): T {
    return db.transaction(operations)();
  }
  
  /**
   * Get or create a circuit breaker for a service
   */
  private static getOrCreateCircuitBreaker(
    serviceName: string,
    config: CircuitBreakerConfig
  ): CircuitBreaker {
    if (!this.circuitBreakers.has(serviceName)) {
      this.circuitBreakers.set(serviceName, new CircuitBreaker(config));
    }
    return this.circuitBreakers.get(serviceName)!;
  }
  
  /**
   * Get or create a concurrency limiter for a service
   */
  private static getOrCreateConcurrencyLimiter(
    serviceName: string,
    maxConcurrent: number
  ): ConcurrencyLimiter {
    if (!this.concurrencyLimiters.has(serviceName)) {
      this.concurrencyLimiters.set(serviceName, new ConcurrencyLimiter(maxConcurrent));
    }
    return this.concurrencyLimiters.get(serviceName)!;
  }
  
  /**
   * Get circuit breaker state for monitoring
   */
  static getCircuitBreakerState(serviceName: string): CircuitState | null {
    const breaker = this.circuitBreakers.get(serviceName);
    return breaker ? breaker.getState() : null;
  }
  
  /**
   * Reset circuit breaker (for testing or manual intervention)
   */
  static resetCircuitBreaker(serviceName: string): void {
    this.circuitBreakers.delete(serviceName);
  }
}