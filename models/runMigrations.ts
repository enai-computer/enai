import fs from 'fs';
import path from 'path';
import getDb from './db'; // Import the function to get the DB instance
import { logger } from '../utils/logger';

const MIGRATIONS_DIR_NAME = 'migrations';
const MIGRATIONS_TABLE_NAME = 'schema_migrations';

/**
 * Ensures the schema_migrations table exists.
 */
function ensureMigrationsTableExists(): void {
    const db = getDb();
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE_NAME} (
                version TEXT PRIMARY KEY,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        logger.debug(`[Migrations] Ensured table '${MIGRATIONS_TABLE_NAME}' exists.`);
    } catch (error) {
        logger.error(`[Migrations] Failed to ensure migrations table '${MIGRATIONS_TABLE_NAME}':`, error);
        throw error; // Re-throw critical error
    }
}

/**
 * Gets a Set of already applied migration filenames from the database.
 */
function getAppliedMigrations(): Set<string> {
    const db = getDb();
    try {
        const stmt = db.prepare(`SELECT version FROM ${MIGRATIONS_TABLE_NAME}`);
        const rows = stmt.all() as { version: string }[];
        return new Set(rows.map(r => r.version));
    } catch (error) {
        // If the table doesn't exist yet (first run), this might fail depending on timing
        // but ensureMigrationsTableExists should have run first.
        logger.error('[Migrations] Failed to query applied migrations:', error);
        throw error;
    }
}

/**
 * Reads migration filenames from the migrations directory, sorted alphabetically.
 */
function getMigrationFiles(): string[] {
    // Resolve path relative to project root, assuming structure: project_root/models/migrations
    // __dirname will be project_root/dist/models (or similar)
    const migrationsPath = path.resolve(__dirname, '..', '..', 'models', MIGRATIONS_DIR_NAME);
    try {
        if (!fs.existsSync(migrationsPath)) {
            logger.warn(`[Migrations] Migrations directory not found: ${migrationsPath}. Creating it.`);
            // If the source dir doesn't exist, something is very wrong, but create it anyway.
            fs.mkdirSync(migrationsPath, { recursive: true }); // Ensure parent dirs are created if needed
            return []; // No migrations yet
        }
        const files = fs.readdirSync(migrationsPath)
                        .filter(file => file.endsWith('.sql'))
                        .sort(); // Sort alphabetically (e.g., 0001_.., 0002_..)
        logger.debug(`[Migrations] Found migration files in ${migrationsPath}: ${files.join(', ') || 'None'}`);
        return files;
    } catch (error) {
        logger.error(`[Migrations] Failed to read migrations directory ${migrationsPath}:`, error);
        throw error;
    }
}

/**
 * Runs all pending database migrations.
 */
export default function runMigrations(): void {
    logger.info('[Migrations] Starting database migration check...');

    try {
        ensureMigrationsTableExists();
        const appliedVersions = getAppliedMigrations();
        const migrationFiles = getMigrationFiles();
        const db = getDb();
        let migrationsAppliedCount = 0;

        // Resolve the correct migrations directory path again for reading files
        const migrationsSourcePath = path.resolve(__dirname, '..', '..', 'models', MIGRATIONS_DIR_NAME);

        for (const filename of migrationFiles) {
            if (appliedVersions.has(filename)) {
                logger.debug(`[Migrations] Skipping already applied migration: ${filename}`);
                continue;
            }

            logger.info(`[Migrations] Applying migration: ${filename}...`);
            const filePath = path.join(migrationsSourcePath, filename); // Use resolved source path
            let sql: string;
            try {
                sql = fs.readFileSync(filePath, 'utf8');
            } catch (readError) {
                logger.error(`[Migrations] FAILED to read migration file ${filePath}:`, readError);
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
                logger.info(`[Migrations] Successfully applied migration: ${filename}`);
                migrationsAppliedCount++;
            } catch (migrationError) {
                logger.error(`[Migrations] FAILED to apply migration ${filename}:`, migrationError);
                // Stop applying further migrations if one fails
                throw new Error(`Migration ${filename} failed. Halting further migrations.`);
            }
        }

        if (migrationsAppliedCount > 0) {
            logger.info(`[Migrations] Applied ${migrationsAppliedCount} new migration(s).`);
        } else {
            logger.info('[Migrations] Database schema is up to date.');
        }

    } catch (error) {
        logger.error('[Migrations] Migration process failed:', error);
        // Propagate the error to potentially halt app startup in main.ts
        throw error;
    }
} 