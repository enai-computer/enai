import type { Rectangle } from 'electron';
import { JeffersObject, DeleteResult } from './object.types';
import { ObjectChunk } from './chunk.types';
import { NotebookRecord, RecentNotebook } from './notebook.types';
import { IChatSession, StructuredChatMessage, ChatMessageSourceMetadata } from './chat.types';
import { SliceDetail } from './search.types';
import { UserProfile, UserProfileUpdatePayload, ActivityLogPayload } from './profile.types';
import { SetIntentPayload, IntentResultPayload, SuggestedAction } from './intent.types';
import { ClassicBrowserPayload, ClassicBrowserStateUpdate, TabState } from './window.types';
import { ToDoItem, ToDoCreatePayload, ToDoUpdatePayload } from './todo.types';
import { Note, CreateNotePayload, UpdateNotePayload } from './notes.types';
import { BookmarksProgressEvent, PdfIngestProgressPayload, PdfIngestBatchCompletePayload } from './ingestion.types';
import { WeatherData } from './weather.types';

// Audio transcription types
export interface AudioTranscribePayload {
  audioData: ArrayBuffer;
  mimeType: string;
  duration?: number; // in seconds
}

export interface AudioTranscribeResult {
  text: string;
}

// Make sure this interface stays in sync with the implementation in preload.ts
export interface IAppAPI {
  // Add signatures for all functions exposed on window.api
  getAppVersion: () => Promise<string>;
  getProfile: () => Promise<UserProfile>;
  updateProfile: (payload: UserProfileUpdatePayload) => Promise<UserProfile>;
  getWeather: () => Promise<WeatherData>;
  logActivity: (payload: ActivityLogPayload) => Promise<void>;
  // Example:
  // saveNotebook: (data: NotebookData) => Promise<{ success: boolean; data?: any }>;

  /**
   * Import a bookmark export file (HTML or JSON).
   * Returns the number of *new* bookmarks ingested.
   */
  importBookmarks: (filePath: string) => Promise<number>;

  /**
   * Write a Uint8Array to a temp file and return the absolute path.
   * @param fileName  original filename (for extension)
   * @param data      binary contents (as Uint8Array)
   */
  saveTempFile: (fileName: string, data: Uint8Array) => Promise<string>;

  /**
   * Open a URL in the default system browser.
   * @param url The URL to open
   * @returns Promise that resolves to true if successful
   */
  openExternalUrl: (url: string) => Promise<boolean>;

  /**
   * Subscribe to bookmark import progress updates.
   * @param callback Function to call with progress events.
   * @returns A function to unsubscribe the listener.
   */
  onBookmarksProgress: (callback: (event: BookmarksProgressEvent) => void) => () => void;

  /**
   * Ingest a URL into the system for processing and storage.
   * @param url The URL to ingest
   * @param title Optional title for the page
   * @param windowId Optional window ID for updating tab bookmark status
   * @returns Promise resolving to ingestion result with jobId and alreadyExists flag
   */
  ingestUrl: (url: string, title?: string, windowId?: string) => Promise<{ jobId: string | null; alreadyExists: boolean }>;

  // --- Notebook Functions ---
  getNotebookById: (id: string) => Promise<NotebookRecord | null>;
  getAllNotebooks: () => Promise<NotebookRecord[]>;
  getRecentlyViewedNotebooks: () => Promise<RecentNotebook[]>;
  updateNotebook: (params: { id: string, data: { title?: string, description?: string | null } }) => Promise<NotebookRecord | null>;
  deleteNotebook: (id: string) => Promise<boolean>;
  getChunksForNotebook: (notebookId: string) => Promise<ObjectChunk[]>;
  getOrCreateDailyNotebook: () => Promise<NotebookRecord>;

  // --- Chat Functions ---
  createChatInNotebook: (params: { notebookId: string, chatTitle?: string | null }) => Promise<IChatSession>;
  listChatsForNotebook: (notebookId: string) => Promise<IChatSession[]>;
  transferChatToNotebook: (params: { sessionId: string, newNotebookId: string }) => Promise<boolean>;
  startChatStream: (payload: { notebookId: string, sessionId: string, question: string }) => void;

  /** Request to stop the current chat stream for the window. */
  stopChatStream: () => void;

  /** Subscribe to incoming chat response chunks. Returns cleanup fn. */
  onChatChunk: (callback: (chunk: string) => void) => () => void;

  /** Subscribe to the stream end signal (now includes messageId and metadata). Returns cleanup fn. */
  onChatStreamEnd: (callback: (result: { messageId: string; metadata: ChatMessageSourceMetadata | null }) => void) => () => void;

  /** Subscribe to stream error signals. Returns cleanup fn. */
  onChatStreamError: (callback: (errorMessage: string) => void) => () => void;

