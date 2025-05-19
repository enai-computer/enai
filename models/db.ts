import type { App } from 'electron';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

// Type for the default export of better-sqlite3
// This helps manage the conditional require
type DatabaseConstructor = typeof Database;

// Singleton instance holder
let dbInstance: Database.Database | null = null;

/**
 * Helper function to conditionally load the correct better-sqlite3 module.
 * Checks if running in Electron (and not via ELECTRON_RUN_AS_NODE) 
 * and loads the appropriate build (packaged vs. unpackaged vs. default Node).
 */
function getSqlite3(): DatabaseConstructor {
  const isElectron = typeof process.versions.electron === 'string';
  const isElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE === '1';
  const isTrueElectron = isElectron && !isElectronRunAsNode;
  
  let app: App | undefined;
  let isPackaged = false;
  if (isTrueElectron) {
    try {
      // Conditionally require electron only when needed and available
      app = require('electron').app;
      // Ensure app was successfully required before checking isPackaged
      isPackaged = app?.isPackaged ?? false; 
    } catch (e) {
      logger.warn("[DB] Failed to require Electron module, assuming unpackaged environment.");
    }
  }

  if (isTrueElectron) {
    let electronSqlitePath: string | undefined;
    
    // Check isPackaged (which implies app was successfully required)
    if (isPackaged) { 
      // Packaged App: Look relative to resourcesPath (expecting it to be unpacked)
      // Assumes packager unpacks to a dir like `app.asar.unpacked/electron_modules`
      // or places `electron_modules` directly in resourcesPath.
      // Adjust subpath `electron_modules/better-sqlite3` if packager config differs.
      const basePath = (process as { resourcesPath: string }).resourcesPath;
      // Try common unpacked path first
      let potentialPath = path.join(basePath, 'app.asar.unpacked', 'electron_modules', 'better-sqlite3');
      if (fs.existsSync(potentialPath)) {
          electronSqlitePath = potentialPath;
      } else {
          // Try path directly in resourcesPath
          potentialPath = path.join(basePath, 'electron_modules', 'better-sqlite3');
          if (fs.existsSync(potentialPath)) {
             electronSqlitePath = potentialPath;
          }
      }
      if (electronSqlitePath) {
           logger.info(`[DB] Packaged Electron detected. Attempting load from: ${electronSqlitePath}`);
      } else {
          logger.warn(`[DB] Packaged Electron detected, but module not found at expected unpacked paths relative to resourcesPath: ${basePath}. Will attempt default load.`);
      }

    } else {
      // Unpackaged Electron (Development): Look relative to __dirname
      // Assumes db.js is in dist/models/db.js, finds electron_modules at project root.
      try {
          const potentialPath = path.resolve(__dirname, '../../electron_modules', 'better-sqlite3');
          if (fs.existsSync(potentialPath)) {
             electronSqlitePath = potentialPath;
             logger.info(`[DB] Unpackaged Electron detected. Attempting load from: ${electronSqlitePath}`);
          } else {
             logger.warn(`[DB] Unpackaged Electron detected, but module not found at relative path: ${potentialPath}. Will attempt default load.`);
          }
      } catch (resolveError) {
         logger.warn(`[DB] Error resolving relative path for unpackaged Electron build:`, resolveError);
      }
    }
    
    // Attempt to load the Electron-specific path if found
    if (electronSqlitePath) {
       try {
          const sqlite = require(electronSqlitePath) as DatabaseConstructor;
          logger.info('[DB] Successfully loaded Electron-specific better-sqlite3 build.');
          return sqlite;
       } catch (error) {
           logger.warn(`[DB] Found Electron-specific path but failed to load module:`, error);
           // Fall through to default load
       }
    }
  }
  
  // Default / Fallback: Load the standard Node build from node_modules
  logger.debug('[DB] Loading default better-sqlite3 build from node_modules.');
  try {
     return require('better-sqlite3') as DatabaseConstructor;
  } catch (defaultError) {
     logger.error(`[DB] CRITICAL: Failed to load default better-sqlite3 build!`, defaultError);
     // This is a fatal error for the DB layer
     throw defaultError;
  }
}

/**
 * Returns the singleton database instance.
 * Throws an error if the database has not been initialized via initDb().
 * @returns The singleton Database instance.
 */
export function getDb(): Database.Database {
    if (!dbInstance) {
        logger.error('[DB] getDb called before database was initialized.');
        throw new Error('Database accessed before initialization. Call initDb first.');
    }
    return dbInstance;
}

