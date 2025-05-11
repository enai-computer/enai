"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Import channel constants and types from shared
const ipcChannels_1 = require("../shared/ipcChannels");
console.log('[Preload Script] Loading...');
// Define the API structure that will be exposed to the renderer
// This should match the IAppAPI interface defined in shared/types.d.ts
const api = {
    // Example function structure (uncomment and adapt when needed):
    /*
    exampleAction: (args: ExampleType): Promise<any> => {
      console.log('[Preload Script] Calling exampleAction via IPC');
      return ipcRenderer.invoke(CHANNEL_NAME_EXAMPLE, args);
    },
    */
    // --- Add actual API functions here as features are implemented ---
    // Simple example to confirm preload is working
    getAppVersion: () => {
        console.log('[Preload Script] Requesting app version via IPC');
        // We'll need to create a handler for this in main.ts later
        return electron_1.ipcRenderer.invoke('get-app-version'); // Note: This uses a string literal, should use GET_APP_VERSION constant
    },
    getProfile: () => {
        console.log('[Preload Script] Requesting profile via IPC');
        return electron_1.ipcRenderer.invoke(ipcChannels_1.PROFILE_GET);
    },
    // Add importBookmarks function
    importBookmarks: (filePath) => {
        console.log('[Preload Script] Invoking bookmarks import via IPC');
        return electron_1.ipcRenderer.invoke(ipcChannels_1.BOOKMARKS_IMPORT, filePath);
    },
    // Add saveTempFile function
    saveTempFile: (fileName, data) => {
        console.log('[Preload Script] Invoking save temp file via IPC');
        // Pass data directly; IPC handles serialization of Uint8Array/Buffer
        return electron_1.ipcRenderer.invoke(ipcChannels_1.FILE_SAVE_TEMP, { fileName, data });
    },
    // Add listener for bookmark progress
    onBookmarksProgress: (callback) => {
        console.log('[Preload Script] Setting up listener for', ipcChannels_1.BOOKMARKS_PROGRESS);
        const listener = (_event, event) => {
            // Basic validation of received data structure could be added here
            // console.debug('[Preload Script] Received bookmark progress:', event);
            callback(event);
        };
        electron_1.ipcRenderer.on(ipcChannels_1.BOOKMARKS_PROGRESS, listener);
        // Return a function to remove this specific listener
        return () => {
            console.log('[Preload Script] Removing listener for', ipcChannels_1.BOOKMARKS_PROGRESS);
            electron_1.ipcRenderer.removeListener(ipcChannels_1.BOOKMARKS_PROGRESS, listener);
        };
    },
    // --- Chat Streaming --- 
    startChatStream: (sessionId, question) => {
        if (!sessionId || !question) {
            console.error('[Preload Script] startChatStream called with invalid sessionId or question.');
            return;
        }
        console.log(`[Preload Script] Sending CHAT_STREAM_START for session: ${sessionId}, question: "${question.substring(0, 30)}..."`);
        electron_1.ipcRenderer.send(ipcChannels_1.CHAT_STREAM_START, { sessionId, question });
    },
    stopChatStream: () => {
        console.log(`[Preload Script] Sending CHAT_STREAM_STOP`);
        electron_1.ipcRenderer.send(ipcChannels_1.CHAT_STREAM_STOP);
    },
    // Listener for incoming chat chunks (Main -> Renderer)
    onChatChunk: (callback) => {
        const listener = (_event, chunk) => callback(chunk);
        electron_1.ipcRenderer.on(ipcChannels_1.ON_CHAT_RESPONSE_CHUNK, listener);
        return () => electron_1.ipcRenderer.removeListener(ipcChannels_1.ON_CHAT_RESPONSE_CHUNK, listener);
    },
    // Listener for stream end signal (Main -> Renderer)
    onChatStreamEnd: (callback) => {
        const listener = (_event, result) => callback(result);
        electron_1.ipcRenderer.on(ipcChannels_1.ON_CHAT_STREAM_END, listener);
        return () => electron_1.ipcRenderer.removeListener(ipcChannels_1.ON_CHAT_STREAM_END, listener);
    },
    // Listener for stream error signal (Main -> Renderer)
    onChatStreamError: (callback) => {
        const listener = (_event, errorMessage) => callback(errorMessage);
        electron_1.ipcRenderer.on(ipcChannels_1.ON_CHAT_STREAM_ERROR, listener);
        return () => electron_1.ipcRenderer.removeListener(ipcChannels_1.ON_CHAT_STREAM_ERROR, listener);
    },
    // --- End Chat Streaming ---
    // --- Add Chat Message Retrieval ---
    getMessages: (sessionId, limit, beforeTimestamp) => {
        console.log(`[Preload Script] Invoking getMessages for session: ${sessionId}, limit: ${limit}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.CHAT_GET_MESSAGES, { sessionId, limit, beforeTimestamp });
    },
    // --- Add Slice Detail Retrieval ---
    getSliceDetails: (chunkIds) => {
        console.log(`[Preload Script] Invoking getSliceDetails for ${chunkIds.length} IDs: [${chunkIds.slice(0, 5).join(', ')}]...`);
        // Basic input validation
        if (!Array.isArray(chunkIds) || chunkIds.some(id => typeof id !== 'number')) {
            console.error('[Preload Script] getSliceDetails called with invalid input (must be array of numbers).');
            // Return a rejected promise for invalid input
            return Promise.reject(new Error('Invalid input: chunkIds must be an array of numbers.'));
        }
        return electron_1.ipcRenderer.invoke(ipcChannels_1.GET_SLICE_DETAILS, chunkIds);
    },
    // --- Intent Handling ---
    setIntent: (payload) => {
        console.log('[Preload Script] Sending SET_INTENT with payload:', payload.intentText.substring(0, 50) + "...");
        // Assuming setIntent is an invoke call for potential acknowledgement, though void promise suggests send might also be fine.
        // Sticking to invoke as per plan (Promise<void> can be an ack from handler)
        return electron_1.ipcRenderer.invoke(ipcChannels_1.SET_INTENT, payload);
    },
    onIntentResult: (callback) => {
        console.log('[Preload Script] Setting up listener for ON_INTENT_RESULT');
        const listener = (_event, result) => {
            // console.debug('[Preload Script] Received intent result:', result);
            callback(result);
        };
        electron_1.ipcRenderer.on(ipcChannels_1.ON_INTENT_RESULT, listener);
        return () => {
            console.log('[Preload Script] Removing listener for ON_INTENT_RESULT');
            electron_1.ipcRenderer.removeListener(ipcChannels_1.ON_INTENT_RESULT, listener);
        };
    },
    // --- Notebook Functions ---
    createNotebook: (params) => {
        console.log(`[Preload Script] Invoking ${ipcChannels_1.NOTEBOOK_CREATE}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.NOTEBOOK_CREATE, params);
    },
    getNotebookById: (id) => {
        console.log(`[Preload Script] Invoking ${ipcChannels_1.NOTEBOOK_GET_BY_ID} for ID: ${id}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.NOTEBOOK_GET_BY_ID, id);
    },
    getAllNotebooks: () => {
        console.log(`[Preload Script] Invoking ${ipcChannels_1.NOTEBOOK_GET_ALL}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.NOTEBOOK_GET_ALL);
    },
    updateNotebook: (params) => {
        console.log(`[Preload Script] Invoking ${ipcChannels_1.NOTEBOOK_UPDATE} for ID: ${params.id}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.NOTEBOOK_UPDATE, params);
    },
    deleteNotebook: (id) => {
        console.log(`[Preload Script] Invoking ${ipcChannels_1.NOTEBOOK_DELETE} for ID: ${id}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.NOTEBOOK_DELETE, id);
    },
    getChunksForNotebook: (notebookId) => {
        console.log(`[Preload Script] Invoking ${ipcChannels_1.NOTEBOOK_GET_CHUNKS} for notebook ID: ${notebookId}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.NOTEBOOK_GET_CHUNKS, notebookId);
    },
    // --- Chat Session Functions (within Notebooks) ---
    createChatInNotebook: (params) => {
        console.log(`[Preload Script] Invoking ${ipcChannels_1.CHAT_SESSION_CREATE_IN_NOTEBOOK} for notebook ID: ${params.notebookId}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.CHAT_SESSION_CREATE_IN_NOTEBOOK, params);
    },
    listChatsForNotebook: (notebookId) => {
        console.log(`[Preload Script] Invoking ${ipcChannels_1.CHAT_SESSION_LIST_FOR_NOTEBOOK} for notebook ID: ${notebookId}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.CHAT_SESSION_LIST_FOR_NOTEBOOK, notebookId);
    },
    transferChatToNotebook: (params) => {
        console.log(`[Preload Script] Invoking ${ipcChannels_1.CHAT_SESSION_TRANSFER_TO_NOTEBOOK} for session ID: ${params.sessionId}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.CHAT_SESSION_TRANSFER_TO_NOTEBOOK, params);
    },
    // --- Zustand Store Persistence --- 
    storeGet: (key) => {
        console.log(`[Preload Script] Invoking ${ipcChannels_1.STORE_GET} for key: ${key}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.STORE_GET, key);
    },
    storeSet: (key, value) => {
        console.log(`[Preload Script] Invoking ${ipcChannels_1.STORE_SET} for key: ${key}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.STORE_SET, { key, value });
    },
    storeRemove: (key) => {
        console.log(`[Preload Script] Invoking ${ipcChannels_1.STORE_REMOVE} for key: ${key}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.STORE_REMOVE, key);
    },
    // Listen for a flush request from the main process
    onMainRequestFlush: (callback) => {
        const listener = async (_event) => {
            console.log('[Preload Script] Received MAIN_REQUEST_RENDERER_FLUSH');
            try {
                await callback();
                console.log('[Preload Script] Renderer flush callback completed. Sending RENDERER_FLUSH_COMPLETE.');
                electron_1.ipcRenderer.send(ipcChannels_1.RENDERER_FLUSH_COMPLETE);
            }
            catch (error) {
                console.error('[Preload Script] Error during renderer flush callback:', error);
                // Still send complete, or an error signal? For now, send complete to prevent main from hanging.
                // Consider adding a RENDERER_FLUSH_ERROR if main needs to know.
                electron_1.ipcRenderer.send(ipcChannels_1.RENDERER_FLUSH_COMPLETE);
            }
        };
        electron_1.ipcRenderer.on(ipcChannels_1.MAIN_REQUEST_RENDERER_FLUSH, listener);
        // Note: This type of listener typically doesn't return a cleanup function in IAppAPI 
        // because it's a global handler for app lifecycle. If multiple registrations 
        // were possible and needed cleanup, the API would need to change to return () => void.
    },
    // --- Classic Browser API --- 
    classicBrowserCreate: (windowId, bounds, initialUrl) => {
        console.log(`[Preload Script] Creating ClassicBrowser view ${windowId}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.CLASSIC_BROWSER_CREATE, { windowId, bounds, initialUrl });
    },
    classicBrowserNavigate: (windowId, action, url) => {
        console.log(`[Preload Script] Invoking classicBrowserNavigate for window ${windowId}, action: ${action}, url: ${url}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.CLASSIC_BROWSER_NAVIGATE, { windowId, action, url });
    },
    browserSetBounds: (windowId, bounds, isVisible) => {
        // This may be called very frequently during window move/resize. Consider logging only on error or specific conditions.
        // console.log(`[Preload Script] Syncing ClassicBrowser view ${windowId}`); 
        return electron_1.ipcRenderer.invoke(ipcChannels_1.BROWSER_BOUNDS, { windowId, bounds, isVisible });
    },
    classicBrowserDestroy: (windowId) => {
        console.log(`[Preload Script] Destroying ClassicBrowser view ${windowId}`);
        return electron_1.ipcRenderer.invoke(ipcChannels_1.CLASSIC_BROWSER_DESTROY, { windowId });
    },
    onClassicBrowserState: (callback) => {
        console.log('[Preload Script] Setting up listener for ON_CLASSIC_BROWSER_STATE');
        const listener = (_event, update) => {
            callback(update);
        };
        electron_1.ipcRenderer.on(ipcChannels_1.ON_CLASSIC_BROWSER_STATE, listener);
        return () => {
            console.log('[Preload Script] Removing listener for ON_CLASSIC_BROWSER_STATE');
            electron_1.ipcRenderer.removeListener(ipcChannels_1.ON_CLASSIC_BROWSER_STATE, listener);
        };
    },
};
// Securely expose the defined API to the renderer process
try {
    // Use 'satisfies' to check the api object against the interface
    electron_1.contextBridge.exposeInMainWorld('api', api);
    console.log('[Preload Script] API exposed successfully.');
}
catch (error) {
    console.error('[Preload Script] Failed to expose API:', error);
}
// Type definition for the API (to be placed in shared/types.d.ts)
/*
declare global {
  interface Window {
    api: IAppAPI;
  }
}

export interface IAppAPI {
  // Signatures for the methods exposed above
  getAppVersion: () => Promise<string>;
  // exampleAction: (args: ExampleType) => Promise<any>;
  // ... other method signatures
}
*/
//# sourceMappingURL=preload.js.map