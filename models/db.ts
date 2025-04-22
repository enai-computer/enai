import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

let db: Database.Database | null = null;

// Function to apply migrations
function applyMigrations(dbInstance: Database.Database, migrationsDir: string): void {
  logger.info('[DB Migrator] Starting migration process...');

  // Ensure migrations directory exists
  if (!fs.existsSync(migrationsDir)) {
    logger.info(`[DB Migrator] Migrations directory not found at ${migrationsDir}, skipping.`);
    return;
  }

  // 1. Ensure the schema_migrations table exists (should be created by the first migration)
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Get applied migration versions
  const getAppliedStmt = dbInstance.prepare('SELECT version FROM schema_migrations');
  const appliedVersions = new Set<string>(
    getAppliedStmt.all().map((row: any) => row.version)
  );
  logger.debug(`[DB Migrator] Applied versions found: ${[...appliedVersions].join(', ') || 'None'}`);

  // 3. Read migration files
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort(); // Sort alphabetically/numerically by filename

  logger.info(`[DB Migrator] Found migration files: ${migrationFiles.join(', ') || 'None'}`);

  // 4. Apply pending migrations
  const insertAppliedStmt = dbInstance.prepare(
    `INSERT INTO schema_migrations (version) VALUES (?)`
  );

  for (const file of migrationFiles) {
    const version = path.basename(file, '.sql'); // Use filename (without .sql) as version

    if (!appliedVersions.has(version)) {
      logger.info(`[DB Migrator] Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      // Run migration within a transaction
      const runMigration = dbInstance.transaction(() => {
        dbInstance.exec(sql);
        insertAppliedStmt.run(version);
      });

      try {
        runMigration();
        logger.info(`[DB Migrator] Successfully applied migration: ${file}`);
      } catch (error) {
        logger.error(`[DB Migrator] Failed to apply migration ${file}:`, error);
        // Optional: Re-throw to stop the init process on migration failure
        throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : error}`);
      }
    } else {
      logger.debug(`[DB Migrator] Skipping already applied migration: ${file}`);
    }
  }
  logger.info('[DB Migrator] Migration process completed.');
}


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
    const dbDir = path.dirname(dbPath);
    // Ensure the directory exists before creating the DB file
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        logger.info(`[DB] Created database directory: ${dbDir}`);
    }

    logger.info(`[DB] Initializing database connection at: ${dbPath}`);
    db = new Database(dbPath);
    logger.info('[DB] Connection successful.');

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');
    logger.info('[DB] WAL mode enabled.');

    // --- Apply Migrations --- 
    // Determine migrations directory relative to this file or workspace root
    // Assuming db.ts is in models/, migrations are in models/migrations/
    const migrationsDir = path.join(__dirname, 'migrations');
    applyMigrations(db, migrationsDir);
    // --- Migrations Applied --- 

    // REMOVED the old hardcoded db.exec call for bookmarks table.
    // Ensure bookmarks table creation is now in a migration file (e.g., 0001_create_bookmarks.sql)

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