import { BaseMessage } from "@langchain/core/messages";

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
  timestamp: string; 
}

// Structure expected by LangChain memory/chains (or UI)
// Represents the conversation history.
export type ChatHistory = BaseMessage[];

/** Represents a chat conversation session persisted in the database. */
export interface IChatSession {
    /** UUID v4 */
    sessionId: string;
    /** Foreign key linking to the notebooks table. */
    notebookId: string;
    /** ISO 8601 timestamp string representing creation time. */
    createdAt: string;
    /** ISO 8601 timestamp string representing last update time. */
    updatedAt: string;
    /** Optional user-defined title for the session. */
    title?: string | null;
}

/** Represents a single message within a chat session, persisted in the database. */
export interface IChatMessage {
    /** UUID v4 */
    messageId: string;
    /** Foreign key linking to the chat_sessions table. */
    sessionId: string;
    /** ISO 8601 timestamp string representing the time of the message. */
    timestamp: string;
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

/** Payload for starting a chat stream. */
export interface StartChatStreamPayload {
  sessionId: string;
  question: string;
  notebookId: string;
}