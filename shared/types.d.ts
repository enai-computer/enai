// This declaration file defines global types, primarily the shape of the
// 'window.api' object exposed by the preload script (electron/preload.ts).
// It ensures type safety when using the API in the renderer process (src/).

// --- Concrete Types ---

/** Represents the parsed content extracted by Mozilla Readability. */
export interface ReadabilityParsed {
  title: string;
  byline: string | null;
  dir: string | null; // Text direction
  content: string; // HTML content
  textContent: string; // Plain text content
  length: number; // Length of textContent
  excerpt: string | null;
  siteName: string | null;
}

/**
 * Represents the progress of a bookmark import operation.
 */
export interface BookmarksProgressEvent {
  processed: number; 
  total: number; 
  stage: string; // e.g., 'parsing', 'fetching', 'embedding'
}

// --- Database / Data Model Types ---

/** Possible statuses for an ingested object. */
export type ObjectStatus = 'new' | 'fetched' | 'parsed' | 'chunking' | 'chunked' | 'chunking_failed' | 'embedding' | 'embedded' | 'embedding_failed' | 'error' | 'pdf_processed' | 'embedding_in_progress' | 'complete';

/** Represents a top-level object in the system (corresponds to 'objects' table). */
export interface JeffersObject {
  id: string; // UUID v4
  objectType: string; // e.g., 'bookmark', 'note', 'pdf_document'
  sourceUri: string | null;
  title: string | null;
  status: ObjectStatus;
  rawContentRef: string | null;
  parsedContentJson?: string | null; // Optional: JSON string of ReadabilityParsed
  cleanedText?: string | null; // Optional: Plain text cleaned for embedding
  errorInfo?: string | null; // Optional: Details of fetch/parse errors
  parsedAt?: Date; // Date object (from ISO string in DB)
  createdAt: Date; // Date object (from ISO string in DB)
  updatedAt: Date; // Date object (from ISO string in DB)
  // PDF-specific fields
  fileHash?: string | null; // SHA256 hash of the PDF file content
  originalFileName?: string | null; // Original name of the uploaded file
  fileSizeBytes?: number | null; // Size of the PDF file in bytes
  fileMimeType?: string | null; // Detected MIME type
  internalFilePath?: string | null; // Path to our stored copy in user_data/pdfs
  aiGeneratedMetadata?: string | null; // JSON blob for {title, summary, tags}
  // Object-level summary fields
  summary?: string | null; // High-level document summary
  propositionsJson?: string | null; // JSON array of key claims/facts
  tagsJson?: string | null; // JSON array of main topics/themes
  summaryGeneratedAt?: Date | null; // When the summary was generated
}

/** Structure for object propositions */
export interface ObjectPropositions {
  main: string[];        // Key claims/facts
  supporting: string[];  // Supporting details
  actions?: string[];    // Actionable items (if any)
}

/** Represents a chunk of text derived from an object (corresponds to 'chunks' table). */
export interface ObjectChunk {
  id: number; // Surrogate key from DB
  objectId: string; // Foreign key to JeffersObject.id
  notebookId?: string | null; // Foreign key to Notebooks.id, optional
  chunkIdx: number; // 0-based index within the object
  content: string; // Renamed from 'text'
  summary?: string | null;
  tagsJson?: string | null; // JSON array as string
  propositionsJson?: string | null; // JSON array as string
  tokenCount?: number | null;
  createdAt: Date; // Date object (from ISO string in DB)
}

/** Represents the record linking a chunk to its stored embedding (corresponds to 'embeddings' table). */
export interface EmbeddingRecord {
  id: number; // Surrogate key from DB
  chunkId: number; // Foreign key to ObjectChunk.id
  model: string; // Name of the embedding model used
  vectorId: string; // Unique ID of the vector in the vector store (e.g., Chroma ID)
  createdAt: Date; // Date object (from ISO string in DB)
}

// --- Chat Types ---
import { BaseMessage } from "@langchain/core/messages"; // Required for ChatHistory
// Add DocumentInterface if needed for other parts, LangchainAgent handles its import internally
// import { DocumentInterface } from "@langchain/core/documents";

export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool';

