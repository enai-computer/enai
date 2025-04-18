import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import url from 'url';
// Import the channel constant
import { GET_APP_VERSION } from '../shared/ipcChannels';
// Import IPC handler registration functions
import { registerGetProfileHandler } from './ipc/profile';
import { registerImportBookmarksHandler } from './ipc/bookmarks';
import { registerSaveTempFileHandler } from './ipc/saveTempFile';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow | null;

function createWindow() {
  try {
    console.log('[Main Process] Creating BrowserWindow...');
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
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    console.log('[Main Process] BrowserWindow created.');

    // Listen for load errors *before* trying to load
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error(`[Main Process] Failed to load URL: ${validatedURL}. Error: ${errorDescription} (Code: ${errorCode})`);
    });

    // Determine the content to load based on the environment
    // Simple check, adjust if needed (e.g., using electron-is-dev)
    const isDev = process.env.NODE_ENV !== 'production';

    if (isDev) {
      // Load the Next.js development server URL
      // Ensure the NEXT_DEV_SERVER_URL env var is set (e.g., via package.json script or .env)
      const nextDevServerUrl = process.env.NEXT_DEV_SERVER_URL || 'http://localhost:3000';
      console.log(`[Main Process] Attempting to load Development URL: ${nextDevServerUrl}`);
      // Use async/await for cleaner error handling with loadURL
      mainWindow.loadURL(nextDevServerUrl)
        .then(() => {
          console.log(`[Main Process] Successfully loaded URL: ${nextDevServerUrl}`);
          // Open the DevTools automatically *after* successful load in development
          mainWindow?.webContents.openDevTools();
        })
        .catch((err) => {
          console.error('[Main Process] Error loading URL:', err);
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
      console.log(`[Main Process] Attempting to load Production Build: ${startUrl}`);
      mainWindow.loadURL(startUrl)
        .then(() => {
            console.log(`[Main Process] Successfully loaded URL: ${startUrl}`);
        })
        .catch((err) => {
            console.error('[Main Process] Error loading production URL:', err);
        });
    }

    // Emitted when the window is closed.
    mainWindow.on('closed', () => {
      // Dereference the window object, usually you would store windows
      // in an array if your app supports multi windows, this is the time
      // when you should delete the corresponding element.
      mainWindow = null;
      console.log('[Main Process] Main window closed.');
    });

  } catch (error) {
      console.error('[Main Process] Error during createWindow:', error);
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  console.log('[Main Process] App ready.');
  createWindow();

  // --- Register IPC Handlers ---
  console.log('[Main Process] Registering IPC Handlers...');

  // Handle the get-app-version request
  ipcMain.handle(GET_APP_VERSION, () => {
    const version = app.getVersion();
    console.log(`[Main Process] IPC Handler: Returning app version: ${version}`);
    return version;
  });

  // Register profile handler
  registerGetProfileHandler();

  // Register bookmarks handler
  registerImportBookmarksHandler();

  // Register temp file handler
  registerSaveTempFileHandler();

  // Add other handlers here as needed...

  console.log('[Main Process] IPC Handlers registered.');
  // --- End IPC Handler Registration ---

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      console.log('[Main Process] App activated, creating new window.');
      createWindow();
    }
  });
}).catch((error) => {
  console.error('[Main Process] Error during app.whenReady:', error);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    console.log('[Main Process] All windows closed, quitting app.');
    app.quit();
  } else {
    console.log('[Main Process] All windows closed (macOS), app remains active.');
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
console.log('[Main Process] Main script loaded.');
