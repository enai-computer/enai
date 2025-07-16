/** Type of note content. */
export type NoteType = 'text' | 'ai_generated';

/** Metadata for notes, extensible for future features. */
export interface NoteMetadata {
  aiModel?: string;
  prompt?: string;
  // Future: chatSessionId, embeddings, etc.
}

/** Represents a note within a notebook. */
export interface Note {
  id: string; // UUID v4
  notebookId: string;
  content: string;
  type: NoteType;
  metadata?: NoteMetadata | null;
  position: number;
  createdAt: string; // ISO 8601 timestamp
  updatedAt: string; // ISO 8601 timestamp
}

/** Payload for creating a note. */
export interface CreateNotePayload {
  notebookId: string;
  content: string;
  type?: NoteType;
  metadata?: NoteMetadata;
}

/** Payload for updating a note. */
export interface UpdateNotePayload {
  content: string;
}