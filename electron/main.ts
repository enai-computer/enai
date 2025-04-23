import dotenv from 'dotenv';
import path from 'path';
import Database from 'better-sqlite3'; // Import Database type

// Explicitly load .env from the project root
const envPath = path.resolve(__dirname, '../../.env'); 
// __dirname is dist/electron, so ../../ goes to project root
dotenv.config({ path: envPath });

// ADDED: Log env vars immediately after dotenv.config()
import { logger } from '../utils/logger'; // Import logger here if not already imported globally
logger.info(`[dotenv] Loaded .env file from: ${envPath}`);
logger.info(`[dotenv] BROWSERBASE_API_KEY loaded: ${!!process.env.BROWSERBASE_API_KEY}`); // Log true/false
logger.info(`[dotenv] BROWSERBASE_PROJECT_ID loaded: ${!!process.env.BROWSERBASE_PROJECT_ID}`); // Log true/false

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
import { ContentModel } from '../models/ContentModel'; // Import the class, not namespace
import { queueForContentIngestion } from '../services/ingestionQueue';
import { BookmarksService } from '../services/bookmarkService'; // Import BookmarksService

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow | null;
let db: Database.Database | null = null; // Define db instance at higher scope, initialize to null
let contentModel: ContentModel | null = null; // Define contentModel instance
let bookmarksService: BookmarksService | null = null; // Define bookmarksService instance

// --- Function to Register All IPC Handlers ---
// Accept bookmarksService as an argument
function registerAllIpcHandlers(bookmarksService: BookmarksService | null) {
    logger.info('[Main Process] Registering IPC Handlers...');

    // Handle the get-app-version request
    ipcMain.handle(GET_APP_VERSION, () => {
        const version = app.getVersion();
        logger.debug(`[Main Process] IPC Handler: Returning app version: ${version}`); // Use debug
        return version;
    });

    // Register other specific handlers
    registerGetProfileHandler();
    if (bookmarksService) {
        registerImportBookmarksHandler(bookmarksService);
    } else {
        // Log an error if the service wasn't initialized (should not happen if DB init succeeded)
        logger.error('[Main Process] Cannot register bookmarks IPC handler: BookmarksService not initialized.');
    }
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
app.whenReady().then(() => {
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

    // --- Instantiate Models --- 
    contentModel = new ContentModel(db); // Instantiate ContentModel here
    logger.info('[Main Process] Core models instantiated.');

    // --- Instantiate Services --- 
    bookmarksService = new BookmarksService(contentModel); // Instantiate BookmarksService
    logger.info('[Main Process] Core services instantiated.');

  } catch (dbError) {
    logger.error('[Main Process] CRITICAL: Database initialization or migration failed. The application cannot start.', dbError);
    // Show error dialog and quit
    dialog.showErrorBox('Database Error', 'Failed to initialize or migrate the database. The application cannot start.\n\nDetails: ' + (dbError instanceof Error ? dbError.message : String(dbError)));
    app.quit();
    return; // Prevent further execution
  }
  // --- End Database Initialization & Migrations ---

  createWindow();

  // --- Re-queue Stale/Missing Ingestion Jobs (Only after successful DB init/migration) ---
  logger.info('[Main Process] Checking for stale or missing ingestion jobs...');
  // Check if contentModel was initialized before proceeding
  if (!contentModel) {
      logger.error("[Main Process] Cannot check for stale jobs: ContentModel not initialized.");
  } else {
      // Assign to a new const within this block where it's known to be non-null
      const nonNullContentModel = contentModel;
      try {
        // Query 1: Find jobs that were started but failed or timed out
        const staleStatuses: ContentModel['constructor']['prototype']['constructor']['ContentStatus'][] = ['pending', 'timeout', 'fetch_error', 'http_error']; // Correct type access
        const staleJobs = nonNullContentModel.findByStatuses(staleStatuses); // Use non-null const
        const jobsToQueue = new Map<string, string>(); // Use Map to avoid duplicates (bookmarkId -> url)

        if (staleJobs.length > 0) {
            logger.info(`[Main Process] Found ${staleJobs.length} stale jobs. Adding to re-queue list...`);
            staleJobs.forEach(job => {
                if (job.source_url) {
                    jobsToQueue.set(job.bookmark_id, job.source_url);
                } else {
                    logger.warn(`[Main Process] Skipping stale job for bookmark ${job.bookmark_id} due to missing source_url.`);
                }
            });
        }

        // Query 2: Find bookmarks that have no corresponding entry in the content table
        // Use the db instance from the outer scope (known non-null here)
        try {
            const stmtMissing = db.prepare(`
                SELECT b.bookmark_id, b.url
                FROM bookmarks b
                LEFT JOIN content c ON b.bookmark_id = c.bookmark_id
                WHERE c.bookmark_id IS NULL
            `);
            // Type assertion: Expecting this structure
            const missingJobs = stmtMissing.all() as { bookmark_id: string; url: string }[];

            if (missingJobs.length > 0) {
                logger.info(`[Main Process] Found ${missingJobs.length} bookmarks missing content entries. Adding to queue list...`);
                missingJobs.forEach(job => {
                    if (job.url) {
                        jobsToQueue.set(job.bookmark_id, job.url);
                    } else {
                        logger.warn(`[Main Process] Skipping missing job for bookmark ${job.bookmark_id} due to missing url in bookmarks table.`);
                    }
                });
            }
        } catch (missingTableError: any) {
            // If the bookmarks table doesn't exist yet, that's okay on first run.
            if (missingTableError.code === 'SQLITE_ERROR' && missingTableError.message.includes('no such table: bookmarks')) {
                logger.warn('[Main Process] Bookmarks table not found, skipping check for missing content entries (expected on first run).');
            } else {
                // Re-throw unexpected errors
                throw missingTableError;
            }
        }

        // Queue all unique jobs found
        if (jobsToQueue.size > 0) {
            logger.info(`[Main Process] Re-queuing ${jobsToQueue.size} unique stale/missing jobs...`);
            // No need for separate null check here, already inside the main else block
            jobsToQueue.forEach((url, bookmarkId) => {
                // Pass the instantiated contentModel (known non-null here via const)
                queueForContentIngestion(bookmarkId, url, nonNullContentModel);
            });
        } else {
            logger.info('[Main Process] No stale or missing ingestion jobs found that need re-queuing.');
        }

      } catch (queueError) {
          logger.error('[Main Process] Failed to query or re-queue stale/missing ingestion jobs:', queueError);
          // Continue startup even if re-queuing fails, but log the error
      }
  }
  // --- End Re-queue Stale/Missing Ingestion Jobs ---

  // --- Register IPC Handlers ---
  // Pass the instantiated bookmarksService
  registerAllIpcHandlers(bookmarksService); // Call the extracted function
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
app.on('before-quit', (event) => {
  logger.info('[Main Process] Before quit event received.'); // Use logger
  try {
    // Use the imported getDb
    if (db && db.open) { // Use the db instance from the outer scope
      logger.info('[Main Process] Closing database connection...'); // Use logger
      db.close();
      logger.info('[Main Process] Database connection closed.'); // Use logger
    }
  } catch (error) {
    logger.error('[Main Process] Error closing database:', error); // Use logger
  }
  // No preventDefault needed unless we want to abort quitting
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
logger.info('[Main Process] Main script loaded.'); // Use logger
