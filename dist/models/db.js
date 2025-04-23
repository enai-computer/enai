"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.initDb = initDb;
exports.closeDb = closeDb;
exports.getDbPath = getDbPath;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../utils/logger");
// Singleton instance holder
let dbInstance = null;
/**
 * Returns the singleton database instance.
 * Throws an error if the database has not been initialized via initDb().
 * @returns The singleton Database instance.
 */
function getDb() {
    if (!dbInstance) {
        // This should ideally not happen if initDb is called correctly at startup
        logger_1.logger.error('[DB] getDb called before database was initialized.');
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
function initDb(dbPath) {
    const targetPath = dbPath !== null && dbPath !== void 0 ? dbPath : getDbPath(); // Use provided path or default
    if (!dbPath && dbInstance) {
        // If using default path and already initialized, return singleton
        logger_1.logger.warn('[DB] initDb called for default path but database already initialized. Returning existing instance.');
        return dbInstance;
    }
    try {
        // Ensure the directory exists for file-based databases
        if (targetPath !== ':memory:') {
            const dbDir = path_1.default.dirname(targetPath);
            if (!fs_1.default.existsSync(dbDir)) {
                fs_1.default.mkdirSync(dbDir, { recursive: true });
                logger_1.logger.info(`[DB] Created database directory: ${dbDir}`);
            }
        }
        logger_1.logger.info(`[DB] Initializing database connection at: ${targetPath}`);
        const newDb = new better_sqlite3_1.default(targetPath);
        logger_1.logger.info('[DB] Connection successful.');
        // Enable WAL mode for better concurrency (not applicable to :memory:)
        if (targetPath !== ':memory:') {
            try {
                newDb.pragma('journal_mode = WAL');
                logger_1.logger.info('[DB] WAL mode enabled.');
            }
            catch (walError) {
                // May fail on some network file systems, log warning but continue
                logger_1.logger.warn('[DB] Could not enable WAL mode (may be normal for some file systems): ', walError);
            }
        }
        // Set the singleton instance *only* if we initialized the default DB path
        if (!dbPath) {
            dbInstance = newDb;
            logger_1.logger.info('[DB] Singleton database instance set.');
        }
        return newDb;
    }
    catch (error) {
        logger_1.logger.error(`[DB] Failed during database connection initialization at ${targetPath}:`, error);
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
function closeDb() {
    if (dbInstance && dbInstance.open) {
        logger_1.logger.info('[DB] Closing singleton database connection...');
        dbInstance.close();
        dbInstance = null;
        logger_1.logger.info('[DB] Singleton database connection closed.');
    }
    else {
        logger_1.logger.debug('[DB] No active singleton database connection to close.');
    }
}
/**
 * Gets the default path for the application database.
 * Uses app.getPath('userData') which requires Electron context or a mock.
 * For testing outside Electron, consider mocking app.getPath.
 */
function getDbPath() {
    try {
        // Dynamic import of app for environments where electron may not be available
        // (e.g., testing environment without full Electron setup)
        // We attempt to get the path, but have a fallback for non-electron contexts
        const electron = require('electron');
        if (electron && electron.app) {
            return path_1.default.join(electron.app.getPath('userData'), 'jeffers.db');
        }
        else {
            // Fallback for non-Electron environments (like basic Node tests)
            logger_1.logger.warn('[DB] electron.app not available, using fallback DB path: ./data/jeffers_fallback.db');
            return path_1.default.resolve(process.cwd(), 'data', 'jeffers_fallback.db');
        }
    }
    catch (error) {
        // If require('electron') fails entirely
        logger_1.logger.warn('[DB] Failed to require Electron, using fallback DB path: ./data/jeffers_fallback.db');
        return path_1.default.resolve(process.cwd(), 'data', 'jeffers_fallback.db');
    }
}
// REMOVED applyMigrations function - it now lives in runMigrations.ts
// REMOVED old initDb implementation that called applyMigrations 
//# sourceMappingURL=db.js.map