/** Defines the structure for metadata containing source chunk information. */
export interface ChatMessageSourceMetadata {
  /** Array of chunk IDs (ObjectChunk.id) used as context for the message. */
  sourceChunkIds?: number[];
  /** Tool call ID for tool response messages */
  toolCallId?: string;
  /** Tool name for tool response messages */
  toolName?: string;
  /** Tool calls for assistant messages that invoke tools */
  toolCalls?: any[];
}

// Data needed to create a new message
export interface ChatMessageCreate {
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  metadata?: Record<string, any> | null; // For sources, etc.
}

// Full message data including generated fields
export interface ChatMessageData extends ChatMessageCreate {
  messageId: string;
  timestamp: Date; 
}

// Structure expected by LangChain memory/chains (or UI)
// Represents the conversation history.
export type ChatHistory = BaseMessage[];

// --- Vector Store Interface ---
/** Basic interface for a vector store operations needed by ChunkingService. */
export interface IVectorStore {
  /** Adds documents (chunks) to the vector store. */
  addDocuments(documents: { pageContent: string; metadata: Record<string, any> }[]): Promise<string[]>;
}

// --- Search Result Types ---
/** Represents a unified search result from either Exa web search or local vector database. */
export interface HybridSearchResult {
  id: string;
  title: string;
  url?: string;
  content: string;
  score: number;
  source: 'exa' | 'local';
  // Additional metadata
  publishedDate?: string;
  author?: string;
  objectId?: string; // For local results
  chunkId?: number; // For local results
  highlights?: string[]; // Key sentences or highlights from the content
}

// --- Slice/Context Detail Type ---
/** Represents the detailed information of a source text slice, suitable for display. */
export interface SliceDetail {
  /** The ID of the original chunk in the database (chunks.id). */
  chunkId: number;
  /** The full text content of the chunk/slice. */
  content: string;
  /** The summary of the chunk/slice. */
  summary: string | null;
  /** The ID of the source object (objects.id) this slice belongs to. */
  sourceObjectId: string;
  /** The title of the source object (if available). */
  sourceObjectTitle: string | null;
  /** The original URI of the source object (if available). */
  sourceObjectUri: string | null;
  // TODO: Add other relevant fields like summary, tags if needed later
}

/** Represents a slice ready for UI display, unified across local and web sources. */
export interface DisplaySlice {
  /** Unique identifier for the slice (chunkId for local, generated for web). */
  id: string;
  /** Title of the source (document title, web page title, etc.). */
  title: string | null;
  /** URL/URI of the source if available. */
  sourceUri: string | null;
  /** Content of the slice (may be truncated for display). */
  content: string;
  /** Summary of the slice. */
  summary: string | null;
  /** Type of source (local vector DB or web search). */
  sourceType: 'local' | 'web';
  /** Original chunk ID for local sources. */
  chunkId?: number;
  /** Original object ID for local sources. */
  sourceObjectId?: string;
  /** Score/relevance from the search. */
  score?: number;
  /** Date published for web sources. */
  publishedDate?: string;
  /** Author for web sources. */
  author?: string;
}

// --- Add new Context State Type ---
/** Represents the state of context slice fetching for a message. */
export interface ContextState<T = SliceDetail[]> {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  data: T | null;
}

// --- Intent Handling Types ---
export interface SetIntentPayload {
  intentText: string;
  context: 'welcome' | 'notebook'; // Add context
  notebookId?: string;             // Add optional notebookId
}

export interface OpenInClassicBrowserPayload {
  type: 'open_in_classic_browser';
  url: string;
  notebookId: string; // To confirm it's for the right notebook
  message?: string;    // Optional message for UI
  // Potentially add preferred window title or other metadata later
}

export type IntentResultPayload =
  | { type: 'open_notebook'; notebookId: string; title?: string; message?: string } // Added message for UI acknowledgment
  | { type: 'open_url'; url: string; message?: string } // Added message for UI acknowledgment
  | { type: 'chat_reply'; message: string; slices?: DisplaySlice[] } // DisplaySlice for primary context
  | { type: 'plan_generated'; planData: any } // 'any' for now, can be refined
  | { type: 'error'; message: string }
  | OpenInClassicBrowserPayload;

// --- API Definition ---

