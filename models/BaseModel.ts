import { Database } from 'better-sqlite3';
import { getDb } from './db';
import { logger } from '../utils/logger';

/**
 * Base class for all models, providing common database handling and error management
 */
export abstract class BaseModel {
  protected readonly db: Database;
  protected abstract readonly modelName: string;

  constructor(db?: Database) {
    this.db = db || getDb();
  }

  /**
   * Get the database instance (for transaction support)
   */
  getDatabase(): Database {
    return this.db;
  }

  /**
   * Handle database errors consistently across all models
   * @param error - The error that occurred
   * @param context - Description of the operation that failed
   * @throws Error with formatted message
   */
  protected handleDbError(error: any, context: string): never {
    const message = error?.message || 'Unknown database error';
    logger.error(`[${this.modelName}] DB error in ${context}: ${message}`, error);
    
    // Preserve specific error types when relevant
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw error; // Let caller handle unique constraint violations
    }
    
    throw new Error(`Database operation failed in ${context}: ${message}`);
  }
}