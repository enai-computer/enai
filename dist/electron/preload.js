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