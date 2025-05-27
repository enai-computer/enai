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

import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } from 'electron';
// import path from 'path'; // Already imported
import url from 'url';
// Import the channel constant
import { 
    GET_APP_VERSION,
    // Import the new flush channels
    MAIN_REQUEST_RENDERER_FLUSH,
    RENDERER_FLUSH_COMPLETE 
} from '../shared/ipcChannels';
// Import IPC handler registration functions
import { registerProfileHandlers } from './ipc/profile';
import { registerImportBookmarksHandler } from './ipc/bookmarks';
import { registerSaveTempFileHandler } from './ipc/saveTempFile';
import { registerGetChatMessagesHandler } from './ipc/getChatMessages'; // Import the new handler
import { registerChatStreamStartHandler, registerChatStreamStopHandler } from './ipc/chatStreamHandler'; // Import chat stream handlers
import { registerGetSliceDetailsHandler } from './ipc/getSliceDetails'; // Import the slice details handler
import { registerSetIntentHandler } from './ipc/setIntentHandler'; // Import the new intent handler
// Import new IPC handler registration functions
import { registerNotebookIpcHandlers } from './ipc/notebookHandlers';
import { registerChatSessionIpcHandlers } from './ipc/chatSessionHandlers';
import { registerStorageHandlers } from './ipc/storageHandlers'; // Added import for storage handlers
import { registerActivityLogHandler } from './ipc/activityLogHandlers'; // Import activity log handler
import { registerToDoHandlers } from './ipc/toDoHandlers'; // Import to-do handlers
// Import DB initialisation & cleanup
import { initDb } from '../models/db'; // Only import initDb, remove getDb
import runMigrations from '../models/runMigrations'; // Import migration runner - UNCOMMENT
// Import the new ObjectModel
import { ObjectModel } from '../models/ObjectModel';
import { ChunkSqlModel } from '../models/ChunkModel'; // Import ChunkSqlModel
import { ChromaVectorModel } from '../models/ChromaVectorModel'; // Import ChromaVectorModel
import { ChatModel } from '../models/ChatModel'; // Import ChatModel CLASS
import { NotebookModel } from '../models/NotebookModel'; // Added import
import { EmbeddingSqlModel } from '../models/EmbeddingModel'; // Added import
// Import ChunkingService
import { ChunkingService, createChunkingService } from '../services/ChunkingService';
import { LangchainAgent } from '../services/agents/LangchainAgent'; // Import LangchainAgent CLASS
import { ChatService } from '../services/ChatService'; // Import ChatService CLASS
import { SliceService } from '../services/SliceService'; // Import SliceService
import { NotebookService } from '../services/NotebookService'; // Added import
import { AgentService } from '../services/AgentService'; // Added import
import { IntentService } from '../services/IntentService'; // Added import
import { getSchedulerService, SchedulerService } from '../services/SchedulerService'; // Import SchedulerService
import { ProfileAgent } from '../services/agents/ProfileAgent'; // Import ProfileAgent
// Remove old model/service imports
// import { ContentModel } from '../models/ContentModel';
// import { BookmarksService } from '../services/bookmarkService';
import { queueForContentIngestion } from '../services/ingestionQueue';
import { ObjectStatus } from '../shared/types'; // Import ObjectStatus type

// Import ClassicBrowserService and its handlers
import { ClassicBrowserService } from '../services/ClassicBrowserService';
import { registerClassicBrowserCreateHandler } from './ipc/classicBrowserInitView';
// import { registerClassicBrowserLoadUrlHandler } from './ipc/classicBrowserLoadUrlHandler'; // Removed as file is deleted
import { registerClassicBrowserNavigateHandler } from './ipc/classicBrowserNavigate';
import { registerClassicBrowserLoadUrlHandler } from './ipc/classicBrowserLoadUrl'; // Added import for new handler
import { registerClassicBrowserSetBoundsHandler } from './ipc/classicBrowserSetBounds'; // New
import { registerClassicBrowserSetVisibilityHandler } from './ipc/classicBrowserSetVisibility'; // New
import { registerClassicBrowserDestroyHandler } from './ipc/classicBrowserDestroy';
import { registerClassicBrowserRequestFocusHandler } from './ipc/classicBrowserRequestFocus'; // Import new handler

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
let chunkSqlModel: ChunkSqlModel | null = null; // Define chunkSqlModel instance
let notebookModel: NotebookModel | null = null; // Added declaration
let chromaVectorModel: ChromaVectorModel | null = null; // Define chromaVectorModel instance
let chunkingService: ChunkingService | null = null; // Define chunkingService instance
let embeddingSqlModel: EmbeddingSqlModel | null = null; // Added declaration
let chatModel: ChatModel | null = null; // Define chatModel instance
let langchainAgent: LangchainAgent | null = null; // Define langchainAgent instance
let chatService: ChatService | null = null; // Define chatService instance
let sliceService: SliceService | null = null; // Define sliceService instance
let notebookService: NotebookService | null = null; // Added declaration
let agentService: AgentService | null = null; // Added declaration
let intentService: IntentService | null = null; // Added declaration
let classicBrowserService: ClassicBrowserService | null = null; // Declare ClassicBrowserService instance
let profileAgent: ProfileAgent | null = null; // Declare ProfileAgent instance
let schedulerService: SchedulerService | null = null; // Declare SchedulerService instance

