"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = runMigrations;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = __importDefault(require("./db")); // Import the function to get the DB instance
const logger_1 = require("../utils/logger");
const MIGRATIONS_DIR_NAME = 'migrations';
const MIGRATIONS_TABLE_NAME = 'schema_migrations';
/**
 * Ensures the schema_migrations table exists.
 */
function ensureMigrationsTableExists() {
    const db = (0, db_1.default)();
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE_NAME} (
                version TEXT PRIMARY KEY,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
 * Gets a Set of already applied migration filenames from the database.
 */
function getAppliedMigrations() {
    const db = (0, db_1.default)();
    try {
        const stmt = db.prepare(`SELECT version FROM ${MIGRATIONS_TABLE_NAME}`);
        const rows = stmt.all();
        return new Set(rows.map(r => r.version));
    }
    catch (error) {
        // If the table doesn't exist yet (first run), this might fail depending on timing
        // but ensureMigrationsTableExists should have run first.
        logger_1.logger.error('[Migrations] Failed to query applied migrations:', error);
        throw error;
    }
}
/**
 * Reads migration filenames from the migrations directory, sorted alphabetically.
 */
function getMigrationFiles() {
    // Resolve path relative to project root, assuming structure: project_root/models/migrations
    // __dirname will be project_root/dist/models (or similar)
    const migrationsPath = path_1.default.resolve(__dirname, '..', '..', 'models', MIGRATIONS_DIR_NAME);
    try {
        if (!fs_1.default.existsSync(migrationsPath)) {
            logger_1.logger.warn(`[Migrations] Migrations directory not found: ${migrationsPath}. Creating it.`);
            // If the source dir doesn't exist, something is very wrong, but create it anyway.
            fs_1.default.mkdirSync(migrationsPath, { recursive: true }); // Ensure parent dirs are created if needed
            return []; // No migrations yet
        }
        const files = fs_1.default.readdirSync(migrationsPath)
            .filter(file => file.endsWith('.sql'))
            .sort(); // Sort alphabetically (e.g., 0001_.., 0002_..)
        logger_1.logger.debug(`[Migrations] Found migration files in ${migrationsPath}: ${files.join(', ') || 'None'}`);
        return files;
    }
    catch (error) {
        logger_1.logger.error(`[Migrations] Failed to read migrations directory ${migrationsPath}:`, error);
        throw error;
    }
}
/**
 * Runs all pending database migrations.
 */
function runMigrations() {
    logger_1.logger.info('[Migrations] Starting database migration check...');
    try {
        ensureMigrationsTableExists();
        const appliedVersions = getAppliedMigrations();
        const migrationFiles = getMigrationFiles();
        const db = (0, db_1.default)();
        let migrationsAppliedCount = 0;
        // Resolve the correct migrations directory path again for reading files
        const migrationsSourcePath = path_1.default.resolve(__dirname, '..', '..', 'models', MIGRATIONS_DIR_NAME);
        for (const filename of migrationFiles) {
            if (appliedVersions.has(filename)) {
                logger_1.logger.debug(`[Migrations] Skipping already applied migration: ${filename}`);
                continue;
            }
            logger_1.logger.info(`[Migrations] Applying migration: ${filename}...`);
            const filePath = path_1.default.join(migrationsSourcePath, filename); // Use resolved source path
            let sql;
            try {
                sql = fs_1.default.readFileSync(filePath, 'utf8');
            }
            catch (readError) {
                logger_1.logger.error(`[Migrations] FAILED to read migration file ${filePath}:`, readError);
                throw new Error(`Failed to read migration file ${filename}. Halting further migrations.`);
            }
            // Execute migration within a transaction
            const runMigration = db.transaction(() => {
                db.exec(sql);
                const stmt = db.prepare(`INSERT INTO ${MIGRATIONS_TABLE_NAME} (version) VALUES (?)`);
                stmt.run(filename);
            });
            try {
                runMigration();
                logger_1.logger.info(`[Migrations] Successfully applied migration: ${filename}`);
                migrationsAppliedCount++;
            }
            catch (migrationError) {
                logger_1.logger.error(`[Migrations] FAILED to apply migration ${filename}:`, migrationError);
                // Stop applying further migrations if one fails
                throw new Error(`Migration ${filename} failed. Halting further migrations.`);
            }
        }
        if (migrationsAppliedCount > 0) {
            logger_1.logger.info(`[Migrations] Applied ${migrationsAppliedCount} new migration(s).`);
        }
        else {
            logger_1.logger.info('[Migrations] Database schema is up to date.');
        }
    }
    catch (error) {
        logger_1.logger.error('[Migrations] Migration process failed:', error);
        // Propagate the error to potentially halt app startup in main.ts
        throw error;
    }
}
//# sourceMappingURL=runMigrations.js.map