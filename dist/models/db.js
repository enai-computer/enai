"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDb = initDb;
exports.default = getDb;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../utils/logger");
let db = null;
// Function to apply migrations
function applyMigrations(dbInstance, migrationsDir) {
    logger_1.logger.info('[DB Migrator] Starting migration process...');
    // Ensure migrations directory exists
    if (!fs_1.default.existsSync(migrationsDir)) {
        logger_1.logger.info(`[DB Migrator] Migrations directory not found at ${migrationsDir}, skipping.`);
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
    const appliedVersions = new Set(getAppliedStmt.all().map((row) => row.version));
    logger_1.logger.debug(`[DB Migrator] Applied versions found: ${[...appliedVersions].join(', ') || 'None'}`);
    // 3. Read migration files
    const migrationFiles = fs_1.default.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort(); // Sort alphabetically/numerically by filename
    logger_1.logger.info(`[DB Migrator] Found migration files: ${migrationFiles.join(', ') || 'None'}`);
    // 4. Apply pending migrations
    const insertAppliedStmt = dbInstance.prepare(`INSERT INTO schema_migrations (version) VALUES (?)`);
    for (const file of migrationFiles) {
        const version = path_1.default.basename(file, '.sql'); // Use filename (without .sql) as version
        if (!appliedVersions.has(version)) {
            logger_1.logger.info(`[DB Migrator] Applying migration: ${file}...`);
            const filePath = path_1.default.join(migrationsDir, file);
            const sql = fs_1.default.readFileSync(filePath, 'utf8');
            // Run migration within a transaction
            const runMigration = dbInstance.transaction(() => {
                dbInstance.exec(sql);
                insertAppliedStmt.run(version);
            });
            try {
                runMigration();
                logger_1.logger.info(`[DB Migrator] Successfully applied migration: ${file}`);
            }
            catch (error) {
                logger_1.logger.error(`[DB Migrator] Failed to apply migration ${file}:`, error);
                // Optional: Re-throw to stop the init process on migration failure
                throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : error}`);
            }
        }
        else {
            logger_1.logger.debug(`[DB Migrator] Skipping already applied migration: ${file}`);
        }
    }
    logger_1.logger.info('[DB Migrator] Migration process completed.');
}
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
        const dbDir = path_1.default.dirname(dbPath);
        // Ensure the directory exists before creating the DB file
        if (!fs_1.default.existsSync(dbDir)) {
            fs_1.default.mkdirSync(dbDir, { recursive: true });
            logger_1.logger.info(`[DB] Created database directory: ${dbDir}`);
        }
        logger_1.logger.info(`[DB] Initializing database connection at: ${dbPath}`);
        db = new better_sqlite3_1.default(dbPath);
        logger_1.logger.info('[DB] Connection successful.');
        // Enable WAL mode for better concurrency
        db.pragma('journal_mode = WAL');
        logger_1.logger.info('[DB] WAL mode enabled.');
        // --- Apply Migrations --- 
        // Determine migrations directory relative to this file or workspace root
        // Assuming db.ts is in models/, migrations are in models/migrations/
        const migrationsDir = path_1.default.join(__dirname, 'migrations');
        applyMigrations(db, migrationsDir);
        // --- Migrations Applied --- 
        // REMOVED the old hardcoded db.exec call for bookmarks table.
        // Ensure bookmarks table creation is now in a migration file (e.g., 0001_create_bookmarks.sql)
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