// --- Function to Register All IPC Handlers ---
// Accept objectModel, chatService, sliceService, AND intentService
function registerAllIpcHandlers(
    objectModelInstance: ObjectModel,
    chatServiceInstance: ChatService,
    sliceServiceInstance: SliceService,
    intentServiceInstance: IntentService, // Added intentServiceInstance parameter
    notebookServiceInstance: NotebookService, // Added notebookServiceInstance parameter
    classicBrowserServiceInstance: ClassicBrowserService | null // Allow null
) {
    logger.info('[Main Process] Registering IPC Handlers...');

    // Handle the get-app-version request
    ipcMain.handle(GET_APP_VERSION, () => {
        const version = app.getVersion();
        logger.debug(`[Main Process] IPC Handler: Returning app version: ${version}`);
        return version;
    });

    // Register other specific handlers
    registerProfileHandlers(ipcMain); // Updated to use registerProfileHandlers
    registerActivityLogHandler(ipcMain); // Register activity log handler
    // Pass objectModel to the bookmark handler
    registerImportBookmarksHandler(objectModelInstance);
    registerSaveTempFileHandler();
    // Pass chatService to the chat handlers
    registerGetChatMessagesHandler(chatServiceInstance); // Register the new handler
    registerChatStreamStartHandler(chatServiceInstance); // Register the start handler
    registerChatStreamStopHandler(chatServiceInstance); // Register the stop handler
    registerGetSliceDetailsHandler(sliceServiceInstance); // Register the slice details handler
    // registerStopChatStreamHandler(chatServiceInstance); // Comment out until implemented

    // Register the new intent handler, passing the actual IntentService instance
    registerSetIntentHandler(intentServiceInstance); // Use actual intentServiceInstance

    // Register Notebook and ChatSession specific handlers
    registerNotebookIpcHandlers(notebookServiceInstance);
    registerChatSessionIpcHandlers(notebookServiceInstance); // chat session handlers also use NotebookService for now

    // Register Storage Handlers
    registerStorageHandlers(); // Added call to register storage handlers

    // Register To-Do Handlers
    registerToDoHandlers(ipcMain);

    // Add future handlers here...
    // Register ClassicBrowser Handlers
    if (classicBrowserServiceInstance) {
        registerClassicBrowserCreateHandler(classicBrowserServiceInstance);
        registerClassicBrowserLoadUrlHandler(classicBrowserServiceInstance);
        registerClassicBrowserNavigateHandler(classicBrowserServiceInstance);
        registerClassicBrowserSetBoundsHandler(classicBrowserServiceInstance);
        registerClassicBrowserSetVisibilityHandler(classicBrowserServiceInstance);
        registerClassicBrowserDestroyHandler(classicBrowserServiceInstance);
        registerClassicBrowserRequestFocusHandler(classicBrowserServiceInstance); // Register new handler
        logger.info('[Main Process] ClassicBrowser IPC handlers registered.');
    } else {
        logger.warn('[Main Process] ClassicBrowserService instance not available, skipping its IPC handler registration.');
    }

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
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#111110' : '#fdfdfc', // Respond to system dark mode
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

    // --- Instantiate Models --- 
    // Instantiate ObjectModel here, assign to module-level variable
    objectModel = new ObjectModel(db);
    logger.info('[Main Process] ObjectModel instantiated.');
    
    // Instantiate ChunkSqlModel
    chunkSqlModel = new ChunkSqlModel(db);
    logger.info('[Main Process] ChunkSqlModel instantiated.');
    
    // Instantiate NotebookModel
    notebookModel = new NotebookModel(db); // Added instantiation
    logger.info('[Main Process] NotebookModel instantiated.');
    
    // Instantiate EmbeddingSqlModel
    embeddingSqlModel = new EmbeddingSqlModel(db); // Added instantiation
    logger.info('[Main Process] EmbeddingSqlModel instantiated.');

    // Instantiate ChromaVectorModel (no longer assuming simple constructor)
    chromaVectorModel = new ChromaVectorModel();
    logger.info('[Main Process] ChromaVectorModel instantiated.');
    // Initialize ChromaVectorModel connection AFTER DB is ready but BEFORE dependent services/agents
    try {
        logger.info('[Main Process] Initializing ChromaVectorModel connection...');
        await chromaVectorModel.initialize(); // Wait for connection/setup
        logger.info('[Main Process] ChromaVectorModel connection initialized successfully.');
    } catch (chromaInitError) {
        logger.error('[Main Process] CRITICAL: ChromaVectorModel initialization failed. Chat/Embedding features may not work.', chromaInitError);
        // Decide if this is fatal. For now, log error and continue, but features will likely fail.
        // If it MUST succeed: 
        // dialog.showErrorBox('Vector Store Error', 'Failed to connect to Chroma vector store.');
        // app.quit();
        // return;
    }

    // Instantiate ChatModel
    chatModel = new ChatModel(db);
    logger.info('[Main Process] ChatModel instantiated.');

    // --- Instantiate Services --- 
    // Initialize the ChunkingService with DB and vector store instances
    // Make sure chromaVectorModel is initialized before passing
    if (!chromaVectorModel?.isReady()) { // Check if Chroma init succeeded
        logger.error("[Main Process] Cannot instantiate ChunkingService: ChromaVectorModel not ready.");
        // Handle appropriately - maybe skip chunking service or throw fatal error
    } else if (!embeddingSqlModel) { // Check if embeddingSqlModel is initialized
        logger.error("[Main Process] Cannot instantiate ChunkingService: EmbeddingSqlModel not ready.");
    } else {
        chunkingService = createChunkingService(db, chromaVectorModel, undefined, embeddingSqlModel); // Pass embeddingSqlModel
        logger.info('[Main Process] ChunkingService instantiated.');
    }
    
    // Instantiate LangchainAgent (requires vector and chat models)
    // Ensure chromaVectorModel is ready and chatModel is non-null before proceeding
    if (!chromaVectorModel?.isReady() || !chatModel) {
        throw new Error("Cannot instantiate LangchainAgent: Required models (Chroma/Chat) not initialized or ready.");
    }
    langchainAgent = new LangchainAgent(chromaVectorModel, chatModel);
    logger.info('[Main Process] LangchainAgent instantiated.');

    // Instantiate ChatService (requires langchainAgent and chatModel)
    if (!langchainAgent || !chatModel) { // Check for chatModel as well
        throw new Error("Cannot instantiate ChatService: LangchainAgent or ChatModel not initialized.");
    }
    chatService = new ChatService(langchainAgent, chatModel);
    logger.info('[Main Process] ChatService instantiated.');

    // Instantiate SliceService (requires chunkSqlModel and objectModel)
    if (!chunkSqlModel || !objectModel) {
        throw new Error("Cannot instantiate SliceService: Required models (ChunkSql/Object) not initialized.");
    }
    sliceService = new SliceService(chunkSqlModel, objectModel);
    logger.info('[Main Process] SliceService instantiated.');

    // Instantiate NotebookService
    if (!notebookModel || !objectModel || !chunkSqlModel || !chatModel || !db) {
        throw new Error("Cannot instantiate NotebookService: Required models or DB instance not initialized.");
    }
    notebookService = new NotebookService(notebookModel, objectModel, chunkSqlModel, chatModel, db);
    logger.info('[Main Process] NotebookService instantiated.');

    // Instantiate AgentService
    if (!notebookService) {
        throw new Error("Cannot instantiate AgentService: Required service (NotebookService) not initialized.");
    }
    agentService = new AgentService(notebookService);
    logger.info('[Main Process] AgentService instantiated.');

    // Instantiate IntentService
    if (!notebookService || !agentService) {
        throw new Error("Cannot instantiate IntentService: Required services (NotebookService, AgentService) not initialized.");
    }
    intentService = new IntentService(notebookService, agentService);
    logger.info('[Main Process] IntentService instantiated.');

    // Instantiate ProfileAgent
    profileAgent = new ProfileAgent();
    logger.info('[Main Process] ProfileAgent instantiated.');

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
      () => profileAgent!.synthesizeProfileFromActivitiesAndTasks('default_user'),
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
      () => profileAgent!.synthesizeProfileFromContent('default_user'),
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

  // Instantiate ClassicBrowserService AFTER mainWindow has been created and verified
  classicBrowserService = new ClassicBrowserService(mainWindow);
  logger.info('[Main Process] ClassicBrowserService instantiated.');
  
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
  if (objectModel && chatService && sliceService && intentService && notebookService && db) { // Removed classicBrowserService from check
      registerAllIpcHandlers(objectModel, chatService, sliceService, intentService, notebookService, classicBrowserService);
  } else {
      logger.error('[Main Process] Cannot register IPC handlers: Required models/services or DB not initialized.'); // Simplified error message
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

  // Destroy all browser views before other cleanup
  if (classicBrowserService) {
    logger.info('[Main Process] Destroying all ClassicBrowser views before quit...');
    await classicBrowserService.destroyAllBrowserViews();
    logger.info('[Main Process] All ClassicBrowser views destroyed.');
  }

  // Stop SchedulerService tasks before other cleanup
  if (schedulerService) {
    logger.info('[Main Process] Stopping SchedulerService tasks...');
    await schedulerService.stopAllTasks();
    logger.info('[Main Process] SchedulerService tasks stopped.');
  }

  // Stop the ChunkingService gracefully first
  if (chunkingService?.isRunning()) {
    logger.info('[Main Process] Stopping ChunkingService...');
    await chunkingService.stop(); // Ensure this completes
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
