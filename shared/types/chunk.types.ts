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

/** Basic interface for a vector store operations needed by ChunkingService. */
export interface IVectorStore {
  /** Adds documents (chunks) to the vector store. */
  addDocuments(documents: { pageContent: string; metadata: Record<string, any> }[]): Promise<string[]>;
}