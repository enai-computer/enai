"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = runMigrations;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("./db"); // Import the function to get the DB instance
const logger_1 = require("../utils/logger");
const MIGRATIONS_DIR_NAME = 'migrations';
const MIGRATIONS_TABLE_NAME = 'schema_migrations';
/**
 * Ensures the schema_migrations table exists on the given DB instance.
 * @param db The database instance to use.
 */
function ensureMigrationsTableExists(db) {
    // const db = getDb(); // Use passed-in db instance
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE_NAME} (
                version TEXT PRIMARY KEY,
                applied_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) -- Use standard format
            );
        `);
        logger_1.logger.debug(`[Migrations] Ensured table '${MIGRATIONS_TABLE_NAME}' exists.`);
    }
    catch (error) {
        logger_1.logger.error(`[Migrations] Failed to ensure migrations table '${MIGRATIONS_TABLE_NAME}':`, error);
        throw error; // Re-throw critical error
    }
}
/**
 * Gets a Set of already applied migration filenames from the given database instance.
 * @param db The database instance to use.
 */
function getAppliedMigrations(db) {
    // const db = getDb(); // Use passed-in db instance
    try {
        // Ensure table exists first before querying
        ensureMigrationsTableExists(db);
        const stmt = db.prepare(`SELECT version FROM ${MIGRATIONS_TABLE_NAME}`);
        const rows = stmt.all();
        return new Set(rows.map(r => r.version));
    }
    catch (error) {
        logger_1.logger.error('[Migrations] Failed to query applied migrations:', error);
        throw error;
    }
}
/**
 * Reads migration filenames from the migrations directory, sorted alphabetically.
 * Resolves path relative to this file's location.
 */
function getMigrationFiles() {
    // Resolve path relative to *this file\'s location*
    let migrationsPath;
    // If __dirname seems to be in a 'dist' structure (like during runtime of the built app)
    // e.g., /path/to/jeffers/dist/electron/models
    if (__dirname.includes(path_1.default.join('dist', 'electron'))) {
        migrationsPath = path_1.default.join(__dirname, '..', MIGRATIONS_DIR_NAME); // Should be dist/electron/migrations
    }
    else {
        // Likely running in source mode (e.g., tests), __dirname is models/
        migrationsPath = path_1.default.join(__dirname, MIGRATIONS_DIR_NAME); // Should be models/migrations
    }
    logger_1.logger.debug(`[Migrations] __dirname for runMigrations.ts: ${__dirname}`);
    logger_1.logger.debug(`[Migrations] Attempting to look for migration files in: ${migrationsPath}`);
    try {
        if (!fs_1.default.existsSync(migrationsPath)) {
            logger_1.logger.warn(`[Migrations] Migrations directory not found: ${migrationsPath}. No migrations will be applied.`);
            return []; // No migrations yet
        }
        const allFilesInDir = fs_1.default.readdirSync(migrationsPath);
        logger_1.logger.debug(`[Migrations] All files/dirs found by readdirSync in ${migrationsPath}: ${allFilesInDir.join(', ')}`);
        const files = allFilesInDir
            .filter(file => file.endsWith('.sql'))
            .sort(); // Sort alphabetically (e.g., 0001_.., 0002_..)
        logger_1.logger.debug(`[Migrations] Filtered and sorted .sql files: ${files.join(', ') || 'None'}`);
        return files;
    }
    catch (error) {
        logger_1.logger.error(`[Migrations] Failed to read migrations directory ${migrationsPath}:`, error);
        throw error;
    }
}
/**
 * Runs all pending database migrations on the provided DB instance or the default singleton.
 *
 * @param dbInstance Optional: The specific database instance to run migrations on.
 *                   If omitted, uses the singleton instance from getDb().
 */
function runMigrations(dbInstance) {
    const db = dbInstance ?? (0, db_1.getDb)(); // Use provided instance or default singleton
    const context = dbInstance ? 'provided DB instance' : 'default singleton DB';
    logger_1.logger.info(`[Migrations] Starting database migration check on ${context}...`);
    try {
        // Pass the db instance to helpers
        const appliedVersions = getAppliedMigrations(db);
        const migrationFiles = getMigrationFiles();
        let migrationsAppliedCount = 0;
        // Resolve the correct migrations directory path again for reading files
        // This path should be the same as calculated in getMigrationFiles
        let migrationsSourcePath;
        if (__dirname.includes(path_1.default.join('dist', 'electron'))) {
            migrationsSourcePath = path_1.default.join(__dirname, '..', MIGRATIONS_DIR_NAME);
        }
        else {
            migrationsSourcePath = path_1.default.join(__dirname, MIGRATIONS_DIR_NAME);
        }
        // logger.debug(`[Migrations] Source path for SQL files: ${migrationsSourcePath}`); // Optional: for debugging
        for (const filename of migrationFiles) {
            // Use base filename (without extension) as version for consistency
            const version = path_1.default.basename(filename, '.sql');
            if (appliedVersions.has(version)) {
                logger_1.logger.debug(`[Migrations] Skipping already applied migration: ${version} (${filename})`);
                continue;
            }
            logger_1.logger.info(`[Migrations] Applying migration: ${version} (${filename})...`);
            const filePath = path_1.default.join(migrationsSourcePath, filename);
            let sql;
            try {
                sql = fs_1.default.readFileSync(filePath, 'utf8');
            }
            catch (readError) {
                logger_1.logger.error(`[Migrations] FAILED to read migration file ${filePath}:`, readError);
                throw new Error(`Failed to read migration file ${filename}. Halting further migrations.`);
            }
            // Execute migration within a transaction on the correct DB instance
            const runMigrationTx = db.transaction(() => {
                db.exec(sql); // Execute the migration SQL
                // Record the version (filename without extension) in the migrations table
                const stmt = db.prepare(`INSERT INTO ${MIGRATIONS_TABLE_NAME} (version) VALUES (?)`);
                stmt.run(version);
            });
            try {
                runMigrationTx();
                logger_1.logger.info(`[Migrations] Successfully applied migration: ${version} (${filename})`);
                migrationsAppliedCount++;
            }
            catch (migrationError) {
                logger_1.logger.error(`[Migrations] FAILED to apply migration ${version} (${filename}):`, migrationError);
                // Stop applying further migrations if one fails
                throw new Error(`Migration ${version} (${filename}) failed. Halting further migrations.`);
            }
        }
        if (migrationsAppliedCount > 0) {
            logger_1.logger.info(`[Migrations] Applied ${migrationsAppliedCount} new migration(s) to ${context}.`);
        }
        else {
            logger_1.logger.info(`[Migrations] Database schema is up to date on ${context}.`);
        }
    }
    catch (error) {
        logger_1.logger.error(`[Migrations] Migration process failed on ${context}:`, error);
        // Propagate the error
        throw error;
    }
}
//# sourceMappingURL=runMigrations.js.map