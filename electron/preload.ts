import { contextBridge, ipcRenderer } from 'electron';

// Import channel constants and types from shared
import {
    PROFILE_GET,
    BOOKMARKS_IMPORT,
    FILE_SAVE_TEMP,
    BOOKMARKS_PROGRESS,
    CHAT_STREAM_START,
    CHAT_STREAM_STOP,
    ON_CHAT_RESPONSE_CHUNK,
    ON_CHAT_STREAM_END,
    ON_CHAT_STREAM_ERROR,
    CHAT_GET_MESSAGES,
} from '../shared/ipcChannels';
// Import IChatMessage along with other types
import { IAppAPI, BookmarksProgressEvent, IChatMessage } from '../shared/types';

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

  // --- Chat Streaming --- 
  startChatStream: (sessionId: string, question: string): void => {
    if (!sessionId || !question) {
        console.error('[Preload Script] startChatStream called with invalid sessionId or question.');
        return;
    }
    console.log(`[Preload Script] Sending CHAT_STREAM_START for session: ${sessionId}, question: "${question.substring(0,30)}..."`);
    ipcRenderer.send(CHAT_STREAM_START, { sessionId, question });
  },

  stopChatStream: (): void => {
    console.log(`[Preload Script] Sending CHAT_STREAM_STOP`);
    ipcRenderer.send(CHAT_STREAM_STOP);
  },

  // Listener for incoming chat chunks (Main -> Renderer)
  onChatChunk: (callback: (chunk: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk);
    ipcRenderer.on(ON_CHAT_RESPONSE_CHUNK, listener);
    return () => ipcRenderer.removeListener(ON_CHAT_RESPONSE_CHUNK, listener);
  },

  // Listener for stream end signal (Main -> Renderer)
  onChatStreamEnd: (callback: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => callback();
    ipcRenderer.on(ON_CHAT_STREAM_END, listener);
    return () => ipcRenderer.removeListener(ON_CHAT_STREAM_END, listener);
  },

  // Listener for stream error signal (Main -> Renderer)
  onChatStreamError: (callback: (errorMessage: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, errorMessage: string) => callback(errorMessage);
    ipcRenderer.on(ON_CHAT_STREAM_ERROR, listener);
    return () => ipcRenderer.removeListener(ON_CHAT_STREAM_ERROR, listener);
  },

  // --- End Chat Streaming ---

  // --- Add Chat Message Retrieval ---
  getMessages: (sessionId: string, limit?: number, beforeTimestamp?: string): Promise<IChatMessage[]> => {
    console.log(`[Preload Script] Invoking getMessages for session: ${sessionId}, limit: ${limit}`);
    return ipcRenderer.invoke(CHAT_GET_MESSAGES, { sessionId, limit, beforeTimestamp });
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
