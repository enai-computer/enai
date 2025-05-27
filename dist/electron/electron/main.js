"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config"); // Ensure .env is loaded first
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs")); // Import fs for existsSync
// Hoist logger import
const logger_1 = require("../utils/logger");
// Explicitly load .env from the project root
const envPath = path_1.default.resolve(__dirname, '../../.env');
if (fs_1.default.existsSync(envPath)) {
    dotenv_1.default.config({ path: envPath });
    logger_1.logger.info(`[dotenv] Loaded .env file from: ${envPath}`);
}
else {
    logger_1.logger.warn(`[dotenv] .env file not found at: ${envPath}. Proceeding without it.`);
}
// Log env vars immediately after potential dotenv.config()
logger_1.logger.info(`[dotenv] BROWSERBASE_API_KEY loaded: ${!!process.env.BROWSERBASE_API_KEY}`);
logger_1.logger.info(`[dotenv] BROWSERBASE_PROJECT_ID loaded: ${!!process.env.BROWSERBASE_PROJECT_ID}`);
// import 'dotenv/config'; // Remove the side-effect import
const electron_1 = require("electron");
// import path from 'path'; // Already imported
const url_1 = __importDefault(require("url"));
// Import the channel constant
const ipcChannels_1 = require("../shared/ipcChannels");
// Import IPC handler registration functions
const profile_1 = require("./ipc/profile");
const bookmarks_1 = require("./ipc/bookmarks");
const saveTempFile_1 = require("./ipc/saveTempFile");
const getChatMessages_1 = require("./ipc/getChatMessages"); // Import the new handler
const chatStreamHandler_1 = require("./ipc/chatStreamHandler"); // Import chat stream handlers
const getSliceDetails_1 = require("./ipc/getSliceDetails"); // Import the slice details handler
const setIntentHandler_1 = require("./ipc/setIntentHandler"); // Import the new intent handler
// Import new IPC handler registration functions
const notebookHandlers_1 = require("./ipc/notebookHandlers");
const chatSessionHandlers_1 = require("./ipc/chatSessionHandlers");
const storageHandlers_1 = require("./ipc/storageHandlers"); // Added import for storage handlers
const activityLogHandlers_1 = require("./ipc/activityLogHandlers"); // Import activity log handler
const toDoHandlers_1 = require("./ipc/toDoHandlers"); // Import to-do handlers
// Import DB initialisation & cleanup
const db_1 = require("../models/db"); // Only import initDb, remove getDb
const runMigrations_1 = __importDefault(require("../models/runMigrations")); // Import migration runner - UNCOMMENT
// Import the new ObjectModel
const ObjectModel_1 = require("../models/ObjectModel");
const ChunkModel_1 = require("../models/ChunkModel"); // Import ChunkSqlModel
const ChromaVectorModel_1 = require("../models/ChromaVectorModel"); // Import ChromaVectorModel
const ChatModel_1 = require("../models/ChatModel"); // Import ChatModel CLASS
const NotebookModel_1 = require("../models/NotebookModel"); // Added import
const EmbeddingModel_1 = require("../models/EmbeddingModel"); // Added import
// Import ChunkingService
const ChunkingService_1 = require("../services/ChunkingService");
const LangchainAgent_1 = require("../services/agents/LangchainAgent"); // Import LangchainAgent CLASS
const ChatService_1 = require("../services/ChatService"); // Import ChatService CLASS
const SliceService_1 = require("../services/SliceService"); // Import SliceService
const NotebookService_1 = require("../services/NotebookService"); // Added import
const AgentService_1 = require("../services/AgentService"); // Added import
const IntentService_1 = require("../services/IntentService"); // Added import
const SchedulerService_1 = require("../services/SchedulerService"); // Import SchedulerService
const ProfileAgent_1 = require("../services/agents/ProfileAgent"); // Import ProfileAgent
// Remove old model/service imports
// import { ContentModel } from '../models/ContentModel';
// import { BookmarksService } from '../services/bookmarkService';
const ingestionQueue_1 = require("../services/ingestionQueue");
// Import ClassicBrowserService and its handlers
const ClassicBrowserService_1 = require("../services/ClassicBrowserService");
const classicBrowserInitView_1 = require("./ipc/classicBrowserInitView");
// import { registerClassicBrowserLoadUrlHandler } from './ipc/classicBrowserLoadUrlHandler'; // Removed as file is deleted
const classicBrowserNavigate_1 = require("./ipc/classicBrowserNavigate");
const classicBrowserLoadUrl_1 = require("./ipc/classicBrowserLoadUrl"); // Added import for new handler
const classicBrowserSetBounds_1 = require("./ipc/classicBrowserSetBounds"); // New
const classicBrowserSetVisibility_1 = require("./ipc/classicBrowserSetVisibility"); // New
const classicBrowserDestroy_1 = require("./ipc/classicBrowserDestroy");
const classicBrowserRequestFocus_1 = require("./ipc/classicBrowserRequestFocus"); // Import new handler
// --- Single Instance Lock ---
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    logger_1.logger.warn('[Main Process] Another instance is already running. Quitting this instance.');
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        logger_1.logger.info('[Main Process] Second instance detected. Focusing main window.');
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
}
// --- End Single Instance Lock ---
// --- Global Error Handlers ---
process.on('unhandledRejection', (reason, promise) => {
    logger_1.logger.error('[Main Process] Unhandled Rejection at:', promise, 'reason:', reason);
    // Optionally add more specific error handling or reporting here
});
process.on('uncaughtException', (error, origin) => {
    logger_1.logger.error('[Main Process] Uncaught Exception:', error, 'Origin:', origin);
    // Attempt to show a dialog before quitting
    electron_1.dialog.showErrorBox('Unhandled Error', `A critical error occurred: ${error?.message || 'Unknown error'}\n\nThe application might need to close.`);
    // Consider whether to force quit or allow potential recovery attempts
    // app.quit(); // Force quit might be necessary depending on the error
});
// --- End Global Error Handlers ---
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;
let db = null; // Define db instance at higher scope, initialize to null
// Remove old model/service instance variables
// let contentModel: ContentModel | null = null;
// let bookmarksService: BookmarksService | null = null;
let objectModel = null; // Define objectModel instance
let chunkSqlModel = null; // Define chunkSqlModel instance
let notebookModel = null; // Added declaration
let chromaVectorModel = null; // Define chromaVectorModel instance
let chunkingService = null; // Define chunkingService instance
let embeddingSqlModel = null; // Added declaration
let chatModel = null; // Define chatModel instance
let langchainAgent = null; // Define langchainAgent instance
let chatService = null; // Define chatService instance
let sliceService = null; // Define sliceService instance
let notebookService = null; // Added declaration
let agentService = null; // Added declaration
let intentService = null; // Added declaration
let classicBrowserService = null; // Declare ClassicBrowserService instance
let profileAgent = null; // Declare ProfileAgent instance
let schedulerService = null; // Declare SchedulerService instance
// --- Function to Register All IPC Handlers ---
// Accept objectModel, chatService, sliceService, AND intentService
function registerAllIpcHandlers(objectModelInstance, chatServiceInstance, sliceServiceInstance, intentServiceInstance, // Added intentServiceInstance parameter
notebookServiceInstance, // Added notebookServiceInstance parameter
classicBrowserServiceInstance // Allow null
) {
    logger_1.logger.info('[Main Process] Registering IPC Handlers...');
    // Handle the get-app-version request
    electron_1.ipcMain.handle(ipcChannels_1.GET_APP_VERSION, () => {
        const version = electron_1.app.getVersion();
        logger_1.logger.debug(`[Main Process] IPC Handler: Returning app version: ${version}`);
        return version;
    });
    // Register other specific handlers
    (0, profile_1.registerProfileHandlers)(electron_1.ipcMain); // Updated to use registerProfileHandlers
    (0, activityLogHandlers_1.registerActivityLogHandler)(electron_1.ipcMain); // Register activity log handler
    // Pass objectModel to the bookmark handler
    (0, bookmarks_1.registerImportBookmarksHandler)(objectModelInstance);
    (0, saveTempFile_1.registerSaveTempFileHandler)();
    // Pass chatService to the chat handlers
    (0, getChatMessages_1.registerGetChatMessagesHandler)(chatServiceInstance); // Register the new handler
    (0, chatStreamHandler_1.registerChatStreamStartHandler)(chatServiceInstance); // Register the start handler
    (0, chatStreamHandler_1.registerChatStreamStopHandler)(chatServiceInstance); // Register the stop handler
    (0, getSliceDetails_1.registerGetSliceDetailsHandler)(sliceServiceInstance); // Register the slice details handler
    // registerStopChatStreamHandler(chatServiceInstance); // Comment out until implemented
    // Register the new intent handler, passing the actual IntentService instance
    (0, setIntentHandler_1.registerSetIntentHandler)(intentServiceInstance); // Use actual intentServiceInstance
    // Register Notebook and ChatSession specific handlers
    (0, notebookHandlers_1.registerNotebookIpcHandlers)(notebookServiceInstance);
    (0, chatSessionHandlers_1.registerChatSessionIpcHandlers)(notebookServiceInstance); // chat session handlers also use NotebookService for now
    // Register Storage Handlers
    (0, storageHandlers_1.registerStorageHandlers)(); // Added call to register storage handlers
    // Register To-Do Handlers
    (0, toDoHandlers_1.registerToDoHandlers)(electron_1.ipcMain);
    // Add future handlers here...
    // Register ClassicBrowser Handlers
    if (classicBrowserServiceInstance) {
        (0, classicBrowserInitView_1.registerClassicBrowserCreateHandler)(classicBrowserServiceInstance);
        (0, classicBrowserLoadUrl_1.registerClassicBrowserLoadUrlHandler)(classicBrowserServiceInstance);
        (0, classicBrowserNavigate_1.registerClassicBrowserNavigateHandler)(classicBrowserServiceInstance);
        (0, classicBrowserSetBounds_1.registerClassicBrowserSetBoundsHandler)(classicBrowserServiceInstance);
        (0, classicBrowserSetVisibility_1.registerClassicBrowserSetVisibilityHandler)(classicBrowserServiceInstance);
        (0, classicBrowserDestroy_1.registerClassicBrowserDestroyHandler)(classicBrowserServiceInstance);
        (0, classicBrowserRequestFocus_1.registerClassicBrowserRequestFocusHandler)(classicBrowserServiceInstance); // Register new handler
        logger_1.logger.info('[Main Process] ClassicBrowser IPC handlers registered.');
    }
    else {
        logger_1.logger.warn('[Main Process] ClassicBrowserService instance not available, skipping its IPC handler registration.');
    }
    logger_1.logger.info('[Main Process] IPC Handlers registered.');
}
// --- End IPC Handler Registration Function ---
function createWindow() {
    try {
        logger_1.logger.debug('[Main Process] Creating BrowserWindow...'); // Use debug
        // Create the browser window.
        mainWindow = new electron_1.BrowserWindow({
            width: 1200, // Start with a larger default size
            height: 800,
            backgroundColor: electron_1.nativeTheme.shouldUseDarkColors ? '#111110' : '#fdfdfc', // Respond to system dark mode
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
                preload: path_1.default.resolve(__dirname, 'preload.js'),
            },
        });
        logger_1.logger.debug('[Main Process] BrowserWindow created.'); // Use debug
        // Listen for load errors *before* trying to load
        mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
            logger_1.logger.error(`[Main Process] Failed to load URL: ${validatedURL}. Error: ${errorDescription} (Code: ${errorCode})`); // Use logger
        });
        // Determine the content to load based on the environment
        const isDev = process.env.NODE_ENV !== 'production';
        const openDevTools = process.env.OPEN_DEVTOOLS === 'true';
        if (isDev) {
            const nextDevServerUrl = process.env.NEXT_DEV_SERVER_URL || 'http://localhost:3000';
            logger_1.logger.info(`[Main Process] Attempting to load Development URL: ${nextDevServerUrl}`);
            mainWindow.loadURL(nextDevServerUrl)
                .then(() => {
                logger_1.logger.info(`[Main Process] Successfully loaded URL: ${nextDevServerUrl}`);
                if (openDevTools) {
                    mainWindow?.webContents.openDevTools();
                }
            })
                .catch((err) => {
                logger_1.logger.error('[Main Process] Error loading development URL:', err);
            });
        }
        else {
            const startUrl = url_1.default.format({
                pathname: path_1.default.join(__dirname, '../../src/out/index.html'),
                protocol: 'file:',
                slashes: true,
            });
            logger_1.logger.info(`[Main Process] Attempting to load Production Build: ${startUrl}`);
            mainWindow.loadURL(startUrl)
                .then(() => {
                logger_1.logger.info(`[Main Process] Successfully loaded URL: ${startUrl}`);
            })
                .catch((err) => {
                logger_1.logger.error('[Main Process] Error loading production URL:', err);
            });
        }
        // Emitted when the window is closed.
        mainWindow.on('closed', () => {
            // Dereference the window object, usually you would store windows
            // in an array if your app supports multi windows, this is the time
            // when you should delete the corresponding element.
            mainWindow = null;
            logger_1.logger.debug('[Main Process] Main window closed.'); // Use debug
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('[Main Process] CRITICAL: Error during createWindow:', errorMessage); // Use logger
        electron_1.dialog.showErrorBox('Application Startup Error', 'Failed to create the main application window.\n\nDetails: ' + errorMessage);
        electron_1.app.quit();
    }
}
// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
electron_1.app.whenReady().then(async () => {
    logger_1.logger.info('[Main Process] App ready.');
    // --- Initialize Database & Run Migrations ---
    try {
        // Initialize the database. Call initDb() WITHOUT arguments.
        // This will use getDbPath() internally to determine the path
        // AND, critically, it will set the global dbInstance in models/db.ts
        // because the 'dbPath' argument to initDb will be undefined.
        db = (0, db_1.initDb)();
        logger_1.logger.info(`[Main Process] Database initialized for path: ${db.name}`);
        logger_1.logger.info('[Main Process] Database handle initialized.');
        // Run migrations immediately after init, passing the instance
        logger_1.logger.info('[Main Process] Running database migrations...');
        (0, runMigrations_1.default)(db); // Pass the captured instance
        logger_1.logger.info('[Main Process] Database migrations completed.'); // Adjusted log
        // Enable auto-vacuum for potential space saving
        try {
            db.pragma('auto_vacuum = FULL');
            // Optionally run VACUUM immediately if needed, usually not necessary just after setting
            // db.exec('VACUUM;'); 
            logger_1.logger.info('[Main Process] Set PRAGMA auto_vacuum = FULL on database.');
        }
        catch (pragmaError) {
            logger_1.logger.warn('[Main Process] Failed to set PRAGMA auto_vacuum:', pragmaError);
        }
        // --- Instantiate Models --- 
        // Instantiate ObjectModel here, assign to module-level variable
        objectModel = new ObjectModel_1.ObjectModel(db);
        logger_1.logger.info('[Main Process] ObjectModel instantiated.');
        // Instantiate ChunkSqlModel
        chunkSqlModel = new ChunkModel_1.ChunkSqlModel(db);
        logger_1.logger.info('[Main Process] ChunkSqlModel instantiated.');
        // Instantiate NotebookModel
        notebookModel = new NotebookModel_1.NotebookModel(db); // Added instantiation
        logger_1.logger.info('[Main Process] NotebookModel instantiated.');
        // Instantiate EmbeddingSqlModel
        embeddingSqlModel = new EmbeddingModel_1.EmbeddingSqlModel(db); // Added instantiation
        logger_1.logger.info('[Main Process] EmbeddingSqlModel instantiated.');
        // Instantiate ChromaVectorModel (no longer assuming simple constructor)
        chromaVectorModel = new ChromaVectorModel_1.ChromaVectorModel();
        logger_1.logger.info('[Main Process] ChromaVectorModel instantiated.');
        // Initialize ChromaVectorModel connection AFTER DB is ready but BEFORE dependent services/agents
        try {
            logger_1.logger.info('[Main Process] Initializing ChromaVectorModel connection...');
            await chromaVectorModel.initialize(); // Wait for connection/setup
            logger_1.logger.info('[Main Process] ChromaVectorModel connection initialized successfully.');
        }
        catch (chromaInitError) {
            logger_1.logger.error('[Main Process] CRITICAL: ChromaVectorModel initialization failed. Chat/Embedding features may not work.', chromaInitError);
            // Decide if this is fatal. For now, log error and continue, but features will likely fail.
            // If it MUST succeed: 
            // dialog.showErrorBox('Vector Store Error', 'Failed to connect to Chroma vector store.');
            // app.quit();
            // return;
        }
        // Instantiate ChatModel
        chatModel = new ChatModel_1.ChatModel(db);
        logger_1.logger.info('[Main Process] ChatModel instantiated.');
        // --- Instantiate Services --- 
        // Initialize the ChunkingService with DB and vector store instances
        // Make sure chromaVectorModel is initialized before passing
        if (!chromaVectorModel?.isReady()) { // Check if Chroma init succeeded
            logger_1.logger.error("[Main Process] Cannot instantiate ChunkingService: ChromaVectorModel not ready.");
            // Handle appropriately - maybe skip chunking service or throw fatal error
        }
        else if (!embeddingSqlModel) { // Check if embeddingSqlModel is initialized
            logger_1.logger.error("[Main Process] Cannot instantiate ChunkingService: EmbeddingSqlModel not ready.");
        }
        else {
            chunkingService = (0, ChunkingService_1.createChunkingService)(db, chromaVectorModel, undefined, embeddingSqlModel); // Pass embeddingSqlModel
            logger_1.logger.info('[Main Process] ChunkingService instantiated.');
        }
        // Instantiate LangchainAgent (requires vector and chat models)
        // Ensure chromaVectorModel is ready and chatModel is non-null before proceeding
        if (!chromaVectorModel?.isReady() || !chatModel) {
            throw new Error("Cannot instantiate LangchainAgent: Required models (Chroma/Chat) not initialized or ready.");
        }
        langchainAgent = new LangchainAgent_1.LangchainAgent(chromaVectorModel, chatModel);
        logger_1.logger.info('[Main Process] LangchainAgent instantiated.');
        // Instantiate ChatService (requires langchainAgent and chatModel)
        if (!langchainAgent || !chatModel) { // Check for chatModel as well
            throw new Error("Cannot instantiate ChatService: LangchainAgent or ChatModel not initialized.");
        }
        chatService = new ChatService_1.ChatService(langchainAgent, chatModel);
        logger_1.logger.info('[Main Process] ChatService instantiated.');
        // Instantiate SliceService (requires chunkSqlModel and objectModel)
        if (!chunkSqlModel || !objectModel) {
            throw new Error("Cannot instantiate SliceService: Required models (ChunkSql/Object) not initialized.");
        }
        sliceService = new SliceService_1.SliceService(chunkSqlModel, objectModel);
        logger_1.logger.info('[Main Process] SliceService instantiated.');
        // Instantiate NotebookService
        if (!notebookModel || !objectModel || !chunkSqlModel || !chatModel || !db) {
            throw new Error("Cannot instantiate NotebookService: Required models or DB instance not initialized.");
        }
        notebookService = new NotebookService_1.NotebookService(notebookModel, objectModel, chunkSqlModel, chatModel, db);
        logger_1.logger.info('[Main Process] NotebookService instantiated.');
        // Instantiate AgentService
        if (!notebookService) {
            throw new Error("Cannot instantiate AgentService: Required service (NotebookService) not initialized.");
        }
        agentService = new AgentService_1.AgentService(notebookService);
        logger_1.logger.info('[Main Process] AgentService instantiated.');
        // Instantiate IntentService
        if (!notebookService || !agentService) {
            throw new Error("Cannot instantiate IntentService: Required services (NotebookService, AgentService) not initialized.");
        }
        intentService = new IntentService_1.IntentService(notebookService, agentService);
        logger_1.logger.info('[Main Process] IntentService instantiated.');
        // Instantiate ProfileAgent
        profileAgent = new ProfileAgent_1.ProfileAgent();
        logger_1.logger.info('[Main Process] ProfileAgent instantiated.');
        // Initialize SchedulerService and schedule profile synthesis tasks
        schedulerService = (0, SchedulerService_1.getSchedulerService)();
        logger_1.logger.info('[Main Process] SchedulerService instantiated.');
        // Schedule activity and task synthesis
        const activitySynthesisInterval = parseInt(process.env.ACTIVITY_SYNTHESIS_INTERVAL_MS || (60 * 60 * 1000).toString(), 10); // Default: 1 hour
        schedulerService.scheduleTask('activityAndTaskProfileSynthesis', activitySynthesisInterval, () => profileAgent.synthesizeProfileFromActivitiesAndTasks('default_user'), true // Run once on startup
        );
        logger_1.logger.info(`[Main Process] Profile synthesis from activities/tasks scheduled every ${activitySynthesisInterval / 1000 / 60} minutes.`);
        // Schedule content synthesis
        const contentSynthesisInterval = parseInt(process.env.CONTENT_SYNTHESIS_INTERVAL_MS || (8 * 60 * 60 * 1000).toString(), 10); // Default: 8 hours
        schedulerService.scheduleTask('contentProfileSynthesis', contentSynthesisInterval, () => profileAgent.synthesizeProfileFromContent('default_user'), false // Don't run immediately on startup
        );
        logger_1.logger.info(`[Main Process] Profile synthesis from content scheduled every ${contentSynthesisInterval / 1000 / 60 / 60} hours.`);
    }
    catch (dbError) {
        const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
        logger_1.logger.error('[Main Process] CRITICAL: Database initialization or migration failed. The application cannot start.', errorMessage);
        // Show error dialog and quit
        electron_1.dialog.showErrorBox('Database Error', 'Failed to initialize or migrate the database. The application cannot start.\n\nDetails: ' + errorMessage);
        electron_1.app.quit();
        return; // Prevent further execution
    }
    // --- End Database Initialization & Migrations ---
    createWindow(); // Create the window first
    // Explicitly check if mainWindow was created. If not, it's a fatal error.
    if (!mainWindow) {
        logger_1.logger.error('[Main Process] CRITICAL: mainWindow was not created successfully. Application cannot continue.');
        electron_1.dialog.showErrorBox('Application Startup Error', 'The main application window could not be created. The application will now exit.');
        electron_1.app.quit();
        return; // Prevent further execution
    }
    // Instantiate ClassicBrowserService AFTER mainWindow has been created and verified
    classicBrowserService = new ClassicBrowserService_1.ClassicBrowserService(mainWindow);
    logger_1.logger.info('[Main Process] ClassicBrowserService instantiated.');
    // --- Re-queue Stale/Missing Ingestion Jobs (Using ObjectModel) ---
    logger_1.logger.info('[Main Process] Checking for stale or missing ingestion jobs...');
    // Check if objectModel was initialized before proceeding
    if (!objectModel) {
        logger_1.logger.error("[Main Process] Cannot check for stale jobs: ObjectModel not initialized.");
    }
    else {
        // Assign to a new const within this block where it's known to be non-null
        const nonNullObjectModel = objectModel;
        try {
            // Find objects that are 'new' or in an 'error' state
            // Adjust statuses as needed (e.g., add 'fetching', 'parsing' if those can get stuck)
            const statusesToRequeue = ['new', 'error'];
            const jobsToRequeue = await nonNullObjectModel.findByStatus(statusesToRequeue);
            if (jobsToRequeue.length > 0) {
                logger_1.logger.info(`[Main Process] Found ${jobsToRequeue.length} objects in states [${statusesToRequeue.join(', ')}] to potentially re-queue.`);
                for (const job of jobsToRequeue) {
                    if (job.source_uri) {
                        logger_1.logger.debug(`[Main Process] Re-queuing object ${job.id} with URI ${job.source_uri}`);
                        // Call directly, don't collect promises if not awaiting
                        void (0, ingestionQueue_1.queueForContentIngestion)(job.id, job.source_uri, nonNullObjectModel);
                    }
                    else {
                        logger_1.logger.warn(`[Main Process] Skipping re-queue for object ${job.id} due to missing source_uri.`);
                    }
                }
                // Removed promise collection and await
                logger_1.logger.info(`[Main Process] Finished adding ${jobsToRequeue.length} objects to the ingestion queue.`);
            }
            else {
                logger_1.logger.info('[Main Process] No objects found in states needing re-queuing.');
            }
        }
        catch (queueError) {
            logger_1.logger.error('[Main Process] Failed to query or re-queue stale/missing ingestion jobs:', queueError);
            // Continue startup even if re-queuing fails, but log the error
        }
    }
    // --- End Re-queue Stale/Missing Ingestion Jobs ---
    // --- Start Background Services ---
    if (chunkingService) {
        // Start the ChunkingService to begin processing objects with 'parsed' status
        logger_1.logger.info('[Main Process] Starting ChunkingService...');
        chunkingService.start();
        logger_1.logger.info('[Main Process] ChunkingService started.');
    }
    else {
        logger_1.logger.error('[Main Process] Cannot start ChunkingService: not initialized.');
    }
    // --- End Start Background Services ---
    // --- Register IPC Handlers ---
    if (objectModel && chatService && sliceService && intentService && notebookService && db) { // Removed classicBrowserService from check
        registerAllIpcHandlers(objectModel, chatService, sliceService, intentService, notebookService, classicBrowserService);
    }
    else {
        logger_1.logger.error('[Main Process] Cannot register IPC handlers: Required models/services or DB not initialized.'); // Simplified error message
    }
    // --- End IPC Handler Registration ---
    electron_1.app.on('activate', () => {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            logger_1.logger.info('[Main Process] App activated, creating new window.'); // Use logger
            createWindow();
        }
    });
}).catch((error) => {
    logger_1.logger.error('[Main Process] Error during app.whenReady:', error);
});
// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        logger_1.logger.info('[Main Process] All windows closed, quitting app.'); // Use logger
        electron_1.app.quit();
    }
    else {
        logger_1.logger.info('[Main Process] All windows closed (macOS), app remains active.'); // Use logger
    }
});
// Add handler to close DB before quitting
// Define a helper function to handle the final quit logic
async function finalQuitSteps() {
    logger_1.logger.info('[Main Process] Performing final quit steps.');
    // Close the database connection
    try {
        if (db && db.open) {
            logger_1.logger.info('[Main Process] Closing database connection...');
            db.close();
            logger_1.logger.info('[Main Process] Database connection closed.');
        }
    }
    catch (error) {
        logger_1.logger.error('[Main Process] Error closing database:', error);
    }
    logger_1.logger.info('[Main Process] Exiting application.');
    electron_1.app.quit();
}
electron_1.app.on('before-quit', async (event) => {
    logger_1.logger.info('[Main Process] Before quit event received.');
    // Prevent the app from quitting immediately to allow cleanup
    event.preventDefault();
    // Destroy all browser views before other cleanup
    if (classicBrowserService) {
        logger_1.logger.info('[Main Process] Destroying all ClassicBrowser views before quit...');
        await classicBrowserService.destroyAllBrowserViews();
        logger_1.logger.info('[Main Process] All ClassicBrowser views destroyed.');
    }
    // Stop SchedulerService tasks before other cleanup
    if (schedulerService) {
        logger_1.logger.info('[Main Process] Stopping SchedulerService tasks...');
        await schedulerService.stopAllTasks();
        logger_1.logger.info('[Main Process] SchedulerService tasks stopped.');
    }
    // Stop the ChunkingService gracefully first
    if (chunkingService?.isRunning()) {
        logger_1.logger.info('[Main Process] Stopping ChunkingService...');
        await chunkingService.stop(); // Ensure this completes
        logger_1.logger.info('[Main Process] ChunkingService stopped successfully.');
    }
    else {
        logger_1.logger.info('[Main Process] ChunkingService not running or not initialized.');
    }
    // Check if mainWindow exists and is not destroyed
    if (mainWindow && !mainWindow.isDestroyed()) {
        logger_1.logger.info('[Main Process] Requesting renderer to flush stores...');
        mainWindow.webContents.send(ipcChannels_1.MAIN_REQUEST_RENDERER_FLUSH);
        const flushTimeoutDuration = 5000; // 5 seconds
        let flushTimeoutId = null;
        const onFlushComplete = () => {
            if (flushTimeoutId) {
                clearTimeout(flushTimeoutId);
                flushTimeoutId = null;
            }
            logger_1.logger.info('[Main Process] Renderer flush complete or timed out. Proceeding with final quit steps.');
            electron_1.ipcMain.removeListener(ipcChannels_1.RENDERER_FLUSH_COMPLETE, onFlushComplete); // Clean up listener
            finalQuitSteps();
        };
        electron_1.ipcMain.once(ipcChannels_1.RENDERER_FLUSH_COMPLETE, onFlushComplete);
        flushTimeoutId = setTimeout(() => {
            logger_1.logger.warn(`[Main Process] Timeout (${flushTimeoutDuration}ms) waiting for renderer flush. Forcing quit sequence.`);
            onFlushComplete(); // Proceed to quit even if renderer didn't respond
        }, flushTimeoutDuration);
    }
    else {
        logger_1.logger.info('[Main Process] No main window available or already destroyed. Skipping renderer flush. Proceeding with final quit steps.');
        finalQuitSteps();
    }
});
// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
logger_1.logger.info('[Main Process] Main script loaded.'); // Use logger
//# sourceMappingURL=main.js.map