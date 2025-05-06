import { contextBridge, ipcRenderer } from 'electron';
import {
  type IpcRendererEvent,
} from 'electron';

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
    GET_SLICE_DETAILS,
    SET_INTENT,
    ON_INTENT_RESULT,
} from '../shared/ipcChannels';
// Import IChatMessage along with other types
import {
  IAppAPI,
  BookmarksProgressEvent,
  IChatMessage,
  SliceDetail,
  StructuredChatMessage,
  ChatMessageSourceMetadata,
  IntentPayload,
  IntentResultPayload,
} from '../shared/types';

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
  onChatStreamEnd: (callback: (result: { messageId: string; metadata: ChatMessageSourceMetadata | null }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: { messageId: string; metadata: ChatMessageSourceMetadata | null }) => callback(result);
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
  getMessages: (
    sessionId: string,
    limit?: number,
    beforeTimestamp?: string
  ): Promise<StructuredChatMessage[]> => {
    console.log(`[Preload Script] Invoking getMessages for session: ${sessionId}, limit: ${limit}`);
    return ipcRenderer.invoke(CHAT_GET_MESSAGES, { sessionId, limit, beforeTimestamp });
  },

  // --- Add Slice Detail Retrieval ---
  getSliceDetails: (chunkIds: number[]): Promise<SliceDetail[]> => {
      console.log(`[Preload Script] Invoking getSliceDetails for ${chunkIds.length} IDs: [${chunkIds.slice(0, 5).join(', ')}]...`);
      // Basic input validation
      if (!Array.isArray(chunkIds) || chunkIds.some(id => typeof id !== 'number')) {
          console.error('[Preload Script] getSliceDetails called with invalid input (must be array of numbers).');
          // Return a rejected promise for invalid input
          return Promise.reject(new Error('Invalid input: chunkIds must be an array of numbers.'));
      }
      return ipcRenderer.invoke(GET_SLICE_DETAILS, chunkIds);
  },

  // --- Intent Handling ---
  setIntent: (payload: IntentPayload): Promise<void> => {
    console.log('[Preload Script] Sending SET_INTENT with payload:', payload.intentText.substring(0, 50) + "...");
    // Assuming setIntent is an invoke call for potential acknowledgement, though void promise suggests send might also be fine.
    // Sticking to invoke as per plan (Promise<void> can be an ack from handler)
    return ipcRenderer.invoke(SET_INTENT, payload);
  },

  onIntentResult: (callback: (result: IntentResultPayload) => void): (() => void) => {
    console.log('[Preload Script] Setting up listener for ON_INTENT_RESULT');
    const listener = (_event: Electron.IpcRendererEvent, result: IntentResultPayload) => {
      // console.debug('[Preload Script] Received intent result:', result);
      callback(result);
    };
    ipcRenderer.on(ON_INTENT_RESULT, listener);
    return () => {
      console.log('[Preload Script] Removing listener for ON_INTENT_RESULT');
      ipcRenderer.removeListener(ON_INTENT_RESULT, listener);
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