/**
 * Initializes the database connection.
 * Uses the conditionally loaded better-sqlite3 module.
 * Creates the database file and directory if they don't exist.
 * Enables WAL mode.
 * Sets the singleton instance (`dbInstance`) accessed via `getDb()` *only if* this function
 * is called without an explicit `dbPath` argument (i.e., initializing the default application database).
 * If an explicit `dbPath` is provided, a connection is returned but the global singleton is not affected.
 * Does NOT run migrations - that should be handled separately.
 *
 * @param dbPath Optional path to the database file. If omitted, uses the path from `getDbPath()`. If ':memory:', creates an in-memory DB.
 * @returns The created Database instance.
 */
export function initDb(dbPath?: string): Database.Database {
    const targetPath = dbPath ?? getDbPath();

    if (!dbPath && dbInstance) { // Attempting to init the default DB path
        if (dbInstance.open) { // Check if the existing singleton is open
            logger.warn('[DB] initDb called for default path; returning existing OPEN singleton instance.');
            return dbInstance;
        } else {
            // Singleton exists but is closed, proceed to create a new one for the default path
            logger.warn('[DB] initDb called for default path; existing singleton was CLOSED. Creating a new instance.');
            // Fall through to create newDb and reassign dbInstance
        }
    }

    // Ensure the directory exists for file-based databases
    if (targetPath !== ':memory:') {
        const dbDir = path.dirname(targetPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            logger.info(`[DB] Created database directory: ${dbDir}`);
        }
    }

    logger.info(`[DB] Initializing new database connection at: ${targetPath}`);
    // Use the conditionally loaded constructor
    const Sqlite3 = getSqlite3();
    const newDb = new Sqlite3(targetPath);
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
        logger.info('[DB] Singleton database instance (re)set.');
    }

    return newDb;
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
 * Gets the path for the application database.
 * 1. Uses the `JEFFERS_DB_PATH` environment variable if set.
 *    - Returns ':memory:' directly if the variable is exactly ':memory:'.
 *    - Resolves other paths using `path.resolve()`.
 * 2. If the environment variable is not set, attempts to use Electron's `app.getPath('userData')`.
 * 3. If Electron is unavailable, falls back to `./data/jeffers_default.db` relative to `process.cwd()`.
 * Ensures the target directory exists for file-based paths.
 */
export function getDbPath(): string {
    const envPath = process.env.JEFFERS_DB_PATH;

    // 1. Check Environment Variable
    if (envPath) {
        if (envPath === ':memory:') {
            logger.info('[DB] Using in-memory database (from JEFFERS_DB_PATH).');
            return ':memory:';
        }
        // Resolve the path to handle relative paths correctly
        const resolvedEnvPath = path.resolve(envPath);
        logger.info(`[DB] Using database path from JEFFERS_DB_PATH: ${resolvedEnvPath}`);
        // Ensure directory exists for environment variable path
        ensureDirectoryExists(path.dirname(resolvedEnvPath));
        return resolvedEnvPath;
    }

    // 2. Fallback: Try Electron's userData path
    try {
        // We need to require electron conditionally inside functions that use it
        // to avoid errors when running in pure Node environments (like tests)
        const electron = require('electron'); 
        if (electron && electron.app) {
            const userDataPath = electron.app.getPath('userData');
            const electronDefaultPath = path.join(userDataPath, 'jeffers_default.db');
            logger.warn(`[DB] JEFFERS_DB_PATH not set. Using Electron default path: ${electronDefaultPath}`);
            // Ensure directory exists for Electron default path
            ensureDirectoryExists(userDataPath); // userDataPath is the directory
            return electronDefaultPath;
        } else {
             logger.debug('[DB] Electron app object not available.');
        }
    } catch (error) {
        // Log if require('electron') fails, but proceed to next fallback
        logger.debug('[DB] Electron module not available, cannot use userData path.');
    }

    // 3. Final Fallback: process.cwd()
    const cwdDefaultPath = path.resolve(process.cwd(), 'data', 'jeffers_default.db');
    logger.warn(`[DB] JEFFERS_DB_PATH not set and Electron unavailable. Using fallback path relative to cwd: ${cwdDefaultPath}`);
    // Ensure directory exists for CWD fallback path
    ensureDirectoryExists(path.dirname(cwdDefaultPath));
    return cwdDefaultPath;
}

/**
 * Helper function to ensure a directory exists.
 * Throws an error if creation fails.
 * @param dirPath - The absolute path to the directory.
 */
function ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        try {
            fs.mkdirSync(dirPath, { recursive: true });
            logger.info(`[DB Helper] Created database directory: ${dirPath}`);
        } catch (mkdirError) {
            logger.error(`[DB Helper] Failed to create database directory ${dirPath}:`, mkdirError);
            // Re-throw or handle as appropriate for your application startup
            throw new Error(`Failed to create required data directory: ${mkdirError instanceof Error ? mkdirError.message : mkdirError}`);
        }
    }
}

// REMOVED applyMigrations function - it now lives in runMigrations.ts
// REMOVED old initDb implementation that called applyMigrations 