// Make sure this interface stays in sync with the implementation in preload.ts
export interface IAppAPI {
  // Add signatures for all functions exposed on window.api
  getAppVersion: () => Promise<string>;
  getProfile: () => Promise<UserProfile>;
  updateProfile: (payload: UserProfileUpdatePayload) => Promise<UserProfile>;
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
   * Subscribe to bookmark import progress updates.
   * @param callback Function to call with progress events.
   * @returns A function to unsubscribe the listener.
   */
  onBookmarksProgress: (callback: (event: BookmarksProgressEvent) => void) => () => void;

  // --- Notebook Functions ---
  createNotebook: (params: { title: string, description?: string | null }) => Promise<NotebookRecord>;
  getNotebookById: (id: string) => Promise<NotebookRecord | null>;
  getAllNotebooks: () => Promise<NotebookRecord[]>;
  updateNotebook: (params: { id: string, data: { title?: string, description?: string | null } }) => Promise<NotebookRecord | null>;
  deleteNotebook: (id: string) => Promise<boolean>;
  getChunksForNotebook: (notebookId: string) => Promise<ObjectChunk[]>;

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
  classicBrowserCreate(windowId: string, bounds: Electron.Rectangle, initialUrl?: string): Promise<{ success: boolean } | undefined>;
  classicBrowserLoadUrl(windowId: string, url: string): Promise<void>;
  classicBrowserNavigate(windowId: string, action: 'back' | 'forward' | 'reload' | 'stop', url?: string): Promise<void>;
  classicBrowserSetBounds: (windowId: string, bounds: Electron.Rectangle) => void;
  classicBrowserSetVisibility: (windowId: string, shouldBeDrawn: boolean, isFocused: boolean) => void;
  classicBrowserDestroy: (windowId: string) => Promise<void>;
  onClassicBrowserState: (
    callback: (update: { windowId: string; state: Partial<ClassicBrowserPayload> }) => void
  ) => () => void; // Returns a cleanup function to unsubscribe

  // Added for WebContentsView focus
  onClassicBrowserViewFocused: (callback: (data: { windowId: string }) => void) => () => void;

  // Added for renderer to request focus
  classicBrowserRequestFocus: (windowId: string) => void; // Send-only, no return needed

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
}

// --- Windowing System Types ---
/**
 * Defines the type of content a window can hold.
 * Starts with basic types; will be expanded as specific window contents are implemented.
 */
export type WindowContentType =
  | 'placeholder'
  | 'empty'
  | 'chat'
  | 'browser'
  | 'classic-browser'
  | 'notebook_raw_editor'; // Example for a raw notebook data editor

/**
 * Base payload structure. Specific window types will extend this or use a more concrete type.
 */
export interface BaseWindowPayload {
  // Common payload properties, if any, can go here in the future.
  [key: string]: any; // Allows for arbitrary properties for now
}

/** Placeholder payload for empty or placeholder windows. */
export interface PlaceholderPayload extends BaseWindowPayload {}

/** Payload for a chat window, identifying the chat session. */
export interface ChatWindowPayload extends BaseWindowPayload {
  sessionId: string;
}

/** Payload for a browser window, specifying the initial URL. */
export interface BrowserWindowPayload extends BaseWindowPayload {
  initialUrl?: string;
}

/** Payload for a raw notebook editor window, identifying the notebook. */
export interface NotebookRawEditorPayload extends BaseWindowPayload {
  notebookId: string;
}

/** Payload for the classic browser window. */
export interface ClassicBrowserPayload extends BaseWindowPayload {
  /** The initial URL to load when creating the browser. */
  initialUrl: string;
  /** The currently loaded URL in the browser view. Updated by main process. */
  currentUrl: string;
  /** The URL the user has requested to load. Used to show in address bar while loading. */
  requestedUrl: string;
  /** Title of the currently loaded page. Updated by main process. */
  title: string;
  /** Whether the browser view is currently loading a page. Updated by main process. */
  isLoading: boolean;
  /** Whether the browser view can navigate backward. Updated by main process. */
  canGoBack: boolean;
  /** Whether the browser view can navigate forward. Updated by main process. */
  canGoForward: boolean;
  /** Error message if a navigation failed. */
  error?: string | null;
  /** URL of the favicon for the current page. */
  faviconUrl?: string | null;
}

/**
 * A discriminated union for window payloads, allowing type-safe access based on WindowMeta.type.
 */
