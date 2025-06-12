import 'dotenv/config'; // Ensure .env is loaded first
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

import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, globalShortcut } from 'electron';
// import path from 'path'; // Already imported
import url from 'url';
// Import the channel constant
import { 
    GET_APP_VERSION,
    // Import the new flush channels
    MAIN_REQUEST_RENDERER_FLUSH,
    RENDERER_FLUSH_COMPLETE,
    SHORTCUT_MINIMIZE_WINDOW,
} from '../shared/ipcChannels';
// Import IPC handler registration functions
// Import bootstrap helpers
import { initModels, initServices } from './bootstrap/initServices';
import { registerAllIpcHandlers } from './bootstrap/registerIpcHandlers';
// Import DB initialisation & cleanup
import { initDb } from '../models/db'; // Only import initDb, remove getDb
import { runMigrations } from '../models/runMigrations'; // Import migration runner - UNCOMMENT
import { getSchedulerService, SchedulerService } from '../services/SchedulerService';
import { getActivityLogService } from '../services/ActivityLogService';
import { ObjectStatus } from '../shared/types';
import { UrlIngestionWorker } from '../services/ingestion/UrlIngestionWorker';
import { PdfIngestionWorker } from '../services/ingestion/PdfIngestionWorker';

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
let db: Database.Database | null = null;
let models: Awaited<ReturnType<typeof initModels>> | null = null;
let services: ReturnType<typeof initServices> | null = null;
let schedulerService: SchedulerService | null = null;