  /**
   * Retrieves messages for a specific chat session.
   * @param sessionId The ID of the session.
   * @param limit Optional maximum number of messages to return.
   * @param beforeTimestamp Optional ISO timestamp to fetch messages before.
   * @returns A Promise resolving to an array of chat messages.
   */
  getMessages: (
    sessionId: string,
    limit?: number,
    beforeTimestamp?: string
  ) => Promise<StructuredChatMessage[]>;

  /**
   * Retrieves detailed information for a list of chunk IDs, returning them as SliceDetail objects.
   * @param chunkIds An array of ObjectChunk.id values.
   * @returns A Promise resolving to an array of SliceDetail objects.
   */
  getSliceDetails: (chunkIds: number[]) => Promise<SliceDetail[]>;

  // --- Intent Handling API ---
  /**
   * Sets the user's intent.
   * Resolves when the intent is initially acknowledged by the backend.
   * Main results will be delivered via onIntentResult.
   */
  setIntent: (payload: SetIntentPayload) => Promise<void>; // Updated to use SetIntentPayload

  /**
   * Subscribes to results from processed intents.
   * @param callback Function to call with intent results.
   * @returns A function to unsubscribe the listener.
   */
  onIntentResult: (callback: (result: IntentResultPayload) => void) => () => void;

  /**
   * Subscribes to intent stream start events.
   * @param callback Function to call when a stream starts.
   * @returns A function to unsubscribe the listener.
   */
  onIntentStreamStart: (callback: (data: { streamId: string }) => void) => () => void;

  /**
   * Subscribes to intent stream chunks.
   * @param callback Function to call with stream chunks.
   * @returns A function to unsubscribe the listener.
   */
  onIntentStreamChunk: (callback: (data: { streamId: string; chunk: string }) => void) => () => void;

  /**
   * Subscribes to intent stream end events.
   * @param callback Function to call when a stream ends.
   * @returns A function to unsubscribe the listener.
   */
  onIntentStreamEnd: (callback: (data: { streamId: string; messageId?: string }) => void) => () => void;

  /**
   * Subscribes to intent stream error events.
   * @param callback Function to call when a stream error occurs.
   * @returns A function to unsubscribe the listener.
   */
  onIntentStreamError: (callback: (data: { streamId?: string; error: string }) => void) => () => void;

  /**
   * Subscribes to suggested actions based on user query and context.
   * @param callback Function to call with suggested actions.
   * @returns A function to unsubscribe the listener.
   */
  onSuggestedActions: (callback: (actions: SuggestedAction[]) => void) => () => void;

  // --- Zustand Store Persistence API ---
  /** Retrieves a string value from the persistent store by key. */
  storeGet: (key: string) => Promise<string | null>;
  /** Sets a string value in the persistent store for a given key. */
  storeSet: (key: string, value: string) => Promise<void>;
  /** Removes a value from the persistent store by key. */
  storeRemove: (key: string) => Promise<void>;

  /** 
   * Main process requests renderer to flush all notebook stores.
   * Renderer should call the callback, which then sends RENDERER_FLUSH_COMPLETE.
   */
  onMainRequestFlush: (callback: () => Promise<void>) => void;

  // --- Classic Browser API ---
  classicBrowserCreate(windowId: string, bounds: Rectangle, payload: ClassicBrowserPayload): Promise<{ success: boolean } | undefined>;
  classicBrowserLoadUrl(windowId: string, url: string): Promise<void>;
  classicBrowserNavigate(windowId: string, action: 'back' | 'forward' | 'reload' | 'stop', url?: string): Promise<void>;
  classicBrowserSetBounds: (windowId: string, bounds: Rectangle) => void;
  classicBrowserSetVisibility: (windowId: string, shouldBeDrawn: boolean, isFocused: boolean) => void;
  classicBrowserDestroy: (windowId: string) => Promise<void>;
  classicBrowserGetState: (windowId: string) => Promise<ClassicBrowserPayload | null>;
  onClassicBrowserState: (
    callback: (update: ClassicBrowserStateUpdate) => void
  ) => () => void; // Returns a cleanup function to unsubscribe

  // Added for WebContentsView focus
  onClassicBrowserViewFocused: (callback: (data: { windowId: string }) => void) => () => void;

  // Added for renderer to request focus
  classicBrowserRequestFocus: (windowId: string) => void; // Send-only, no return needed

  // Listen for URL change events from classic browser windows
  onClassicBrowserUrlChange: (callback: (data: { windowId: string; url: string; title: string | null }) => void) => () => void;

  // Capture a snapshot of a browser view
  captureSnapshot: (windowId: string) => Promise<string | null>;
  
  // Show and focus a browser view
  showAndFocusView: (windowId: string) => Promise<void>;
  
  // @deprecated Use captureSnapshot instead
  freezeBrowserView: (windowId: string) => Promise<string | null>;
  
  // @deprecated Use showAndFocusView instead
  unfreezeBrowserView: (windowId: string) => Promise<void>;