export type WindowPayload =
  | PlaceholderPayload
  | ChatWindowPayload
  | BrowserWindowPayload
  | ClassicBrowserPayload
  | NotebookRawEditorPayload;

/**
 * Represents the metadata and state of a single window within the desktop environment.
 */
export interface WindowMeta {
  id: string; // Unique identifier for the window (e.g., UUID)
  type: WindowContentType; // The type of content/app this window displays
  title: string; // The title displayed in the window's title bar
  x: number; // X-coordinate of the window's top-left corner
  y: number; // Y-coordinate of the window's top-left corner
  width: number; // Width of the window
  height: number; // Height of the window
  zIndex: number; // Stacking order of the window
  isFocused: boolean; // Whether the window currently has focus
  isMinimized?: boolean; // Optional: Whether the window is minimized
  isMaximized?: boolean; // Optional: Whether the window is maximized
  payload: WindowPayload; // Data specific to the window's content type
}

// --- Notebook Types ---
export interface NotebookRecord {
  id: string; // UUID
  title: string;
  description: string | null;
  objectId: string; // Link to the corresponding JeffersObject
  createdAt: number; // Unix epoch milliseconds (SQLite INTEGER)
  updatedAt: number; // Unix epoch milliseconds (SQLite INTEGER)
}

declare global {
  interface Window {
    // Expose the api object defined in preload.ts
    api: IAppAPI;
  }
}

// --- User Profile Types ---

/** Types of activities that can be logged. */
export type ActivityType = 
  | 'notebook_visit'
  | 'notebook_created'
  | 'notebook_opened'
  | 'intent_selected'
  | 'chat_session_started'
  | 'chat_topic_discussed'
  | 'search_performed'
  | 'object_ingested'
  | 'content_saved'
  | 'browser_navigation'
  | 'info_slice_selected'
  | 'slice_viewed'
  | 'stated_goal_added'
  | 'stated_goal_updated'
  | 'stated_goal_completed'
  | 'todo_created'
  | 'todo_updated'
  | 'todo_completed'
  | 'todo_status_changed';

/** Represents a logged user activity. */
export interface UserActivity {
  id: string; // UUID v4
  timestamp: Date;
  activityType: ActivityType;
  detailsJson: string; // JSON string with activity-specific data
  userId: string; // For future multi-user support
}

/** Payload for logging an activity. */
export interface ActivityLogPayload {
  activityType: ActivityType;
  details: Record<string, any>; // Will be stringified before storage
  userId?: string; // Optional, defaults to 'default_user'
}

/** Represents a user-stated goal. */
export interface UserGoalItem {
  id: string; // UUID v4
  text: string;
  createdAt: number; // Unix timestamp
  status: 'active' | 'completed' | 'archived';
  priority?: number; // 1-5, lower is higher priority
}

/** Represents an AI-inferred goal with confidence. */
export interface InferredUserGoalItem {
  text: string;
  confidence?: number; // 0.0 to 1.0
  evidence?: string[]; // Brief pointers to supporting activities/todos
}

/** Represents a time-bound goal with absolute dates. */
export interface TimeBoundGoal {
  id: string; // UUID v4
  text: string;
  createdAt: string; // ISO date when goal was captured
  timeHorizon: {
    type: 'day' | 'week' | 'month' | 'quarter' | 'year';
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
  };
}

/** Represents the user's profile with explicit and synthesized data. */
export interface UserProfile {
  userId: string; // Primary key, e.g., "default_user"
  name?: string | null; // User's display name
  aboutMe?: string | null; // User's self-description
  customInstructions?: string | null; // Custom instructions for AI
  statedUserGoals?: UserGoalItem[] | null; // User-defined goals
  inferredUserGoals?: InferredUserGoalItem[] | null; // AI-inferred goals with probabilities
  timeBoundGoals?: TimeBoundGoal[] | null; // Goals with specific time horizons
  pastGoals?: TimeBoundGoal[] | null; // Historical goals (for future implementation)
  synthesizedInterests?: string[] | null; // AI-inferred interests  
  synthesizedPreferredSources?: string[] | null; // AI-inferred preferred sources
  synthesizedRecentIntents?: string[] | null; // AI-inferred recent intents
  inferredExpertiseAreas?: string[] | null; // AI-inferred areas of expertise from content
  preferredSourceTypes?: string[] | null; // AI-inferred preferred content types
  updatedAt: Date;
}

