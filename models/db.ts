import Database from 'better-sqlite3';
import { logger } from '../utils/logger';

let db: Database.Database | null = null;

/**
 * Initialises the database connection and runs migrations.
 * This must be called once during application startup before any DB operations.
 * @param dbPath The absolute path to the SQLite database file.
 */
export function initDb(dbPath: string): void {
  if (db) {
    logger.warn('[DB] initDb called but database already initialized.');
    return;
  }
  try {
    logger.info(`[DB] Initializing database connection at: ${dbPath}`);
    db = new Database(dbPath);
    logger.info('[DB] Connection successful.');

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');
    logger.info('[DB] WAL mode enabled.');

    // Run migrations (idempotent)
    logger.info('[DB] Running migrations...');
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
    logger.info('[DB] Migrations completed successfully.');
  } catch (error) {
    logger.error(`[DB] Failed during database initialization or migration at ${dbPath}:`, error);
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
export default function getDb(): Database.Database {
  if (!db) {
    // This should ideally not happen if initDb is called correctly at startup
    logger.error('[DB] getDb called before database was initialized.');
    throw new Error('Database accessed before initialization. Call initDb first.');
  }
  return db;
} 