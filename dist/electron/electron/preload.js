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
        const listener = (_event) => callback();
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