import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs'; // Import fs for existsSync
import Database from 'better-sqlite3'; // Import Database type

// Hoist logger import
import { logger } from '../utils/logger';

// Explicitly load .env from the project root
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    logger.info(`[dotenv] Loaded .env file from: ${envPath}`);
} else {
    logger.warn(`[dotenv] .env file not found at: ${envPath}. Proceeding without it.`);
}

// Log env vars immediately after potential dotenv.config()
logger.info(`[dotenv] BROWSERBASE_API_KEY loaded: ${!!process.env.BROWSERBASE_API_KEY}`);
logger.info(`[dotenv] BROWSERBASE_PROJECT_ID loaded: ${!!process.env.BROWSERBASE_PROJECT_ID}`);

// import 'dotenv/config'; // Remove the side-effect import

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
// import path from 'path'; // Already imported
import url from 'url';
// Import the channel constant
import { GET_APP_VERSION } from '../shared/ipcChannels';
// Import IPC handler registration functions
import { registerGetProfileHandler } from './ipc/profile';
import { registerImportBookmarksHandler } from './ipc/bookmarks';
import { registerSaveTempFileHandler } from './ipc/saveTempFile';
// Import DB initialisation & cleanup
import { initDb } from '../models/db'; // Only import initDb, remove getDb
import runMigrations from '../models/runMigrations'; // Import migration runner - UNCOMMENT
// Import the new ObjectModel
import { ObjectModel } from '../models/ObjectModel';
// Import ChunkingService
import { ChunkingService, createChunkingService } from '../services/ChunkingService';
// Remove old model/service imports
// import { ContentModel } from '../models/ContentModel';
// import { BookmarksService } from '../services/bookmarkService';
import { queueForContentIngestion } from '../services/ingestionQueue';
import { ObjectStatus } from '../shared/types'; // Import ObjectStatus type

// --- Single Instance Lock ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  logger.warn('[Main Process] Another instance is already running. Quitting this instance.');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    logger.info('[Main Process] Second instance detected. Focusing main window.');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
// --- End Single Instance Lock ---

// --- Global Error Handlers ---
process.on('unhandledRejection', (reason, promise) => {
  logger.error('[Main Process] Unhandled Rejection at:', promise, 'reason:', reason);
  // Optionally add more specific error handling or reporting here
});

process.on('uncaughtException', (error, origin) => {
  logger.error('[Main Process] Uncaught Exception:', error, 'Origin:', origin);
  // Attempt to show a dialog before quitting
  dialog.showErrorBox(
    'Unhandled Error',
    `A critical error occurred: ${error?.message || 'Unknown error'}\n\nThe application might need to close.`
  );
  // Consider whether to force quit or allow potential recovery attempts
  // app.quit(); // Force quit might be necessary depending on the error
});
// --- End Global Error Handlers ---

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow | null;
let db: Database.Database | null = null; // Define db instance at higher scope, initialize to null
// Remove old model/service instance variables
// let contentModel: ContentModel | null = null;
// let bookmarksService: BookmarksService | null = null;
let objectModel: ObjectModel | null = null; // Define objectModel instance
let chunkingService: ChunkingService | null = null; // Define chunkingService instance

// --- Function to Register All IPC Handlers ---
// Accept objectModel
function registerAllIpcHandlers(objectModelInstance: ObjectModel) {
    logger.info('[Main Process] Registering IPC Handlers...');

    // Handle the get-app-version request
    ipcMain.handle(GET_APP_VERSION, () => {
        const version = app.getVersion();
        logger.debug(`[Main Process] IPC Handler: Returning app version: ${version}`);
        return version;
    });

    // Register other specific handlers
    registerGetProfileHandler();
    // Pass objectModel to the bookmark handler
    registerImportBookmarksHandler(objectModelInstance);
    registerSaveTempFileHandler();

    // Add future handlers here...

    logger.info('[Main Process] IPC Handlers registered.');
}
// --- End IPC Handler Registration Function ---

