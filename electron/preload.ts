import { contextBridge, ipcRenderer } from 'electron';
import {
  type IpcRendererEvent,
} from 'electron';

// Import channel constants and types from shared
import {
    PROFILE_GET,
    PROFILE_UPDATE,
    ACTIVITY_LOG_ADD,
    BOOKMARKS_IMPORT,
    INGEST_URL,
    FILE_SAVE_TEMP,
    OPEN_EXTERNAL_URL,
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
    ON_INTENT_STREAM_START,
    ON_INTENT_STREAM_CHUNK,
    ON_INTENT_STREAM_END,
    ON_INTENT_STREAM_ERROR,
    ON_SUGGESTED_ACTIONS,
    // Notebook and Chat Session channels
    NOTEBOOK_GET_BY_ID,
    NOTEBOOK_GET_ALL,
    NOTEBOOK_UPDATE,
    NOTEBOOK_DELETE,
    NOTEBOOK_GET_CHUNKS,
    NOTEBOOK_COMPOSE,
    NOTEBOOK_GET_RECENTLY_VIEWED,
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
    CLASSIC_BROWSER_SET_BOUNDS, // New
    CLASSIC_BROWSER_SET_VISIBILITY, // New
    ON_CLASSIC_BROWSER_STATE, // Renamed from ON_CLASSIC_BROWSER_STATE_UPDATE
    CLASSIC_BROWSER_DESTROY,
    CLASSIC_BROWSER_LOAD_URL, // Added new channel
    CLASSIC_BROWSER_GET_STATE, // Get browser state
    CLASSIC_BROWSER_VIEW_FOCUSED, // Import the new channel
    CLASSIC_BROWSER_REQUEST_FOCUS, // Import the new channel
    ON_CLASSIC_BROWSER_URL_CHANGE, // Import the new URL change channel
    BROWSER_FREEZE_VIEW, // Import freeze channel
    BROWSER_UNFREEZE_VIEW, // Import unfreeze channel
    // Tab management channels
    CLASSIC_BROWSER_CREATE_TAB,
    CLASSIC_BROWSER_SWITCH_TAB,
    CLASSIC_BROWSER_CLOSE_TAB,
    CLASSIC_BROWSER_SET_BACKGROUND_COLOR,
    // To-Do channels
    TODO_CREATE,
    TODO_GET_ALL,
    TODO_GET_BY_ID,
    TODO_UPDATE,
    TODO_DELETE,
    // Weather channel
    WEATHER_GET,
    // PDF Ingestion channels
    PDF_INGEST_REQUEST,
    PDF_INGEST_PROGRESS,
    PDF_INGEST_BATCH_COMPLETE,
    PDF_INGEST_CANCEL,
    // Object channels
    OBJECT_GET_BY_ID,
    OBJECT_DELETE,
    OBJECT_DELETE_BY_SOURCE_URI,
    // Note channels
    NOTE_CREATE,
    NOTE_GET_FOR_NOTEBOOK,
    NOTE_UPDATE,
    NOTE_DELETE,
    SHORTCUT_MINIMIZE_WINDOW,
    SHORTCUT_CLOSE_ACTIVE,
    SYNC_WINDOW_STACK_ORDER,
    AUDIO_TRANSCRIBE,
    // WOM channels
    WOM_INGEST_WEBPAGE,
    WOM_UPDATE_ACCESS,
    WOM_CREATE_TAB_GROUP,
    WOM_UPDATE_TAB_GROUP,
    WOM_ENRICH_COMPOSITE,
    WOM_INGESTION_STARTED,
    WOM_INGESTION_COMPLETE,
} from '../shared/ipcChannels';
// Import IChatMessage along with other types
import {
  IAppAPI,
  BookmarksProgressEvent,
  IChatMessage,
  SliceDetail,
  StructuredChatMessage,
  ChatMessageSourceMetadata,
  SetIntentPayload,
  IntentResultPayload,
  SuggestedAction,
  NotebookRecord,
  RecentNotebook,
  ObjectChunk,
  IChatSession,
  ClassicBrowserPayload,
  ClassicBrowserStateUpdate,
  UserProfile,
  UserProfileUpdatePayload,
  ActivityLogPayload,
  ToDoItem,
  ToDoCreatePayload,
  ToDoUpdatePayload,
  PdfIngestProgressPayload,
  PdfIngestBatchCompletePayload,
  JeffersObject,
  Note,
  CreateNotePayload,
  UpdateNotePayload,
  DeleteResult,
  WeatherData,
  AudioTranscribePayload,
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

  getProfile: (): Promise<UserProfile> => {
    console.log('[Preload Script] Requesting profile via IPC');
    return ipcRenderer.invoke(PROFILE_GET);
  },

  updateProfile: (payload: UserProfileUpdatePayload): Promise<UserProfile> => {
    console.log('[Preload Script] Updating profile via IPC');
    return ipcRenderer.invoke(PROFILE_UPDATE, payload);
  },

  getWeather: (): Promise<WeatherData> => {
    console.log('[Preload Script] Getting weather data via IPC');
    return ipcRenderer.invoke(WEATHER_GET);
  },

  logActivity: (payload: ActivityLogPayload): Promise<void> => {
    console.log('[Preload Script] Logging activity via IPC');
    return ipcRenderer.invoke(ACTIVITY_LOG_ADD, payload);
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

  // Add openExternalUrl function
  openExternalUrl: (url: string): Promise<boolean> => {
    console.log('[Preload Script] Opening external URL via IPC:', url);
    return ipcRenderer.invoke(OPEN_EXTERNAL_URL, url);
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

  // Add ingestUrl function
  ingestUrl: (url: string, title?: string): Promise<{ jobId: string | null; alreadyExists: boolean }> => {
    console.log('[Preload Script] Invoking URL ingestion via IPC:', url);
    return ipcRenderer.invoke(INGEST_URL, url, title);
  },

  // --- Chat Streaming --- 
  startChatStream: (payload: { notebookId: string, sessionId: string, question: string }): void => {
    const { notebookId, sessionId, question } = payload;
    if (!notebookId || !sessionId || !question) {
        console.error('[Preload Script] startChatStream called with invalid payload.', payload);
        return;
    }
    console.log(`[Preload Script] Sending CHAT_STREAM_START for notebook: ${notebookId}, session: ${sessionId}, question: "${question.substring(0,30)}..."`);
    ipcRenderer.send(CHAT_STREAM_START, payload); // Send the whole payload object
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
  setIntent: (payload: SetIntentPayload): Promise<void> => {
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

  // Intent streaming handlers
  onIntentStreamStart: (callback: (data: { streamId: string }) => void): (() => void) => {
    console.log('[Preload Script] Setting up listener for ON_INTENT_STREAM_START');
    const listener = (_event: Electron.IpcRendererEvent, data: { streamId: string }) => {
      callback(data);
    };
    ipcRenderer.on(ON_INTENT_STREAM_START, listener);
    return () => {
      console.log('[Preload Script] Removing listener for ON_INTENT_STREAM_START');
      ipcRenderer.removeListener(ON_INTENT_STREAM_START, listener);
    };
  },

  onIntentStreamChunk: (callback: (data: { streamId: string; chunk: string }) => void): (() => void) => {
    console.log('[Preload Script] Setting up listener for ON_INTENT_STREAM_CHUNK');
    const listener = (_event: Electron.IpcRendererEvent, data: { streamId: string; chunk: string }) => {
      callback(data);
    };
    ipcRenderer.on(ON_INTENT_STREAM_CHUNK, listener);
    return () => {
      console.log('[Preload Script] Removing listener for ON_INTENT_STREAM_CHUNK');
      ipcRenderer.removeListener(ON_INTENT_STREAM_CHUNK, listener);
    };
  },

  onIntentStreamEnd: (callback: (data: { streamId: string; messageId?: string }) => void): (() => void) => {
    console.log('[Preload Script] Setting up listener for ON_INTENT_STREAM_END');
    const listener = (_event: Electron.IpcRendererEvent, data: { streamId: string; messageId?: string }) => {
      callback(data);
    };
    ipcRenderer.on(ON_INTENT_STREAM_END, listener);
    return () => {
      console.log('[Preload Script] Removing listener for ON_INTENT_STREAM_END');
      ipcRenderer.removeListener(ON_INTENT_STREAM_END, listener);
    };
  },

  onIntentStreamError: (callback: (data: { streamId?: string; error: string }) => void): (() => void) => {
    console.log('[Preload Script] Setting up listener for ON_INTENT_STREAM_ERROR');
    const listener = (_event: Electron.IpcRendererEvent, data: { streamId?: string; error: string }) => {
      callback(data);
    };
    ipcRenderer.on(ON_INTENT_STREAM_ERROR, listener);
    return () => {
      console.log('[Preload Script] Removing listener for ON_INTENT_STREAM_ERROR');
      ipcRenderer.removeListener(ON_INTENT_STREAM_ERROR, listener);
    };
  },

  onSuggestedActions: (callback: (actions: SuggestedAction[]) => void): (() => void) => {
    console.log('[Preload Script] Setting up listener for ON_SUGGESTED_ACTIONS');
    const listener = (_event: Electron.IpcRendererEvent, actions: SuggestedAction[]) => {
      callback(actions);
    };
    ipcRenderer.on(ON_SUGGESTED_ACTIONS, listener);
    return () => {
      console.log('[Preload Script] Removing listener for ON_SUGGESTED_ACTIONS');
      ipcRenderer.removeListener(ON_SUGGESTED_ACTIONS, listener);
    };
  },

  // --- Notebook Functions ---
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
  composeNotebook: (params: { title: string; description?: string | null; sourceObjectIds?: string[] }): Promise<{ notebookId: string }> =>
    ipcRenderer.invoke(NOTEBOOK_COMPOSE, params),
  getRecentlyViewedNotebooks: (): Promise<RecentNotebook[]> => {
    console.log(`[Preload Script] Invoking ${NOTEBOOK_GET_RECENTLY_VIEWED}`);
    return ipcRenderer.invoke(NOTEBOOK_GET_RECENTLY_VIEWED);
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
  classicBrowserCreate: (windowId: string, bounds: Electron.Rectangle, payload: ClassicBrowserPayload): Promise<{ success: boolean } | undefined> =>
    ipcRenderer.invoke(CLASSIC_BROWSER_CREATE, windowId, bounds, payload),

  classicBrowserLoadUrl: (windowId: string, url: string): Promise<void> =>
    ipcRenderer.invoke(CLASSIC_BROWSER_LOAD_URL, windowId, url),

  classicBrowserNavigate: (windowId: string, action: 'back' | 'forward' | 'reload' | 'stop'): Promise<void> =>
    ipcRenderer.invoke(CLASSIC_BROWSER_NAVIGATE, windowId, action),

  classicBrowserSetBounds: (windowId: string, bounds: Electron.Rectangle): void => {
    ipcRenderer.send(CLASSIC_BROWSER_SET_BOUNDS, windowId, bounds);
  },

  classicBrowserSetVisibility: (windowId: string, shouldBeDrawn: boolean, isFocused: boolean): void => {
    ipcRenderer.send(CLASSIC_BROWSER_SET_VISIBILITY, windowId, shouldBeDrawn, isFocused);
  },

  classicBrowserDestroy: (windowId: string): Promise<void> =>
    ipcRenderer.invoke(CLASSIC_BROWSER_DESTROY, windowId),

  classicBrowserGetState: (windowId: string): Promise<ClassicBrowserPayload | null> =>
    ipcRenderer.invoke(CLASSIC_BROWSER_GET_STATE, windowId),

  onClassicBrowserState: (callback: (update: ClassicBrowserStateUpdate) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: ClassicBrowserStateUpdate) => callback(update);
    ipcRenderer.on(ON_CLASSIC_BROWSER_STATE, listener);
    return () => {
      ipcRenderer.removeListener(ON_CLASSIC_BROWSER_STATE, listener);
    };
  },

  // New method to subscribe to WebContentsView focus events
  onClassicBrowserViewFocused: (callback: (data: { windowId: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { windowId: string }) => callback(data);
    ipcRenderer.on(CLASSIC_BROWSER_VIEW_FOCUSED, listener);
    return () => ipcRenderer.removeListener(CLASSIC_BROWSER_VIEW_FOCUSED, listener);
  },

  classicBrowserRequestFocus: (windowId: string): void => {
    console.log(`[Preload Script] Sending ${CLASSIC_BROWSER_REQUEST_FOCUS} for windowId: ${windowId}`);
    ipcRenderer.send(CLASSIC_BROWSER_REQUEST_FOCUS, windowId);
  },

  // New method to subscribe to URL change events
  onClassicBrowserUrlChange: (callback: (data: { windowId: string; url: string; title: string | null }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { windowId: string; url: string; title: string | null }) => callback(data);
    ipcRenderer.on(ON_CLASSIC_BROWSER_URL_CHANGE, listener);
    return () => ipcRenderer.removeListener(ON_CLASSIC_BROWSER_URL_CHANGE, listener);
  },

  // Tab management methods
  classicBrowserCreateTab: (windowId: string, url?: string): Promise<{ success: boolean; tabId?: string; error?: string }> =>
    ipcRenderer.invoke(CLASSIC_BROWSER_CREATE_TAB, windowId, url),

  classicBrowserSwitchTab: (windowId: string, tabId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(CLASSIC_BROWSER_SWITCH_TAB, windowId, tabId),

  classicBrowserCloseTab: (windowId: string, tabId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(CLASSIC_BROWSER_CLOSE_TAB, windowId, tabId),

  classicBrowserSetBackgroundColor: (windowId: string, color: string): void => {
    ipcRenderer.send(CLASSIC_BROWSER_SET_BACKGROUND_COLOR, windowId, color);
  },

  // Capture snapshot and show/focus browser views
  captureSnapshot: (windowId: string): Promise<string | null> => {
    console.log(`[Preload Script] Invoking ${BROWSER_FREEZE_VIEW} for windowId: ${windowId}`);
    return ipcRenderer.invoke(BROWSER_FREEZE_VIEW, windowId);
  },

  showAndFocusView: (windowId: string): Promise<void> => {
    console.log(`[Preload Script] Invoking ${BROWSER_UNFREEZE_VIEW} for windowId: ${windowId}`);
    return ipcRenderer.invoke(BROWSER_UNFREEZE_VIEW, windowId);
  },

  // @deprecated Use captureSnapshot instead
  freezeBrowserView: (windowId: string): Promise<string | null> => {
    console.log(`[Preload Script] Invoking ${BROWSER_FREEZE_VIEW} for windowId: ${windowId} (deprecated, use captureSnapshot)`);
    return ipcRenderer.invoke(BROWSER_FREEZE_VIEW, windowId);
  },

  // @deprecated Use showAndFocusView instead  
  unfreezeBrowserView: (windowId: string): Promise<void> => {
    console.log(`[Preload Script] Invoking ${BROWSER_UNFREEZE_VIEW} for windowId: ${windowId} (deprecated, use showAndFocusView)`);
    return ipcRenderer.invoke(BROWSER_UNFREEZE_VIEW, windowId);
  },

  // --- To-Do Operations ---
  createToDo: (payload: ToDoCreatePayload): Promise<ToDoItem> => {
    console.log('[Preload Script] Creating todo via IPC');
    return ipcRenderer.invoke(TODO_CREATE, payload);
  },

  getToDos: (userId?: string): Promise<ToDoItem[]> => {
    console.log('[Preload Script] Getting todos via IPC');
    return ipcRenderer.invoke(TODO_GET_ALL, userId);
  },

  getToDoById: (id: string): Promise<ToDoItem | null> => {
    console.log('[Preload Script] Getting todo by ID via IPC');
    return ipcRenderer.invoke(TODO_GET_BY_ID, id);
  },

  updateToDo: (id: string, payload: ToDoUpdatePayload): Promise<ToDoItem | null> => {
    console.log('[Preload Script] Updating todo via IPC');
    return ipcRenderer.invoke(TODO_UPDATE, { id, payload });
  },

  deleteToDo: (id: string): Promise<boolean> => {
    console.log('[Preload Script] Deleting todo via IPC');
    return ipcRenderer.invoke(TODO_DELETE, id);
  },

  // --- PDF Ingestion ---
  ingestPdfs: (filePaths: string[]): Promise<void> => {
    console.log('[Preload Script] Requesting PDF ingestion via IPC');
    return ipcRenderer.invoke(PDF_INGEST_REQUEST, { filePaths });
  },

  onPdfIngestProgress: (callback: (progress: PdfIngestProgressPayload) => void): (() => void) => {
    console.log('[Preload Script] Setting up listener for PDF_INGEST_PROGRESS');
    const listener = (_event: Electron.IpcRendererEvent, progress: PdfIngestProgressPayload) => {
      callback(progress);
    };
    ipcRenderer.on(PDF_INGEST_PROGRESS, listener);
    return () => {
      console.log('[Preload Script] Removing listener for PDF_INGEST_PROGRESS');
      ipcRenderer.removeListener(PDF_INGEST_PROGRESS, listener);
    };
  },

  onPdfIngestBatchComplete: (callback: (batchResult: PdfIngestBatchCompletePayload) => void): (() => void) => {
    console.log('[Preload Script] Setting up listener for PDF_INGEST_BATCH_COMPLETE');
    const listener = (_event: Electron.IpcRendererEvent, batchResult: PdfIngestBatchCompletePayload) => {
      callback(batchResult);
    };
    ipcRenderer.on(PDF_INGEST_BATCH_COMPLETE, listener);
    return () => {
      console.log('[Preload Script] Removing listener for PDF_INGEST_BATCH_COMPLETE');
      ipcRenderer.removeListener(PDF_INGEST_BATCH_COMPLETE, listener);
    };
  },

  cancelPdfIngest: (): void => {
    console.log('[Preload Script] Sending PDF_INGEST_CANCEL');
    ipcRenderer.send(PDF_INGEST_CANCEL);
  },

  // --- Object Operations ---
  getObjectById: (objectId: string): Promise<JeffersObject | null> => {
    console.log('[Preload Script] Getting object by ID via IPC');
    return ipcRenderer.invoke(OBJECT_GET_BY_ID, objectId);
  },

  deleteObjects: (objectIds: string[]): Promise<DeleteResult> => {
    console.log(`[Preload Script] Deleting ${objectIds.length} objects via IPC`);
    return ipcRenderer.invoke(OBJECT_DELETE, objectIds);
  },

  deleteObjectBySourceUri: (windowId: string, sourceUri: string): Promise<DeleteResult> => {
    console.log(`[Preload Script] Deleting object by source URI: ${sourceUri} for window: ${windowId}`);
    return ipcRenderer.invoke(OBJECT_DELETE_BY_SOURCE_URI, { windowId, sourceUri });
  },

  // --- Note Operations ---
  createNote: (payload: CreateNotePayload): Promise<Note> => {
    console.log('[Preload Script] Creating note via IPC');
    return ipcRenderer.invoke(NOTE_CREATE, payload);
  },

  getNotesForNotebook: (notebookId: string): Promise<Note[]> => {
    console.log('[Preload Script] Getting notes for notebook via IPC');
    return ipcRenderer.invoke(NOTE_GET_FOR_NOTEBOOK, notebookId);
  },

  updateNote: (noteId: string, payload: UpdateNotePayload): Promise<Note | null> => {
    console.log('[Preload Script] Updating note via IPC');
    return ipcRenderer.invoke(NOTE_UPDATE, noteId, payload);
  },

  deleteNote: (noteId: string): Promise<boolean> => {
    console.log(`[Preload Script] Deleting note via IPC`);
    return ipcRenderer.invoke(NOTE_DELETE, noteId);
  },

  // --- Audio Transcription ---
  audio: {
    transcribe: async (audioBlob: Blob): Promise<string> => {
      console.log('[Preload Script] Transcribing audio via IPC');
      const arrayBuffer = await audioBlob.arrayBuffer();
      const result = await ipcRenderer.invoke(AUDIO_TRANSCRIBE, {
        audioData: arrayBuffer,
        mimeType: audioBlob.type,
      } as AudioTranscribePayload);
      return result.text;
    },
  },

  // --- Shortcut Listeners ---
  onShortcutMinimizeWindow: (callback: () => void): (() => void) => {
    const listener = (_event: IpcRendererEvent) => callback();
    ipcRenderer.on(SHORTCUT_MINIMIZE_WINDOW, listener);
    return () => ipcRenderer.removeListener(SHORTCUT_MINIMIZE_WINDOW, listener);
  },

  onCloseActiveRequested: (callback: () => void): (() => void) => {
    const listener = (_event: IpcRendererEvent) => callback();
    ipcRenderer.on(SHORTCUT_CLOSE_ACTIVE, listener);
    return () => ipcRenderer.removeListener(SHORTCUT_CLOSE_ACTIVE, listener);
  },
  
  // --- Window Stack Synchronization ---
  syncWindowStackOrder: (windowsInOrder: Array<{ id: string; isFrozen: boolean; isMinimized: boolean }>): Promise<{ success: boolean }> => {
    console.log('[Preload Script] Syncing window stack order via IPC:', windowsInOrder.length, 'windows');
    return ipcRenderer.invoke(SYNC_WINDOW_STACK_ORDER, windowsInOrder);
  },

  // --- WOM (Working Memory) Operations ---
  wom: {
    ingestWebpage: (url: string, title: string): Promise<{ success: boolean; objectId?: string; error?: string }> => {
      console.log('[Preload Script] Ingesting webpage into WOM via IPC:', { url, title });
      return ipcRenderer.invoke(WOM_INGEST_WEBPAGE, { url, title });
    },

    updateAccess: (objectId: string): Promise<{ success: boolean; error?: string }> => {
      console.log('[Preload Script] Updating WOM access time via IPC:', objectId);
      return ipcRenderer.invoke(WOM_UPDATE_ACCESS, { objectId });
    },

    createTabGroup: (title: string, childObjectIds: string[]): Promise<{ success: boolean; objectId?: string; error?: string }> => {
      console.log('[Preload Script] Creating WOM tab group via IPC:', { title, childCount: childObjectIds.length });
      return ipcRenderer.invoke(WOM_CREATE_TAB_GROUP, { title, childObjectIds });
    },

    updateTabGroup: (objectId: string, childObjectIds: string[]): Promise<{ success: boolean; error?: string }> => {
      console.log('[Preload Script] Updating WOM tab group via IPC:', { objectId, childCount: childObjectIds.length });
      return ipcRenderer.invoke(WOM_UPDATE_TAB_GROUP, { objectId, childObjectIds });
    },

    enrichComposite: (objectId: string): Promise<{ scheduled: boolean; error?: string }> => {
      console.log('[Preload Script] Requesting WOM composite enrichment via IPC:', objectId);
      return ipcRenderer.invoke(WOM_ENRICH_COMPOSITE, { objectId });
    },

    // Event listeners for WOM ingestion notifications
    onIngestionStarted: (callback: (data: { url: string; windowId?: string; tabId?: string }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, data: { url: string; windowId?: string; tabId?: string }) => {
        callback(data);
      };
      ipcRenderer.on(WOM_INGESTION_STARTED, listener);
      return () => ipcRenderer.removeListener(WOM_INGESTION_STARTED, listener);
    },

    onIngestionComplete: (callback: (data: { url: string; objectId: string; windowId?: string; tabId?: string }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, data: { url: string; objectId: string; windowId?: string; tabId?: string }) => {
        callback(data);
      };
      ipcRenderer.on(WOM_INGESTION_COMPLETE, listener);
      return () => ipcRenderer.removeListener(WOM_INGESTION_COMPLETE, listener);
    },
  },

  // --- Debug Functions (Development Only) ---
  ...(process.env.NODE_ENV !== 'production' ? {
    getFullProfile: (userId: string = 'default_user'): Promise<any> => {
      console.log('[Preload Script] Getting full profile via IPC (debug)');
      return ipcRenderer.invoke('debug:getFullProfile', userId);
    },

    getRecentActivities: (hoursAgo: number = 24): Promise<any[]> => {
      console.log('[Preload Script] Getting recent activities via IPC (debug)');
      return ipcRenderer.invoke('debug:getRecentActivities', hoursAgo);
    },

    forceSynthesis: (synthesisType: 'activities' | 'content' | 'both' = 'both'): Promise<{ success: boolean; message: string }> => {
      console.log('[Preload Script] Forcing synthesis via IPC (debug)');
      return ipcRenderer.invoke('debug:forceSynthesis', synthesisType);
    },

    getSynthesisState: (): Promise<any> => {
      console.log('[Preload Script] Getting synthesis state via IPC (debug)');
      return ipcRenderer.invoke('debug:getSynthesisState');
    },

    clearProfile: (): Promise<{ success: boolean; message: string }> => {
      console.log('[Preload Script] Clearing profile via IPC (debug)');
      return ipcRenderer.invoke('debug:clearProfile');
    },
  } : {}),
};

// Securely expose the defined API to the renderer process
try {
  // Use 'satisfies' to check the api object against the interface
  contextBridge.exposeInMainWorld('api', api satisfies IAppAPI);
  console.log('[Preload Script] API exposed successfully.');
} catch (error) {
  console.error('[Preload Script] Failed to expose API:', error);
}

// Debug API exposed on window.electron (not window.api)
if (process.env.NODE_ENV !== 'production') {
  const electronDebugApi = {
    getProfile: api.getProfile,
    getFullProfile: (api as any).getFullProfile,
    getRecentActivities: (api as any).getRecentActivities,
    forceSynthesis: (api as any).forceSynthesis,
    getSynthesisState: (api as any).getSynthesisState,
    clearProfile: (api as any).clearProfile,
  };

  try {
    contextBridge.exposeInMainWorld('electron', electronDebugApi);
    console.log('[Preload Script] Debug API exposed on window.electron');
  } catch (error) {
    console.error('[Preload Script] Failed to expose debug API:', error);
  }
}
