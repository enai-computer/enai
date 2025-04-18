"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDb = initDb;
exports.default = getDb;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const logger_1 = require("../utils/logger");
let db = null;
/**
 * Initialises the database connection and runs migrations.
 * This must be called once during application startup before any DB operations.
 * @param dbPath The absolute path to the SQLite database file.
 */
function initDb(dbPath) {
    if (db) {
        logger_1.logger.warn('[DB] initDb called but database already initialized.');
        return;
    }
    try {
        logger_1.logger.info(`[DB] Initializing database connection at: ${dbPath}`);
        db = new better_sqlite3_1.default(dbPath);
        logger_1.logger.info('[DB] Connection successful.');
        // Enable WAL mode for better concurrency
        db.pragma('journal_mode = WAL');
        logger_1.logger.info('[DB] WAL mode enabled.');
        // Run migrations (idempotent)
        logger_1.logger.info('[DB] Running migrations...');
        db.exec(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        bookmark_id INTEGER PRIMARY KEY AUTOINCREMENT, -- Use AUTOINCREMENT for default primary key
        url TEXT NOT NULL,
        url_hash TEXT UNIQUE NOT NULL, -- Ensure uniqueness at the DB level
        first_seen_ts INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)), -- Store as integer
        status TEXT DEFAULT 'queued' -- e.g., queued, processing, done, failed
      );

      CREATE INDEX IF NOT EXISTS idx_bookmarks_url_hash ON bookmarks(url_hash);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_status ON bookmarks(status);

      -- Placeholder for future tables:
      -- CREATE TABLE IF NOT EXISTS sources (...);
      -- CREATE TABLE IF NOT EXISTS source_bookmarks (...);
      -- CREATE TABLE IF NOT EXISTS chunks (...);
    `);
        logger_1.logger.info('[DB] Migrations completed successfully.');
    }
    catch (error) {
        logger_1.logger.error(`[DB] Failed during database initialization or migration at ${dbPath}:`, error);
        db = null; // Ensure db is null if init failed
        // Re-throw to potentially halt app startup if DB is critical
        throw new Error(`Database initialization failed: ${error instanceof Error ? error.message : error}`);
    }
}
/**
 * Returns the initialized database instance.
 * Throws an error if the database has not been initialized via initDb().
 * @returns The singleton Database instance.
 */
function getDb() {
    if (!db) {
        // This should ideally not happen if initDb is called correctly at startup
        logger_1.logger.error('[DB] getDb called before database was initialized.');
        throw new Error('Database accessed before initialization. Call initDb first.');
    }
    return db;
}
//# sourceMappingURL=db.js.map