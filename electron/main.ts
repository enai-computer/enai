import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import url from 'url';
import { logger } from '../utils/logger'; // Import logger
// Import the channel constant
import { GET_APP_VERSION } from '../shared/ipcChannels';
// Import IPC handler registration functions
import { registerGetProfileHandler } from './ipc/profile';
import { registerImportBookmarksHandler } from './ipc/bookmarks';
import { registerSaveTempFileHandler } from './ipc/saveTempFile';
// Import DB initialisation & cleanup
import getDb, { initDb } from '../models/db'; // Import default getDb and named initDb
import runMigrations from '../models/runMigrations'; // Import migration runner - UNCOMMENT
import * as ContentModel from '../models/ContentModel';
import { queueForContentIngestion } from '../services/ingestionQueue';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow | null;

// --- Function to Register All IPC Handlers ---
function registerAllIpcHandlers() {
    logger.info('[Main Process] Registering IPC Handlers...');

    // Handle the get-app-version request
    ipcMain.handle(GET_APP_VERSION, () => {
        const version = app.getVersion();
        logger.debug(`[Main Process] IPC Handler: Returning app version: ${version}`); // Use debug
        return version;
    });

    // Register other specific handlers
    registerGetProfileHandler();
    registerImportBookmarksHandler();
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
  // --- Initialize Database & Run Migrations ---
  try {
    dbPath = path.join(app.getPath('userData'), 'jeffers.db');
    logger.info(`[Main Process] Initializing database at: ${dbPath}`);
    initDb(dbPath);
    logger.info('[Main Process] Database handle initialized.');

    // Run migrations immediately after init
    logger.info('[Main Process] Running database migrations...');
    runMigrations(); // Call the migration runner - UNCOMMENT (no dbPath needed if using getDb)
    logger.info('[Main Process] Database migrations completed.'); // Adjusted log

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
  try {
    // Query 1: Find jobs that were started but failed or timed out
    const staleStatuses: ContentModel.ContentStatus[] = ['pending', 'timeout', 'fetch_error', 'http_error'];
    const staleJobs = ContentModel.findByStatuses(staleStatuses);
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
    const db = getDb();
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

    // Queue all unique jobs found
    if (jobsToQueue.size > 0) {
        logger.info(`[Main Process] Re-queuing ${jobsToQueue.size} unique stale/missing jobs...`);
        jobsToQueue.forEach((url, bookmarkId) => {
            queueForContentIngestion(bookmarkId, url);
        });
    } else {
        logger.info('[Main Process] No stale or missing ingestion jobs found that need re-queuing.');
    }

  } catch (queueError) {
      logger.error('[Main Process] Failed to query or re-queue stale/missing ingestion jobs:', queueError);
      // Continue startup even if re-queuing fails, but log the error
  }
  // --- End Re-queue Stale/Missing Ingestion Jobs ---

  // --- Register IPC Handlers ---
  registerAllIpcHandlers(); // Call the extracted function
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
    const db = getDb();
    if (db && db.open) {
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