/** Payload for updating user profile. */
export interface UserProfileUpdatePayload {
  userId?: string; // Optional, defaults to 'default_user'
  name?: string | null;
  aboutMe?: string | null;
  customInstructions?: string | null;
  statedUserGoals?: UserGoalItem[] | null;
  inferredUserGoals?: InferredUserGoalItem[] | null;
  timeBoundGoals?: TimeBoundGoal[] | null;
  pastGoals?: TimeBoundGoal[] | null;
  synthesizedInterests?: string[] | null;
  synthesizedPreferredSources?: string[] | null;
  synthesizedRecentIntents?: string[] | null;
  inferredExpertiseAreas?: string[] | null;
  preferredSourceTypes?: string[] | null;
}

// --- PDF Ingestion Types ---

/** Error types for PDF ingestion. */
export enum PdfIngestionError {
  DUPLICATE_FILE = 'DUPLICATE_FILE',
  TEXT_EXTRACTION_FAILED = 'TEXT_EXTRACTION_FAILED',
  AI_PROCESSING_FAILED = 'AI_PROCESSING_FAILED',
  STORAGE_FAILED = 'STORAGE_FAILED',
  UNSUPPORTED_MIME_TYPE = 'UNSUPPORTED_MIME_TYPE',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  DATABASE_ERROR = 'DATABASE_ERROR',
}

/** Status of PDF ingestion progress. */
export type PdfIngestionStatus = 
  | 'queued'
  | 'starting_processing'
  | 'parsing_text'
  | 'generating_summary'
  | 'saving_metadata'
  | 'creating_embeddings'
  | 'complete'
  | 'duplicate'
  | 'error';

/** Progress event for PDF ingestion. */
export interface PdfIngestProgressPayload {
  fileName: string;
  filePath: string;
  status: PdfIngestionStatus;
  message?: string;
  objectId?: string;
  error?: string;
}

/** Result of a batch PDF ingestion. */
export interface PdfIngestBatchCompletePayload {
  successCount: number;
  failureCount: number;
  results: Array<{
    filePath: string;
    fileName: string;
    success: boolean;
    objectId?: string;
    error?: string;
    errorType?: PdfIngestionError;
  }>;
}

/** Result of processing a single PDF. */
export interface PdfIngestionResult {
  success: boolean;
  objectId?: string;
  status: PdfIngestionError | 'completed';
  error?: string;
}

// --- To-Do Types ---

/** Status of a to-do item. */
export type ToDoStatus = 'pending' | 'in_progress' | 'completed' | 'archived';

/** Represents a to-do item. */
export interface ToDoItem {
  id: string; // UUID v4
  userId: string;
  title: string;
  description?: string | null;
  createdAt: Date;
  dueDate?: Date | null; // "Situated in time"
  completedAt?: Date | null;
  status: ToDoStatus;
  priority?: number | null; // 1-5, lower is higher priority
  parentTodoId?: string | null; // For subtasks
  projectOrGoalId?: string | null; // Links to stated/inferred goal IDs
  relatedObjectIds?: string[] | null; // Related JeffersObject or chunk IDs
  updatedAt: Date;
}

/** Payload for creating a to-do. */
export interface ToDoCreatePayload {
  title: string;
  description?: string | null;
  dueDate?: number | null; // Unix timestamp
  priority?: number | null;
  parentTodoId?: string | null;
  projectOrGoalId?: string | null;
  relatedObjectIds?: string[] | null;
}

/** Payload for updating a to-do. */
export interface ToDoUpdatePayload {
  title?: string;
  description?: string | null;
  dueDate?: number | null;
  status?: ToDoStatus;
  priority?: number | null;
  parentTodoId?: string | null;
  projectOrGoalId?: string | null;
  relatedObjectIds?: string[] | null;
}

// --- Chat Data Structures ---

/** Represents a chat conversation session persisted in the database. */
export interface IChatSession {
    /** UUID v4 */
    sessionId: string;
    /** Foreign key linking to the notebooks table. */
    notebookId: string;
    /** Date object representing creation time. */
    createdAt: Date;
    /** Date object representing last update time. */
    updatedAt: Date;
    /** Optional user-defined title for the session. */
    title?: string | null;
}

