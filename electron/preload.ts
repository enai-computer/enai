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
    // Notebook and Chat Session channels
    NOTEBOOK_CREATE,
    NOTEBOOK_GET_BY_ID,
    NOTEBOOK_GET_ALL,
    NOTEBOOK_UPDATE,
    NOTEBOOK_DELETE,
    NOTEBOOK_GET_CHUNKS,
    CHAT_SESSION_CREATE_IN_NOTEBOOK,
    CHAT_SESSION_LIST_FOR_NOTEBOOK,
    CHAT_SESSION_TRANSFER_TO_NOTEBOOK,
    // Store persistence channels
    STORE_GET,
    STORE_SET,
    STORE_REMOVE,
    // Add new channels for flushing
    MAIN_REQUEST_RENDERER_FLUSH,
    RENDERER_FLUSH_COMPLETE,
    // Updated Classic Browser channel imports
    CLASSIC_BROWSER_CREATE, // Renamed from CLASSIC_BROWSER_INIT_VIEW
    CLASSIC_BROWSER_NAVIGATE,
    BROWSER_BOUNDS, // Renamed from CLASSIC_BROWSER_SYNC_VIEW
    ON_CLASSIC_BROWSER_STATE, // Renamed from ON_CLASSIC_BROWSER_STATE_UPDATE
    CLASSIC_BROWSER_DESTROY,
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
  NotebookRecord,
  ObjectChunk,
  IChatSession,
  ClassicBrowserPayload,
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

  // --- Notebook Functions ---
  createNotebook: (params: { title: string, description?: string | null }): Promise<NotebookRecord> => {
    console.log(`[Preload Script] Invoking ${NOTEBOOK_CREATE}`);
    return ipcRenderer.invoke(NOTEBOOK_CREATE, params);
  },
  getNotebookById: (id: string): Promise<NotebookRecord | null> => {
    console.log(`[Preload Script] Invoking ${NOTEBOOK_GET_BY_ID} for ID: ${id}`);
    return ipcRenderer.invoke(NOTEBOOK_GET_BY_ID, id);
  },
  getAllNotebooks: (): Promise<NotebookRecord[]> => {
    console.log(`[Preload Script] Invoking ${NOTEBOOK_GET_ALL}`);
    return ipcRenderer.invoke(NOTEBOOK_GET_ALL);
  },
  updateNotebook: (params: { id: string, data: { title?: string, description?: string | null } }): Promise<NotebookRecord | null> => {
    console.log(`[Preload Script] Invoking ${NOTEBOOK_UPDATE} for ID: ${params.id}`);
    return ipcRenderer.invoke(NOTEBOOK_UPDATE, params);
  },
  deleteNotebook: (id: string): Promise<boolean> => {
    console.log(`[Preload Script] Invoking ${NOTEBOOK_DELETE} for ID: ${id}`);
    return ipcRenderer.invoke(NOTEBOOK_DELETE, id);
  },
  getChunksForNotebook: (notebookId: string): Promise<ObjectChunk[]> => {
    console.log(`[Preload Script] Invoking ${NOTEBOOK_GET_CHUNKS} for notebook ID: ${notebookId}`);
    return ipcRenderer.invoke(NOTEBOOK_GET_CHUNKS, notebookId);
  },

  // --- Chat Session Functions (within Notebooks) ---
  createChatInNotebook: (params: { notebookId: string, chatTitle?: string | null }): Promise<IChatSession> => {
    console.log(`[Preload Script] Invoking ${CHAT_SESSION_CREATE_IN_NOTEBOOK} for notebook ID: ${params.notebookId}`);
    return ipcRenderer.invoke(CHAT_SESSION_CREATE_IN_NOTEBOOK, params);
  },
  listChatsForNotebook: (notebookId: string): Promise<IChatSession[]> => {
    console.log(`[Preload Script] Invoking ${CHAT_SESSION_LIST_FOR_NOTEBOOK} for notebook ID: ${notebookId}`);
    return ipcRenderer.invoke(CHAT_SESSION_LIST_FOR_NOTEBOOK, notebookId);
  },
  transferChatToNotebook: (params: { sessionId: string, newNotebookId: string }): Promise<boolean> => {
    console.log(`[Preload Script] Invoking ${CHAT_SESSION_TRANSFER_TO_NOTEBOOK} for session ID: ${params.sessionId}`);
    return ipcRenderer.invoke(CHAT_SESSION_TRANSFER_TO_NOTEBOOK, params);
  },

  // --- Zustand Store Persistence --- 
  storeGet: (key: string): Promise<string | null> => {
    console.log(`[Preload Script] Invoking ${STORE_GET} for key: ${key}`);
    return ipcRenderer.invoke(STORE_GET, key);
  },
  storeSet: (key: string, value: string): Promise<void> => {
    console.log(`[Preload Script] Invoking ${STORE_SET} for key: ${key}`);
    return ipcRenderer.invoke(STORE_SET, { key, value });
  },
  storeRemove: (key: string): Promise<void> => {
    console.log(`[Preload Script] Invoking ${STORE_REMOVE} for key: ${key}`);
    return ipcRenderer.invoke(STORE_REMOVE, key);
  },

  // Listen for a flush request from the main process
  onMainRequestFlush: (callback: () => Promise<void>): void => {
    const listener = async (_event: IpcRendererEvent) => {
      console.log('[Preload Script] Received MAIN_REQUEST_RENDERER_FLUSH');
      try {
        await callback();
        console.log('[Preload Script] Renderer flush callback completed. Sending RENDERER_FLUSH_COMPLETE.');
        ipcRenderer.send(RENDERER_FLUSH_COMPLETE);
      } catch (error) {
        console.error('[Preload Script] Error during renderer flush callback:', error);
        // Still send complete, or an error signal? For now, send complete to prevent main from hanging.
        // Consider adding a RENDERER_FLUSH_ERROR if main needs to know.
        ipcRenderer.send(RENDERER_FLUSH_COMPLETE); 
      }
    };
    ipcRenderer.on(MAIN_REQUEST_RENDERER_FLUSH, listener);
    // Note: This type of listener typically doesn't return a cleanup function in IAppAPI 
    // because it's a global handler for app lifecycle. If multiple registrations 
    // were possible and needed cleanup, the API would need to change to return () => void.
  },

  // --- Classic Browser API --- 
  classicBrowserCreate: (windowId: string, bounds: Electron.Rectangle, initialUrl?: string): Promise<{ success: boolean } | undefined> => {
    console.log(`[Preload Script] Creating ClassicBrowser view ${windowId}`);
    return ipcRenderer.invoke(CLASSIC_BROWSER_CREATE, { windowId, bounds, initialUrl });
  },

  classicBrowserNavigate: (windowId: string, action: 'back' | 'forward' | 'reload' | 'stop' | 'url', url?: string): Promise<void> => {
    console.log(`[Preload Script] Invoking classicBrowserNavigate for window ${windowId}, action: ${action}, url: ${url}`);
    return ipcRenderer.invoke(CLASSIC_BROWSER_NAVIGATE, { windowId, action, url });
  },

  browserSetBounds: (windowId: string, bounds: Electron.Rectangle, isVisible: boolean): Promise<void> => {
    // This may be called very frequently during window move/resize. Consider logging only on error or specific conditions.
    // console.log(`[Preload Script] Syncing ClassicBrowser view ${windowId}`); 
    return ipcRenderer.invoke(BROWSER_BOUNDS, { windowId, bounds, isVisible });
  },

  classicBrowserDestroy: (windowId: string): Promise<void> => {
    console.log(`[Preload Script] Destroying ClassicBrowser view ${windowId}`);
    return ipcRenderer.invoke(CLASSIC_BROWSER_DESTROY, { windowId });
  },

  onClassicBrowserState: (callback: (update: { windowId: string, state: Partial<ClassicBrowserPayload> }) => void): (() => void) => {
    console.log('[Preload Script] Setting up listener for ON_CLASSIC_BROWSER_STATE');
    const listener = (_event: Electron.IpcRendererEvent, update: { windowId: string, state: Partial<ClassicBrowserPayload> }) => {
      callback(update);
    };
    ipcRenderer.on(ON_CLASSIC_BROWSER_STATE, listener);
    return () => {
      console.log('[Preload Script] Removing listener for ON_CLASSIC_BROWSER_STATE');
      ipcRenderer.removeListener(ON_CLASSIC_BROWSER_STATE, listener);
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
