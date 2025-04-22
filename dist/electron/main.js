"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Explicitly load .env from the project root
const envPath = path_1.default.resolve(__dirname, '../../.env');
// __dirname is dist/electron, so ../../ goes to project root
dotenv_1.default.config({ path: envPath });
// ADDED: Log env vars immediately after dotenv.config()
const logger_1 = require("../utils/logger"); // Import logger here if not already imported globally
logger_1.logger.info(`[dotenv] Loaded .env file from: ${envPath}`);
logger_1.logger.info(`[dotenv] BROWSERBASE_API_KEY loaded: ${!!process.env.BROWSERBASE_API_KEY}`); // Log true/false
logger_1.logger.info(`[dotenv] BROWSERBASE_PROJECT_ID loaded: ${!!process.env.BROWSERBASE_PROJECT_ID}`); // Log true/false
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
const db_1 = __importStar(require("../models/db")); // Import default getDb and named initDb
const runMigrations_1 = __importDefault(require("../models/runMigrations")); // Import migration runner - UNCOMMENT
const ContentModel = __importStar(require("../models/ContentModel"));
const ingestionQueue_1 = require("../services/ingestionQueue");
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;
// --- Function to Register All IPC Handlers ---
function registerAllIpcHandlers() {
    logger_1.logger.info('[Main Process] Registering IPC Handlers...');
    // Handle the get-app-version request
    electron_1.ipcMain.handle(ipcChannels_1.GET_APP_VERSION, () => {
        const version = electron_1.app.getVersion();
        logger_1.logger.debug(`[Main Process] IPC Handler: Returning app version: ${version}`); // Use debug
        return version;
    });
    // Register other specific handlers
    (0, profile_1.registerGetProfileHandler)();
    (0, bookmarks_1.registerImportBookmarksHandler)();
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
electron_1.app.whenReady().then(() => {
    logger_1.logger.info('[Main Process] App ready.');
    let dbPath;
    // --- Initialize Database & Run Migrations ---
    try {
        dbPath = path_1.default.join(electron_1.app.getPath('userData'), 'jeffers.db');
        logger_1.logger.info(`[Main Process] Initializing database at: ${dbPath}`);
        (0, db_1.initDb)(dbPath);
        logger_1.logger.info('[Main Process] Database handle initialized.');
        // Run migrations immediately after init
        logger_1.logger.info('[Main Process] Running database migrations...');
        (0, runMigrations_1.default)(); // Call the migration runner - UNCOMMENT (no dbPath needed if using getDb)
        logger_1.logger.info('[Main Process] Database migrations completed.'); // Adjusted log
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
    // --- Re-queue Stale/Missing Ingestion Jobs (Only after successful DB init/migration) ---
    logger_1.logger.info('[Main Process] Checking for stale or missing ingestion jobs...');
    try {
        // Query 1: Find jobs that were started but failed or timed out
        const staleStatuses = ['pending', 'timeout', 'fetch_error', 'http_error'];
        const staleJobs = ContentModel.findByStatuses(staleStatuses);
        const jobsToQueue = new Map(); // Use Map to avoid duplicates (bookmarkId -> url)
        if (staleJobs.length > 0) {
            logger_1.logger.info(`[Main Process] Found ${staleJobs.length} stale jobs. Adding to re-queue list...`);
            staleJobs.forEach(job => {
                if (job.source_url) {
                    jobsToQueue.set(job.bookmark_id, job.source_url);
                }
                else {
                    logger_1.logger.warn(`[Main Process] Skipping stale job for bookmark ${job.bookmark_id} due to missing source_url.`);
                }
            });
        }
        // Query 2: Find bookmarks that have no corresponding entry in the content table
        const db = (0, db_1.default)();
        const stmtMissing = db.prepare(`
        SELECT b.bookmark_id, b.url
        FROM bookmarks b
        LEFT JOIN content c ON b.bookmark_id = c.bookmark_id
        WHERE c.bookmark_id IS NULL
    `);
        // Type assertion: Expecting this structure
        const missingJobs = stmtMissing.all();
        if (missingJobs.length > 0) {
            logger_1.logger.info(`[Main Process] Found ${missingJobs.length} bookmarks missing content entries. Adding to queue list...`);
            missingJobs.forEach(job => {
                if (job.url) {
                    jobsToQueue.set(job.bookmark_id, job.url);
                }
                else {
                    logger_1.logger.warn(`[Main Process] Skipping missing job for bookmark ${job.bookmark_id} due to missing url in bookmarks table.`);
                }
            });
        }
        // Queue all unique jobs found
        if (jobsToQueue.size > 0) {
            logger_1.logger.info(`[Main Process] Re-queuing ${jobsToQueue.size} unique stale/missing jobs...`);
            jobsToQueue.forEach((url, bookmarkId) => {
                (0, ingestionQueue_1.queueForContentIngestion)(bookmarkId, url);
            });
        }
        else {
            logger_1.logger.info('[Main Process] No stale or missing ingestion jobs found that need re-queuing.');
        }
    }
    catch (queueError) {
        logger_1.logger.error('[Main Process] Failed to query or re-queue stale/missing ingestion jobs:', queueError);
        // Continue startup even if re-queuing fails, but log the error
    }
    // --- End Re-queue Stale/Missing Ingestion Jobs ---
    // --- Register IPC Handlers ---
    registerAllIpcHandlers(); // Call the extracted function
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
        const db = (0, db_1.default)();
        if (db && db.open) {
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