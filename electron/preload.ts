import { contextBridge, ipcRenderer } from 'electron';

// Import channel constants and types from shared
import { PROFILE_GET, BOOKMARKS_IMPORT, FILE_SAVE_TEMP, BOOKMARKS_PROGRESS } from '../shared/ipcChannels';
import { IAppAPI, BookmarksProgressEvent } from '../shared/types'; // Assuming IAppAPI is in shared/types.d.ts

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
  getAppVersion: (): Promise<string> => {
    console.log('[Preload Script] Requesting app version via IPC');
    // We'll need to create a handler for this in main.ts later
    return ipcRenderer.invoke('get-app-version'); // Note: This uses a string literal, should use GET_APP_VERSION constant
  },

  getProfile: (): Promise<{ name?: string }> => {
    console.log('[Preload Script] Requesting profile via IPC');
    return ipcRenderer.invoke(PROFILE_GET);
  },

  // Add importBookmarks function
  importBookmarks: (filePath: string): Promise<number> => {
    console.log('[Preload Script] Invoking bookmarks import via IPC');
    return ipcRenderer.invoke(BOOKMARKS_IMPORT, filePath);
  },

  // Add saveTempFile function
  saveTempFile: (fileName: string, data: Uint8Array): Promise<string> => {
    console.log('[Preload Script] Invoking save temp file via IPC');
    // Pass data directly; IPC handles serialization of Uint8Array/Buffer
    return ipcRenderer.invoke(FILE_SAVE_TEMP, { fileName, data });
  },

  // Add listener for bookmark progress
  onBookmarksProgress: (callback: (event: BookmarksProgressEvent) => void) => {
    console.log('[Preload Script] Setting up listener for', BOOKMARKS_PROGRESS);
    const listener = (_event: Electron.IpcRendererEvent, event: BookmarksProgressEvent) => {
      // Basic validation of received data structure could be added here
      // console.debug('[Preload Script] Received bookmark progress:', event);
      callback(event);
    };
    ipcRenderer.on(BOOKMARKS_PROGRESS, listener);
    // Return a function to remove this specific listener
    return () => {
      console.log('[Preload Script] Removing listener for', BOOKMARKS_PROGRESS);
      ipcRenderer.removeListener(BOOKMARKS_PROGRESS, listener);
    };
  },
};

// Securely expose the defined API to the renderer process
try {
  // Use 'satisfies' to check the api object against the interface
  contextBridge.exposeInMainWorld('api', api satisfies IAppAPI);
  console.log('[Preload Script] API exposed successfully.');
} catch (error) {
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
