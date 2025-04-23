"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
// Import DB initialisation & cleanup
const db_1 = require("../models/db"); // Only import initDb, remove getDb
const runMigrations_1 = __importDefault(require("../models/runMigrations")); // Import migration runner - UNCOMMENT
// Import the new ObjectModel
const ObjectModel_1 = require("../models/ObjectModel");
// Remove old model/service imports
// import { ContentModel } from '../models/ContentModel';
// import { BookmarksService } from '../services/bookmarkService';
const ingestionQueue_1 = require("../services/ingestionQueue");
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
    electron_1.dialog.showErrorBox('Unhandled Error', `A critical error occurred: ${(error === null || error === void 0 ? void 0 : error.message) || 'Unknown error'}\n\nThe application might need to close.`);
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
// --- Function to Register All IPC Handlers ---
// Accept objectModel
function registerAllIpcHandlers(objectModelInstance) {
    logger_1.logger.info('[Main Process] Registering IPC Handlers...');
    // Handle the get-app-version request
    electron_1.ipcMain.handle(ipcChannels_1.GET_APP_VERSION, () => {
        const version = electron_1.app.getVersion();
        logger_1.logger.debug(`[Main Process] IPC Handler: Returning app version: ${version}`);
        return version;
    });
    // Register other specific handlers
    (0, profile_1.registerGetProfileHandler)();
    // Pass objectModel to the bookmark handler
    (0, bookmarks_1.registerImportBookmarksHandler)(objectModelInstance);
    (0, saveTempFile_1.registerSaveTempFileHandler)();
    // Add future handlers here...
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
        // Simple check, adjust if needed (e.g., using electron-is-dev)
        const isDev = process.env.NODE_ENV !== 'production';
        const openDevTools = process.env.OPEN_DEVTOOLS !== 'false'; // Check env var
        if (isDev) {
            // Load the Next.js development server URL
            // Ensure the NEXT_DEV_SERVER_URL env var is set (e.g., via package.json script or .env)
            const nextDevServerUrl = process.env.NEXT_DEV_SERVER_URL || 'http://localhost:3000';
            logger_1.logger.info(`[Main Process] Attempting to load Development URL: ${nextDevServerUrl}`); // Use logger
            // Use async/await for cleaner error handling with loadURL
            mainWindow.loadURL(nextDevServerUrl)
                .then(() => {
                logger_1.logger.info(`[Main Process] Successfully loaded URL: ${nextDevServerUrl}`); // Use logger
                // Open DevTools conditionally
                if (openDevTools) {
                    mainWindow === null || mainWindow === void 0 ? void 0 : mainWindow.webContents.openDevTools();
                }
            })
                .catch((err) => {
                logger_1.logger.error('[Main Process] Error loading development URL:', err); // Use logger
            });
        }
        else {
            // Load the production build output (static HTML file)
            const startUrl = url_1.default.format({
                // Assumes Next.js static export is in `src/out` relative to project root
                // Adjust the path based on your actual build output structure
                // `__dirname` is dist/electron, so we go up two levels to the project root
                pathname: path_1.default.join(__dirname, '../../src/out/index.html'),
                protocol: 'file:',
                slashes: true,
            });
            logger_1.logger.info(`[Main Process] Attempting to load Production Build: ${startUrl}`); // Use logger
            mainWindow.loadURL(startUrl)
                .then(() => {
                logger_1.logger.info(`[Main Process] Successfully loaded URL: ${startUrl}`); // Use logger
            })
                .catch((err) => {
                logger_1.logger.error('[Main Process] Error loading production URL:', err); // Use logger
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
        logger_1.logger.error('[Main Process] Error during createWindow:', error); // Use logger
    }
}
// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
electron_1.app.whenReady().then(async () => {
    logger_1.logger.info('[Main Process] App ready.');
    let dbPath;
    // let db: Database.Database; // Remove declaration from this scope
    // let contentModel: ContentModel; // Remove declaration from this scope
    // --- Initialize Database & Run Migrations ---
    try {
        dbPath = path_1.default.join(electron_1.app.getPath('userData'), 'jeffers.db');
        logger_1.logger.info(`[Main Process] Initializing database at: ${dbPath}`);
        db = (0, db_1.initDb)(dbPath); // Assign to the db instance in this scope
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
        // --- Instantiate Services --- 
        // No services dependent on old models left to instantiate here
        logger_1.logger.info('[Main Process] Core services instantiated (if any).');
    }
    catch (dbError) {
        logger_1.logger.error('[Main Process] CRITICAL: Database initialization or migration failed. The application cannot start.', dbError);
        // Show error dialog and quit
        electron_1.dialog.showErrorBox('Database Error', 'Failed to initialize or migrate the database. The application cannot start.\n\nDetails: ' + (dbError instanceof Error ? dbError.message : String(dbError)));
        electron_1.app.quit();
        return; // Prevent further execution
    }
    // --- End Database Initialization & Migrations ---
    createWindow();
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
    // --- Register IPC Handlers ---
    // Pass the instantiated objectModel
    if (objectModel) {
        registerAllIpcHandlers(objectModel);
    }
    else {
        // This should not happen if DB init succeeded
        logger_1.logger.error('[Main Process] Cannot register IPC handlers: ObjectModel not initialized.');
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
electron_1.app.on('before-quit', (event) => {
    logger_1.logger.info('[Main Process] Before quit event received.'); // Use logger
    try {
        // Use the imported getDb
        if (db && db.open) { // Use the db instance from the outer scope
            logger_1.logger.info('[Main Process] Closing database connection...'); // Use logger
            db.close();
            logger_1.logger.info('[Main Process] Database connection closed.'); // Use logger
        }
    }
    catch (error) {
        logger_1.logger.error('[Main Process] Error closing database:', error); // Use logger
    }
    // No preventDefault needed unless we want to abort quitting
});
// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
logger_1.logger.info('[Main Process] Main script loaded.'); // Use logger
//# sourceMappingURL=main.js.map