function createWindow() {
  try {
    logger.debug('[Main Process] Creating BrowserWindow...'); // Use debug
    // Create the browser window.
    mainWindow = new BrowserWindow({
      width: 1200, // Start with a larger default size
      height: 800,
      backgroundColor: '#000000', // Black background for corner radius effect
      fullscreen: true, // Start in fullscreen mode
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
    const isDev = process.env.NODE_ENV !== 'production';
    const openDevTools = process.env.OPEN_DEVTOOLS === 'true';

    if (isDev) {
      const nextDevServerUrl = process.env.NEXT_DEV_SERVER_URL || 'http://localhost:3000';
      logger.info(`[Main Process] Attempting to load Development URL: ${nextDevServerUrl}`);
      mainWindow.loadURL(nextDevServerUrl)
        .then(() => {
          logger.info(`[Main Process] Successfully loaded URL: ${nextDevServerUrl}`);
          if (openDevTools) {
            mainWindow?.webContents.openDevTools();
          }
        })
        .catch((err) => {
          logger.error('[Main Process] Error loading development URL:', err);
        });
    } else {
      const startUrl = url.format({
        pathname: path.join(__dirname, '../../src/out/index.html'),
        protocol: 'file:',
        slashes: true,
      });
      logger.info(`[Main Process] Attempting to load Production Build: ${startUrl}`);
      mainWindow.loadURL(startUrl)
        .then(() => {
          logger.info(`[Main Process] Successfully loaded URL: ${startUrl}`);
        })
        .catch((err) => {
          logger.error('[Main Process] Error loading production URL:', err);
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[Main Process] CRITICAL: Error during createWindow:', errorMessage); // Use logger
      dialog.showErrorBox('Application Startup Error', 'Failed to create the main application window.\n\nDetails: ' + errorMessage);
      app.quit();
  }
}


// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => { // Make async to await queueing
  logger.info('[Main Process] App ready.');

  // --- Initialize Database & Run Migrations ---
  try {
    // Initialize the database. Call initDb() WITHOUT arguments.
    // This will use getDbPath() internally to determine the path
    // AND, critically, it will set the global dbInstance in models/db.ts
    // because the 'dbPath' argument to initDb will be undefined.
    db = initDb(); 
    logger.info(`[Main Process] Database initialized for path: ${db.name}`);
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

    // --- Initialize Models and Services ---
    models = await initModels(db);
    services = initServices(db, models, null); // mainWindow will be set later
    
    // Initialize SchedulerService and schedule profile synthesis tasks
    schedulerService = getSchedulerService();
    logger.info('[Main Process] SchedulerService instantiated.');

    // Schedule activity and task synthesis
    const activitySynthesisInterval = parseInt(
      process.env.ACTIVITY_SYNTHESIS_INTERVAL_MS || (60 * 60 * 1000).toString(), 10
    ); // Default: 1 hour
    schedulerService.scheduleTask(
      'activityAndTaskProfileSynthesis',
      activitySynthesisInterval,
      () => services?.profileAgent?.synthesizeProfileFromActivitiesAndTasks('default_user') || Promise.resolve(),
      true // Run once on startup
    );
    logger.info(`[Main Process] Profile synthesis from activities/tasks scheduled every ${activitySynthesisInterval / 1000 / 60} minutes.`);

    // Schedule content synthesis
    const contentSynthesisInterval = parseInt(
      process.env.CONTENT_SYNTHESIS_INTERVAL_MS || (8 * 60 * 60 * 1000).toString(), 10
    ); // Default: 8 hours
    schedulerService.scheduleTask(
      'contentProfileSynthesis',
      contentSynthesisInterval,
      () => services?.profileAgent?.synthesizeProfileFromContent('default_user') || Promise.resolve(),
      false // Don't run immediately on startup
    );
    logger.info(`[Main Process] Profile synthesis from content scheduled every ${contentSynthesisInterval / 1000 / 60 / 60} hours.`);

  } catch (dbError) {
    const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
    logger.error('[Main Process] CRITICAL: Database initialization or migration failed. The application cannot start.', errorMessage);
    // Show error dialog and quit
    dialog.showErrorBox('Database Error', 'Failed to initialize or migrate the database. The application cannot start.\n\nDetails: ' + errorMessage);
    app.quit();
    return; // Prevent further execution
  }
  // --- End Database Initialization & Migrations ---

  createWindow(); // Create the window first

  // Explicitly check if mainWindow was created. If not, it's a fatal error.
  if (!mainWindow) {
    logger.error('[Main Process] CRITICAL: mainWindow was not created successfully. Application cannot continue.');
    dialog.showErrorBox('Application Startup Error', 'The main application window could not be created. The application will now exit.');
    app.quit();
    return; // Prevent further execution
  }

  // Re-initialize services with mainWindow now that it's created
  services = initServices(db, models, mainWindow);
  logger.info('[Main Process] Services re-initialized with mainWindow.');
  
  
  // --- Register Ingestion Workers and Start Queue ---
  const { ingestionQueueService, pdfIngestionService } = services || {};
  const { objectModel, ingestionJobModel, chunkSqlModel, embeddingSqlModel, chromaVectorModel } = models || {};
  
  if (ingestionQueueService && objectModel && ingestionJobModel && pdfIngestionService && chunkSqlModel && embeddingSqlModel && chromaVectorModel) {
    logger.info('[Main Process] Registering ingestion workers...');
    
    // Create worker instances
    const urlWorker = new UrlIngestionWorker(objectModel, ingestionJobModel);
    const pdfWorker = new PdfIngestionWorker(
      pdfIngestionService, 
      objectModel, 
      chunkSqlModel, 
      embeddingSqlModel, 
      chromaVectorModel, 
      ingestionJobModel, 
      mainWindow
    );
    
    // Register workers with the queue
    ingestionQueueService.registerProcessor('url', urlWorker.execute.bind(urlWorker));
    ingestionQueueService.registerProcessor('pdf', pdfWorker.execute.bind(pdfWorker));
    
    logger.info('[Main Process] Ingestion workers registered.');
    
    // Start the queue service
    ingestionQueueService.start();
    logger.info('[Main Process] IngestionQueueService started.');
    
    // Forward progress events to renderer
    ingestionQueueService.on('job:progress', (job) => {
      if (mainWindow && !mainWindow.isDestroyed() && job.progress) {
        mainWindow.webContents.send('ingestion:progress', {
          jobId: job.id,
          jobType: job.jobType,
          status: job.status,
          progress: job.progress
        });
      }
    });
    
    // Forward worker completion events (note: this doesn't mean the entire job is done)
    ingestionQueueService.on('worker:completed', (job) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ingestion:worker-completed', {
          jobId: job.id,
          jobType: job.jobType,
          relatedObjectId: job.relatedObjectId
        });
      }
    });
    
    // Forward worker failure events
    ingestionQueueService.on('worker:failed', (job) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ingestion:worker-failed', {
          jobId: job.id,
          jobType: job.jobType,
          error: job.errorInfo
        });
      }
    });
  } else {
    logger.error('[Main Process] Cannot register ingestion workers: Required services not initialized.');
  }
  // --- End Register Ingestion Workers and Start Queue ---
  
  // --- Re-queue Stale/Missing Ingestion Jobs (Using new queue) ---
  logger.info('[Main Process] Checking for stale or missing ingestion jobs...');
  // Check if services are initialized
  if (!models?.objectModel || !services?.ingestionQueueService) {
      logger.error("[Main Process] Cannot check for stale jobs: Required services not initialized.");
  } else {
      try {
        // Find objects that are 'new' or in an 'error' state
        const statusesToRequeue: ObjectStatus[] = ['new', 'error'];
        const jobsToRequeue = await models!.objectModel.findByStatus(statusesToRequeue);

        if (jobsToRequeue.length > 0) {
            logger.info(`[Main Process] Found ${jobsToRequeue.length} objects in states [${statusesToRequeue.join(', ')}] to potentially re-queue.`);
            
            for (const job of jobsToRequeue) {
                if (job.sourceUri) {
                    logger.debug(`[Main Process] Re-queuing object ${job.id} with URI ${job.sourceUri}`);
                    // Use new queue system
                    if (job.sourceUri.startsWith('http')) {
                      await services!.ingestionQueueService.addJob('url', job.sourceUri, {
                        priority: 0,
                        jobSpecificData: {
                          existingObjectId: job.id
                        }
                      });
                    }
                    // Note: PDF re-queuing would need file path, which we don't have from objects table
                } else {
                    logger.warn(`[Main Process] Skipping re-queue for object ${job.id} due to missing sourceUri.`);
                }
            }
            logger.info(`[Main Process] Finished adding objects to the new ingestion queue.`);
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
  if (services?.chunkingService) {
      // Start the ChunkingService to begin processing objects with 'parsed' status
      logger.info('[Main Process] Starting ChunkingService...');
      services.chunkingService.start();
      logger.info('[Main Process] ChunkingService started.');
  } else {
      logger.error('[Main Process] Cannot start ChunkingService: not initialized.');
  }
  // --- End Start Background Services ---

  // --- Register IPC Handlers ---
  if (models && services && mainWindow) {
      registerAllIpcHandlers(services, models, mainWindow);
  } else {
      logger.error('[Main Process] Cannot register IPC handlers: Required models/services or mainWindow not initialized.');
  }
  // --- End IPC Handler Registration ---

  // --- Register Global Shortcuts ---
  globalShortcut.register('CommandOrControl+M', () => {
    logger.debug('[Main Process] Global shortcut CommandOrControl+M activated.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(SHORTCUT_MINIMIZE_WINDOW);
    }
  });

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

// Unregister all shortcuts when the application is about to quit.
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  logger.info('[Main Process] Unregistered all global shortcuts.');
});

// Add handler to close DB before quitting
// Define a helper function to handle the final quit logic
async function finalQuitSteps() {
  logger.info('[Main Process] Performing final quit steps.');
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
  logger.info('[Main Process] Exiting application.');
  app.quit();
}

app.on('before-quit', async (event) => {
  logger.info('[Main Process] Before quit event received.');
  
  // Prevent the app from quitting immediately to allow cleanup
  event.preventDefault();

  // Flush ActivityLogService before other cleanup
  const activityLogService = getActivityLogService();
  if (activityLogService) {
    logger.info('[Main Process] Flushing ActivityLogService...');
    await activityLogService.shutdown();
    logger.info('[Main Process] ActivityLogService flushed successfully.');
  }

  // Destroy all browser views before other cleanup
  if (services?.classicBrowserService) {
    logger.info('[Main Process] Destroying all ClassicBrowser views before quit...');
    await services.classicBrowserService.destroyAllBrowserViews();
    logger.info('[Main Process] All ClassicBrowser views destroyed.');
  }

  // Stop SchedulerService tasks before other cleanup
  if (schedulerService) {
    logger.info('[Main Process] Stopping SchedulerService tasks...');
    await schedulerService.stopAllTasks();
    logger.info('[Main Process] SchedulerService tasks stopped.');
  }

  // Stop the IngestionQueueService gracefully
  if (services?.ingestionQueueService?.isRunning) {
    logger.info('[Main Process] Stopping IngestionQueueService...');
    await services.ingestionQueueService.stop();
    logger.info('[Main Process] IngestionQueueService stopped successfully.');
  } else {
    logger.info('[Main Process] IngestionQueueService not running or not initialized.');
  }

  // Stop the ChunkingService gracefully
  if (services?.chunkingService?.isRunning()) {
    logger.info('[Main Process] Stopping ChunkingService...');
    await services.chunkingService.stop(); // Ensure this completes
    logger.info('[Main Process] ChunkingService stopped successfully.');
  } else {
    logger.info('[Main Process] ChunkingService not running or not initialized.');
  }

  // Check if mainWindow exists and is not destroyed
  if (mainWindow && !mainWindow.isDestroyed()) {
    logger.info('[Main Process] Requesting renderer to flush stores...');
    mainWindow.webContents.send(MAIN_REQUEST_RENDERER_FLUSH);

    const flushTimeoutDuration = 5000; // 5 seconds
    let flushTimeoutId: NodeJS.Timeout | null = null;

    const onFlushComplete = () => {
      if (flushTimeoutId) {
        clearTimeout(flushTimeoutId);
        flushTimeoutId = null;
      }
      logger.info('[Main Process] Renderer flush complete or timed out. Proceeding with final quit steps.');
      ipcMain.removeListener(RENDERER_FLUSH_COMPLETE, onFlushComplete); // Clean up listener
      finalQuitSteps();
    };

    ipcMain.once(RENDERER_FLUSH_COMPLETE, onFlushComplete);

    flushTimeoutId = setTimeout(() => {
      logger.warn(`[Main Process] Timeout (${flushTimeoutDuration}ms) waiting for renderer flush. Forcing quit sequence.`);
      onFlushComplete(); // Proceed to quit even if renderer didn't respond
    }, flushTimeoutDuration);

  } else {
    logger.info('[Main Process] No main window available or already destroyed. Skipping renderer flush. Proceeding with final quit steps.');
    finalQuitSteps();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
logger.info('[Main Process] Main script loaded.'); // Use logger
