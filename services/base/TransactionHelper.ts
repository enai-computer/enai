import { Database } from 'better-sqlite3';
import { logger } from '../../utils/logger';

/**
 * Result of a transactional operation with external service
 */
export interface TransactionResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  rollbackPerformed?: boolean;
}

/**
 * Configuration for external service operations
 */
export interface ExternalServiceConfig {
  name: string;
  retryable?: boolean;
  maxRetries?: number;
  cleanup?: (data: any) => Promise<void>;
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
  static async executeWithExternal<TSql, TExternal, TFinal>(
    db: Database,
    sqlOperations: () => TSql,
    externalOperation: (sqlResult: TSql) => Promise<TExternal>,
    finalizeOperation: (sqlResult: TSql, externalResult: TExternal) => TFinal,
    config: ExternalServiceConfig
  ): Promise<TransactionResult<TFinal>> {
    let sqlResult: TSql | undefined;
    let externalResult: TExternal | undefined;
    let finalResult: TFinal | undefined;

    try {
      // Step 1: Execute SQL operations in transaction
      try {
        sqlResult = db.transaction(() => sqlOperations())();
      } catch (error) {
        logger.error(`[TransactionHelper] SQL transaction failed for ${config.name}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }

      // Step 2: Execute external operation with retry logic
      const maxRetries = config.retryable ? (config.maxRetries || 3) : 0;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            logger.debug(`[TransactionHelper] Retrying ${config.name} (attempt ${attempt + 1}/${maxRetries + 1})`);
            // Simple exponential backoff
            await new Promise(resolve => setTimeout(resolve, Math.min(Math.pow(2, attempt) * 1000, 10000)));
          }

          externalResult = await externalOperation(sqlResult);
          break; // Success, exit retry loop

        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt === maxRetries) {
            logger.error(`[TransactionHelper] External operation failed after ${maxRetries + 1} attempts:`, lastError);
            
            // Attempt cleanup if provided
            if (config.cleanup && sqlResult) {
              try {
                await config.cleanup(sqlResult);
                logger.info(`[TransactionHelper] Cleanup completed for ${config.name}`);
              } catch (cleanupError) {
                logger.error(`[TransactionHelper] Cleanup failed for ${config.name}:`, cleanupError);
              }
            }

            return {
              success: false,
              error: lastError,
              rollbackPerformed: !!config.cleanup,
            };
          }
        }
      }

      // Step 3: Finalize with SQL operations
      try {
        finalResult = db.transaction(() => 
          finalizeOperation(sqlResult!, externalResult!)
        )();
      } catch (error) {
        logger.error(`[TransactionHelper] Finalization failed for ${config.name}:`, error);
        
        // Attempt to clean up external resources
        if (config.cleanup && externalResult) {
          try {
            await config.cleanup(externalResult);
            logger.info(`[TransactionHelper] External cleanup completed after finalization failure`);
          } catch (cleanupError) {
            logger.error(`[TransactionHelper] External cleanup failed:`, cleanupError);
          }
        }

        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          rollbackPerformed: !!config.cleanup,
        };
      }

      return {
        success: true,
        data: finalResult,
      };

    } catch (error) {
      // Catch-all for unexpected errors
      logger.error(`[TransactionHelper] Unexpected error in ${config.name}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
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
}