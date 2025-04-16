import { contextBridge, ipcRenderer } from 'electron';

// Import channel constants and types from shared once they exist
// import { /* CHANNEL_NAME_EXAMPLE */ } from '../shared/ipcChannels';
// import { /* ExampleType */ } from '../shared/types'; // Or types.d.ts

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
    return ipcRenderer.invoke('get-app-version');
  },

};

// Securely expose the defined API to the renderer process
try {
  contextBridge.exposeInMainWorld('api', api);
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
