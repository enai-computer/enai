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
export type ObjectStatus = 'new' | 'fetched' | 'parsed' | 'chunking' | 'chunked' | 'chunking_failed' | 'embedding' | 'embedded' | 'embedding_failed' | 'error';

/** Represents a top-level object in the system (corresponds to 'objects' table). */
export interface JeffersObject {
  id: string; // UUID v4
  objectType: string; // e.g., 'bookmark', 'note'
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
}

/** Represents a chunk of text derived from an object (corresponds to 'chunks' table). */
export interface ObjectChunk {
  id: number; // Surrogate key from DB
  objectId: string; // Foreign key to JeffersObject.id
  notebook_id?: string | null; // Foreign key to Notebooks.id, optional
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

export type ChatMessageRole = 'user' | 'assistant' | 'system';

/** Defines the structure for metadata containing source chunk information. */
export interface ChatMessageSourceMetadata {
  /** Array of chunk IDs (ObjectChunk.id) used as context for the message. */
  sourceChunkIds?: number[];
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
  timestamp: string; // ISO 8601 String representation
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

// --- Slice/Context Detail Type ---
/** Represents the detailed information of a source text slice, suitable for display. */
export interface SliceDetail {
  /** The ID of the original chunk in the database (chunks.id). */
  chunkId: number;
  /** The full text content of the chunk/slice. */
  content: string;
  /** The ID of the source object (objects.id) this slice belongs to. */
  sourceObjectId: string;
  /** The title of the source object (if available). */
  sourceObjectTitle: string | null;
  /** The original URI of the source object (if available). */
  sourceObjectUri: string | null;
  // TODO: Add other relevant fields like summary, tags if needed later
}

// --- Add new Context State Type ---
/** Represents the state of context slice fetching for a message. */
export interface ContextState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  data: SliceDetail[] | null;
}

// --- Intent Handling Types ---
export interface IntentPayload {
  intentText: string;
  currentNotebookId?: string; // Optional: if the intent is scoped to an active notebook
}

export type IntentResultPayload =
  | { type: 'open_notebook'; notebookId: string; title?: string } // Added title for UI
  | { type: 'chat_reply'; message: string; sources?: SliceDetail[] } // Using SliceDetail for sources
  | { type: 'plan_generated'; planData: any } // 'any' for now, can be refined
  | { type: 'error'; message: string };

// --- API Definition ---

// Make sure this interface stays in sync with the implementation in preload.ts
export interface IAppAPI {
  // Add signatures for all functions exposed on window.api
  getAppVersion: () => Promise<string>;
  getProfile: () => Promise<{ name?: string }>;
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
  startChatStream: (sessionId: string, question: string) => void;

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
  setIntent: (payload: IntentPayload) => Promise<void>; // Or Promise<InitialAcknowledgementType> if needed

  /**
   * Subscribes to results from processed intents.
   * @param callback Function to call with intent results.
   * @returns A function to unsubscribe the listener.
   */
  onIntentResult: (callback: (result: IntentResultPayload) => void) => () => void;
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

/**
 * A discriminated union for window payloads, allowing type-safe access based on WindowMeta.type.
 */
export type WindowPayload =
  | PlaceholderPayload
  | ChatWindowPayload
  | BrowserWindowPayload
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
  payload: WindowPayload; // Data specific to the window's content type
}

// --- Notebook Types ---
export interface NotebookRecord {
  id: string; // UUID
  title: string;
  description: string | null;
  createdAt: number; // Unix epoch milliseconds (SQLite INTEGER)
  updatedAt: number; // Unix epoch milliseconds (SQLite INTEGER)
}

declare global {
  interface Window {
    // Expose the api object defined in preload.ts
    api: IAppAPI;
  }
}

// --- Chat Data Structures ---

/** Represents a chat conversation session persisted in the database. */
export interface IChatSession {
    /** UUID v4 */
    session_id: string;
    /** Foreign key linking to the notebooks table. */
    notebook_id: string;
    /** ISO 8601 timestamp (e.g., "2023-10-27T10:00:00Z") */
    created_at: string;
    /** ISO 8601 timestamp (e.g., "2023-10-27T10:05:00Z") */
    updated_at: string;
    /** Optional user-defined title for the session. */
    title?: string | null;
}

/** Represents a single message within a chat session, persisted in the database. */
export interface IChatMessage {
    /** UUID v4 */
    message_id: string;
    /** Foreign key linking to the chat_sessions table. */
    session_id: string;
    /** ISO 8601 timestamp (e.g., "2023-10-27T10:01:30Z") */
    timestamp: string;
    /** The role of the message sender. */
    role: ChatMessageRole;
    /** The textual content of the message. */
    content: string;
    /**
     * Optional field for storing additional data as a JSON string in the database.
     * Should be parsed into structured types (like ChatMessageSourceMetadata) in the application layer.
     */
    metadata?: string | null;
}

/** Helper type representing a chat message with its metadata parsed from JSON string. */
export type StructuredChatMessage = Omit<IChatMessage, 'metadata'> & {
    metadata?: ChatMessageSourceMetadata | null;
}; 