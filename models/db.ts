import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

// Singleton instance holder
let dbInstance: Database.Database | null = null;

/**
 * Returns the singleton database instance.
 * Throws an error if the database has not been initialized via initDb().
 * @returns The singleton Database instance.
 */
export function getDb(): Database.Database {
    if (!dbInstance) {
        // This should ideally not happen if initDb is called correctly at startup
        logger.error('[DB] getDb called before database was initialized.');
        throw new Error('Database accessed before initialization. Call initDb first.');
    }
    return dbInstance;
}

/**
 * Initializes the database connection.
 * Creates the database file and directory if they don't exist.
 * Enables WAL mode.
 * Sets the singleton instance accessed via getDb() *only if* no path is provided.
 * Does NOT run migrations - that should be handled separately.
 *
 * @param dbPath Optional path to the database file. If omitted, uses the path from getDbPath(). If ':memory:', creates an in-memory DB.
 * @returns The created Database instance.
 */
export function initDb(dbPath?: string): Database.Database {
    const targetPath = dbPath ?? getDbPath(); // Use provided path or default

    if (!dbPath && dbInstance) {
        // If using default path and already initialized, return singleton
        logger.warn('[DB] initDb called for default path but database already initialized. Returning existing instance.');
        return dbInstance;
    }

    try {
        // Ensure the directory exists for file-based databases
        if (targetPath !== ':memory:') {
            const dbDir = path.dirname(targetPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
                logger.info(`[DB] Created database directory: ${dbDir}`);
            }
        }

        logger.info(`[DB] Initializing database connection at: ${targetPath}`);
        const newDb = new Database(targetPath);
        logger.info('[DB] Connection successful.');

        // Enable WAL mode for better concurrency (not applicable to :memory:)
        if (targetPath !== ':memory:') {
             try {
                 newDb.pragma('journal_mode = WAL');
                 logger.info('[DB] WAL mode enabled.');
             } catch (walError) {
                 // May fail on some network file systems, log warning but continue
                 logger.warn('[DB] Could not enable WAL mode (may be normal for some file systems): ', walError);
             }
        }

        // Set the singleton instance *only* if we initialized the default DB path
        if (!dbPath) {
            dbInstance = newDb;
            logger.info('[DB] Singleton database instance set.');
        }

        return newDb;

    } catch (error) {
        logger.error(`[DB] Failed during database connection initialization at ${targetPath}:`, error);
        // Ensure singleton is null if default init failed
        if (!dbPath) {
             dbInstance = null;
        }
        throw new Error(`Database connection failed: ${error instanceof Error ? error.message : error}`);
    }
}

/**
 * Closes the singleton database connection, if it exists.
 * Should be called on application shutdown.
 */
export function closeDb(): void {
     if (dbInstance && dbInstance.open) {
        logger.info('[DB] Closing singleton database connection...');
        dbInstance.close();
        dbInstance = null;
        logger.info('[DB] Singleton database connection closed.');
    } else {
        logger.debug('[DB] No active singleton database connection to close.');
    }
}

/**
 * Gets the default path for the application database.
 * Uses app.getPath('userData') which requires Electron context or a mock.
 * For testing outside Electron, consider mocking app.getPath.
 */
export function getDbPath(): string {
     try {
        // Dynamic import of app for environments where electron may not be available
        // (e.g., testing environment without full Electron setup)
        // We attempt to get the path, but have a fallback for non-electron contexts
        const electron = require ('electron');
        if (electron && electron.app) {
             return path.join(electron.app.getPath('userData'), 'jeffers.db');
        } else {
             // Fallback for non-Electron environments (like basic Node tests)
             logger.warn('[DB] electron.app not available, using fallback DB path: ./data/jeffers_fallback.db');
             return path.resolve(process.cwd(), 'data', 'jeffers_fallback.db');
        }
    } catch (error) {
        // If require('electron') fails entirely
         logger.warn('[DB] Failed to require Electron, using fallback DB path: ./data/jeffers_fallback.db');
         return path.resolve(process.cwd(), 'data', 'jeffers_fallback.db');
    }

}

// REMOVED applyMigrations function - it now lives in runMigrations.ts
// REMOVED old initDb implementation that called applyMigrations 