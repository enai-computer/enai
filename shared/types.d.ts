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

export type ChatMessageRole = 'user' | 'assistant' | 'system';

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

  // --- Chat Functions ---
  /**
   * Starts the chat stream for a given session.
   * Sends the sessionId and question to the main process.
   * Responses will be sent back via ON_CHAT_RESPONSE_CHUNK etc.
   */
  startChatStream: (sessionId: string, question: string) => void;

  /** Request to stop the current chat stream for the window. */
  stopChatStream: () => void;

  /** Subscribe to incoming chat response chunks. Returns cleanup fn. */
  onChatChunk: (callback: (chunk: string) => void) => () => void;

  /** Subscribe to the stream end signal. Returns cleanup fn. */
  onChatStreamEnd: (callback: () => void) => () => void;

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
  ) => Promise<IChatMessage[]>;
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
    /** Optional field for storing additional data (e.g., sources, token counts) as a JSON string. */
    metadata?: string | null;
} 