function createWindow() {
  try {
    logger.debug('[Main Process] Creating BrowserWindow...'); // Use debug
    // Create the browser window.
    mainWindow = new BrowserWindow({
      width: 1200, // Start with a larger default size
      height: 800,
      webPreferences: {
        // --- Security Settings ---
        // MUST be true for security and to use contextBridge.
        contextIsolation: true,
        // MUST be false for security. Renderer should not have node access.
        nodeIntegration: false,
        sandbox: true, // Enable sandbox
        allowRunningInsecureContent: false, // Explicitly set default
        // --- Preload Script ---
        // Path to the compiled preload script.
        // __dirname points to the *compiled* output directory (e.g., dist/electron)
        // Use path.resolve for robustness
        preload: path.resolve(__dirname, 'preload.js'),
      },
    });
    logger.debug('[Main Process] BrowserWindow created.'); // Use debug

    // Listen for load errors *before* trying to load
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      logger.error(`[Main Process] Failed to load URL: ${validatedURL}. Error: ${errorDescription} (Code: ${errorCode})`); // Use logger
    });

    // Determine the content to load based on the environment
    // Simple check, adjust if needed (e.g., using electron-is-dev)
    const isDev = process.env.NODE_ENV !== 'production';
    const openDevTools = process.env.OPEN_DEVTOOLS !== 'false'; // Check env var

    if (isDev) {
      // Load the Next.js development server URL
      // Ensure the NEXT_DEV_SERVER_URL env var is set (e.g., via package.json script or .env)
      const nextDevServerUrl = process.env.NEXT_DEV_SERVER_URL || 'http://localhost:3000';
      logger.info(`[Main Process] Attempting to load Development URL: ${nextDevServerUrl}`); // Use logger
      // Use async/await for cleaner error handling with loadURL
      mainWindow.loadURL(nextDevServerUrl)
        .then(() => {
          logger.info(`[Main Process] Successfully loaded URL: ${nextDevServerUrl}`); // Use logger
          // Open DevTools conditionally
          if (openDevTools) {
            mainWindow?.webContents.openDevTools();
          }
        })
        .catch((err) => {
          logger.error('[Main Process] Error loading development URL:', err); // Use logger
        });
    } else {
      // Load the production build output (static HTML file)
      const startUrl = url.format({
        // Assumes Next.js static export is in `src/out` relative to project root
        // Adjust the path based on your actual build output structure
        // `__dirname` is dist/electron, so we go up two levels to the project root
        pathname: path.join(__dirname, '../../src/out/index.html'),
        protocol: 'file:',
        slashes: true,
      });
      logger.info(`[Main Process] Attempting to load Production Build: ${startUrl}`); // Use logger
      mainWindow.loadURL(startUrl)
        .then(() => {
            logger.info(`[Main Process] Successfully loaded URL: ${startUrl}`); // Use logger
        })
        .catch((err) => {
            logger.error('[Main Process] Error loading production URL:', err); // Use logger
        });
    }

    // Emitted when the window is closed.
    mainWindow.on('closed', () => {
      // Dereference the window object, usually you would store windows
      // in an array if your app supports multi windows, this is the time
      // when you should delete the corresponding element.
      mainWindow = null;
      logger.debug('[Main Process] Main window closed.'); // Use debug
    });

  } catch (error) {
      logger.error('[Main Process] Error during createWindow:', error); // Use logger
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => { // Make async to await queueing
  logger.info('[Main Process] App ready.');

  let dbPath: string;
  // let db: Database.Database; // Remove declaration from this scope
  // let contentModel: ContentModel; // Remove declaration from this scope

  // --- Initialize Database & Run Migrations ---
  try {
    dbPath = path.join(app.getPath('userData'), 'jeffers.db');
    logger.info(`[Main Process] Initializing database at: ${dbPath}`);
    db = initDb(dbPath); // Assign to the db instance in this scope
    logger.info('[Main Process] Database handle initialized.');

    // Run migrations immediately after init, passing the instance
    logger.info('[Main Process] Running database migrations...');
    runMigrations(db); // Pass the captured instance
    logger.info('[Main Process] Database migrations completed.'); // Adjusted log

    // Enable auto-vacuum for potential space saving
    try {
        db.pragma('auto_vacuum = FULL');
        // Optionally run VACUUM immediately if needed, usually not necessary just after setting
        // db.exec('VACUUM;'); 
        logger.info('[Main Process] Set PRAGMA auto_vacuum = FULL on database.');
    } catch (pragmaError) {
        logger.warn('[Main Process] Failed to set PRAGMA auto_vacuum:', pragmaError);
    }

    // --- Instantiate Models --- 
    // Instantiate ObjectModel here, assign to module-level variable
    objectModel = new ObjectModel(db);
    logger.info('[Main Process] ObjectModel instantiated.');

    // --- Instantiate Services --- 
    // Initialize the ChunkingService with the database instance
    chunkingService = createChunkingService(db);
    logger.info('[Main Process] ChunkingService instantiated.');

  } catch (dbError) {
    logger.error('[Main Process] CRITICAL: Database initialization or migration failed. The application cannot start.', dbError);
    // Show error dialog and quit
    dialog.showErrorBox('Database Error', 'Failed to initialize or migrate the database. The application cannot start.\n\nDetails: ' + (dbError instanceof Error ? dbError.message : String(dbError)));
    app.quit();
    return; // Prevent further execution
  }
  // --- End Database Initialization & Migrations ---

  createWindow();

  // --- Re-queue Stale/Missing Ingestion Jobs (Using ObjectModel) ---
  logger.info('[Main Process] Checking for stale or missing ingestion jobs...');
  // Check if objectModel was initialized before proceeding
  if (!objectModel) {
      logger.error("[Main Process] Cannot check for stale jobs: ObjectModel not initialized.");
  } else {
      // Assign to a new const within this block where it's known to be non-null
      const nonNullObjectModel = objectModel;
      try {
        // Find objects that are 'new' or in an 'error' state
        // Adjust statuses as needed (e.g., add 'fetching', 'parsing' if those can get stuck)
        const statusesToRequeue: ObjectStatus[] = ['new', 'error'];
        const jobsToRequeue = await nonNullObjectModel.findByStatus(statusesToRequeue);

        if (jobsToRequeue.length > 0) {
            logger.info(`[Main Process] Found ${jobsToRequeue.length} objects in states [${statusesToRequeue.join(', ')}] to potentially re-queue.`);
            
            for (const job of jobsToRequeue) {
                if (job.source_uri) {
                     logger.debug(`[Main Process] Re-queuing object ${job.id} with URI ${job.source_uri}`);
                    // Call directly, don't collect promises if not awaiting
                    void queueForContentIngestion(job.id, job.source_uri, nonNullObjectModel);
                } else {
                    logger.warn(`[Main Process] Skipping re-queue for object ${job.id} due to missing source_uri.`);
                }
            }
            // Removed promise collection and await
            logger.info(`[Main Process] Finished adding ${jobsToRequeue.length} objects to the ingestion queue.`);
        } else {
            logger.info('[Main Process] No objects found in states needing re-queuing.');
        }

      } catch (queueError) {
          logger.error('[Main Process] Failed to query or re-queue stale/missing ingestion jobs:', queueError);
          // Continue startup even if re-queuing fails, but log the error
      }
  }
  // --- End Re-queue Stale/Missing Ingestion Jobs ---

  // --- Start Background Services ---
  if (chunkingService) {
      // Start the ChunkingService to begin processing objects with 'parsed' status
      logger.info('[Main Process] Starting ChunkingService...');
      chunkingService.start();
      logger.info('[Main Process] ChunkingService started.');
  } else {
      logger.error('[Main Process] Cannot start ChunkingService: not initialized.');
  }
  // --- End Start Background Services ---

  // --- Register IPC Handlers ---
  // Pass the instantiated objectModel
  if (objectModel) {
      registerAllIpcHandlers(objectModel);
  } else {
      // This should not happen if DB init succeeded
      logger.error('[Main Process] Cannot register IPC handlers: ObjectModel not initialized.');
  }
  // --- End IPC Handler Registration ---

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      logger.info('[Main Process] App activated, creating new window.'); // Use logger
      createWindow();
    }
  });
}).catch((error) => {
  logger.error('[Main Process] Error during app.whenReady:', error);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    logger.info('[Main Process] All windows closed, quitting app.'); // Use logger
    app.quit();
  } else {
    logger.info('[Main Process] All windows closed (macOS), app remains active.'); // Use logger
  }
});

// Add handler to close DB before quitting
app.on('before-quit', async (event) => {
  logger.info('[Main Process] Before quit event received.');
  
  // Stop the ChunkingService gracefully
  if (chunkingService?.isRunning()) {
    // Prevent the app from quitting immediately to allow cleanup
    event.preventDefault();
    
    logger.info('[Main Process] Stopping ChunkingService...');
    // This will work with both sync and async implementations of stop()
    await chunkingService.stop();
    
    logger.info('[Main Process] ChunkingService stopped successfully.');
  }
  
  // Close the database connection
  try {
    if (db && db.open) {
      logger.info('[Main Process] Closing database connection...');
      db.close();
      logger.info('[Main Process] Database connection closed.');
    }
  } catch (error) {
    logger.error('[Main Process] Error closing database:', error);
  }
  
  // Now we can safely quit
  if (event.defaultPrevented) {
    logger.info('[Main Process] Resuming quit operation after cleanup.');
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
logger.info('[Main Process] Main script loaded.'); // Use logger