  // Tab management methods
  classicBrowserCreateTab: (windowId: string, url?: string) => Promise<{ success: boolean; tabId?: string; error?: string }>;
  classicBrowserSwitchTab: (windowId: string, tabId: string) => Promise<{ success: boolean; error?: string }>;
  classicBrowserCloseTab: (windowId: string, tabId: string) => Promise<{ success: boolean; error?: string }>;
  classicBrowserSetBackgroundColor: (windowId: string, color: string) => void;

  // --- Shortcut Listeners ---
  /**
   * Subscribes to the global 'minimize window' shortcut.
   * @param callback Function to call when the shortcut is activated.
   * @returns A function to unsubscribe the listener.
   */
  onShortcutMinimizeWindow: (callback: () => void) => () => void;

  /**
   * Subscribes to the global 'close active window/tab' shortcut.
   * @param callback Function to call when the shortcut is activated.
   * @returns A function to unsubscribe the listener.
   */
  onCloseActiveRequested: (callback: () => void) => () => void;
  
  // --- Window Stack Synchronization ---
  /**
   * Synchronize the stacking order of WebContentsViews to match window z-indices.
   * @param windowIdsInOrder Array of window IDs ordered by z-index (lowest to highest)
   */
  syncWindowStackOrder: (windowsInOrder: Array<{ id: string; isFrozen: boolean; isMinimized: boolean }>) => Promise<{ success: boolean }>;

  // --- To-Do Operations ---
  createToDo: (payload: ToDoCreatePayload) => Promise<ToDoItem>;
  getToDos: (userId?: string) => Promise<ToDoItem[]>;
  getToDoById: (id: string) => Promise<ToDoItem | null>;
  updateToDo: (id: string, payload: ToDoUpdatePayload) => Promise<ToDoItem | null>;
  deleteToDo: (id: string) => Promise<boolean>;

  // --- PDF Ingestion ---
  /** Request to ingest PDF files */
  ingestPdfs: (filePaths: string[]) => Promise<void>;
  /** Listen for PDF ingestion progress updates */
  onPdfIngestProgress: (callback: (progress: PdfIngestProgressPayload) => void) => () => void;
  /** Listen for batch PDF ingestion completion */
  onPdfIngestBatchComplete: (callback: (batchResult: PdfIngestBatchCompletePayload) => void) => () => void;
  /** Cancel ongoing PDF ingestion */
  cancelPdfIngest: () => void;

  // --- Object Operations ---
  /** Get an object by its ID */
  getObjectById: (objectId: string) => Promise<JeffersObject | null>;
  /** Delete objects by their IDs */
  deleteObjects: (objectIds: string[]) => Promise<DeleteResult>;
  /** Delete an object by its source URI */
  deleteObjectBySourceUri: (windowId: string, sourceUri: string) => Promise<DeleteResult>;

  // --- Notebook Composition ---
  /** Compose a new notebook from source objects with minimized windows in sidebar */
  composeNotebook: (params: { title: string; description?: string | null; sourceObjectIds?: string[] }) => Promise<{ notebookId: string }>;

  // --- Note Operations ---
  /** Create a new note in a notebook */
  createNote: (payload: CreateNotePayload) => Promise<Note>;
  /** Get all notes for a notebook */
  getNotesForNotebook: (notebookId: string) => Promise<Note[]>;
  /** Update an existing note */
  updateNote: (noteId: string, payload: UpdateNotePayload) => Promise<Note | null>;
  /** Delete a note */
  deleteNote: (noteId: string) => Promise<boolean>;

  // --- Audio Transcription ---
  /** Transcribe audio using OpenAI Whisper */
  audio: {
    transcribe: (audioBlob: Blob) => Promise<string>;
  };

  // --- WOM (Working Memory) Operations ---
  /** Working Memory operations for managing transient webpage and tab group state */
  wom: {
    /** Ingest a webpage into WOM (lightweight, no chunking) */
    ingestWebpage: (url: string, title: string) => Promise<{ success: boolean; objectId?: string; error?: string }>;
    
    /** Update last access timestamp for an object */
    updateAccess: (objectId: string) => Promise<{ success: boolean; error?: string }>;
    
    /** Create a tab group (composite object) */
    createTabGroup: (title: string, childObjectIds: string[]) => Promise<{ success: boolean; objectId?: string; error?: string }>;
    
    /** Update tab group children */
    updateTabGroup: (objectId: string, childObjectIds: string[]) => Promise<{ success: boolean; error?: string }>;
    
    /** Request enrichment of a composite object */
    enrichComposite: (objectId: string) => Promise<{ scheduled: boolean; error?: string }>;
    
    /** Listen for WOM ingestion started events */
    onIngestionStarted: (callback: (data: { url: string; windowId?: string; tabId?: string }) => void) => () => void;
    
    /** Listen for WOM ingestion complete events */
    onIngestionComplete: (callback: (data: { url: string; objectId: string; windowId?: string; tabId?: string }) => void) => () => void;
  };
}

declare global {
  interface Window {
    // Expose the api object defined in preload.ts
    api: IAppAPI;
  }
}