/** Represents a single message within a chat session, persisted in the database. */
export interface IChatMessage {
    /** UUID v4 */
    messageId: string;
    /** Foreign key linking to the chat_sessions table. */
    sessionId: string;
    /** Date object representing the time of the message. */
    timestamp: Date;
    /** The role of the message sender. */
    role: ChatMessageRole;
    /** The textual content of the message. */
    content: string;
    /**
     * Optional field for storing additional data as a JSON string in the database.
     * In application code, this should be undefined or a parsed object (e.g., ChatMessageSourceMetadata),
     * not the raw string. The mapping layer handles this.
     */
    metadata?: string | null; // Stays as string for DB representation, parsed in StructuredChatMessage
}

/** Helper type representing a chat message with its metadata parsed from JSON string. */
// Omit 'metadata' from IChatMessage because we're replacing its type.
// Also, the property names in IChatMessage will now be camelCase, so Omit will work correctly.
export type StructuredChatMessage = Omit<IChatMessage, 'metadata'> & {
    metadata?: ChatMessageSourceMetadata | null;
};

// --- IPC Payload Types ---
// Following the verb-noun naming pattern for action payloads

/** Payload for saving a temporary file. */
export interface SaveTempFilePayload {
  fileName: string;
  data: Uint8Array;
}

/** Payload for importing bookmarks from a file. */
export interface ImportBookmarksPayload {
  filePath: string;
}

/** Payload for setting a value in the persistent store. */
export interface SetStorePayload {
  key: string;
  value: string;
}

/** Payload for removing a value from the persistent store. */
export interface RemoveStorePayload {
  key: string;
}

/** Payload for getting a value from the persistent store. */
export interface GetStorePayload {
  key: string;
}

/** Payload for starting a chat stream. */
export interface StartChatStreamPayload {
  sessionId: string;
  question: string;
  notebookId: string;
}

/** Payload for requesting PDF ingestion. */
export interface PdfIngestRequestPayload {
  filePaths: string[];
}

// Type definitions for IngestionJob - moved from IngestionJobModel.ts
export type JobType = 'pdf' | 'url' | 'text_snippet';

export type JobStatus = 
  | 'queued'
  | 'processing_source'
  | 'parsing_content'
  | 'ai_processing'
  | 'persisting_data'
  | 'vectorizing'
  | 'awaiting_chunking' // New status for handoff to ChunkingService
  | 'chunking_in_progress' // New status for active chunking
  | 'completed'
  | 'failed'
  | 'retry_pending'
  | 'cancelled';

export interface JobProgress {
  stage: string;
  percent: number;
  message?: string;
}

export interface JobSpecificData {
  // PDF specific
  pdfPassword?: string;
  fileSize?: number;
  sha256_hash?: string; // For PDF deduplication
  
  // URL specific
  headers?: Record<string, string>;
  userAgent?: string;
  
  // Common
  relatedObjectId?: string;
  notebookId?: string;
  
  // Common options
  chunkingStrategy?: 'semantic' | 'summary_only' | 'fixed_size';
  maxRetries?: number;
}

export interface IngestionJob {
  id: string;
  jobType: JobType;
  sourceIdentifier: string;
  originalFileName?: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  progress?: JobProgress;
  errorInfo?: string;
  failedStage?: string;
  // Add new fields for chunking service coordination
  chunking_status?: 'pending' | 'in_progress' | 'completed' | 'failed' | null;
  chunking_error_info?: string | null;
  jobSpecificData?: JobSpecificData;
  relatedObjectId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

// New type definition for CreateIngestionJobParams
export interface CreateIngestionJobParams {
  jobType: JobType;
  sourceIdentifier: string;
  originalFileName?: string;
  priority?: number;
  jobSpecificData?: JobSpecificData;
}

// New type definition for UpdateIngestionJobParams
export interface UpdateIngestionJobParams {
  status?: JobStatus;
  attempts?: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  progress?: JobProgress;
  errorInfo?: string;
  failedStage?: string;
  relatedObjectId?: string;
  completedAt?: number;
  // Add chunking fields here as well
  chunking_status?: 'pending' | 'in_progress' | 'completed' | 'failed' | null;
  chunking_error_info?: string | null;
} 