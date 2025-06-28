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
  propositions?: string[]; // Key factual statements extracted from the chunk (for local results)
  // WOM-specific metadata
  isActive?: boolean; // Indicates document is in working memory
  lastAccessed?: string; // ISO date string of last access
}

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

/** Represents the state of context slice fetching for a message. */
export interface ContextState<T = SliceDetail[]> {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  data: T | null;
}