/**
 * Types for vector database operations and storage.
 * These types define the schema for LanceDB's columnar storage using Apache Arrow.
 * Every field maps 1:1 to a column in the LanceDB table.
 */

/**
 * Standardized media types used across the system.
 * These values must match the CHECK constraint in the SQLite objects table.
 */
export type MediaType = 'webpage' | 'pdf' | 'notebook' | 'note' | 'tab_group' | 'image';

/**
 * Base type for all vector records in LanceDB.
 * Every field maps directly to a column in the table.
 */
export interface BaseVectorRecord {
  // === Primary Key ===
  id: string;                          // UUID for this vector row

  // === Record Classification ===
  recordType: 'object' | 'chunk';      // Whole thing vs part of thing
  mediaType: MediaType;                // Same as JeffersObject.objectType - just renamed for vectors

  // === Cognitive Layer ===
  layer: 'ins' | 'wom' | 'lom' | 'om'; // Intent Stream | Working Memory | Long Term Memory | Ontological Model
  processingDepth: 'title' | 'summary' | 'chunk'; // Processing granularity

  // === Vector Data ===
  vector?: Float32Array;               // Nullable for INS and title-only rows
  content?: string;                    // Nullable for title-only rows

  // === Timestamp ===
  createdAt: number;                   // Unix ms (immutable - no updatedAt)
  lastAccessedAt?: number;             // Unix ms, updated on access

  // === Foreign Keys ===
  objectId?: string;                   // FK to objects.id
  sqlChunkId?: number;                 // FK to chunks.id  
  chunkIdx?: number;                   // Position within document
  notebookId?: string;                 // FK to notebooks.id
  tabGroupId?: string;                 // For WOM tab grouping

  // === Semantic Metadata ===
  title?: string;                      // Document/tab/group title
  summary?: string;                    // AI-generated summary
  sourceUri?: string;                  // Original URL/file path

  // === Array Fields ===
  tags?: string[];                     // Semantic tags
  propositions?: string[];             // Key facts/claims
}

/**
 * Layer-specific types using exact abbreviations
 */

// INS - Intent Stream (not embedded - typically SQLite only)
export type INSVector = BaseVectorRecord & {
  layer: 'ins';
  processingDepth: 'title';
  vector?: undefined;                  // No embeddings at INS layer
};

// WOM - Working memory tab
export type WOMTabVector = BaseVectorRecord & {
  layer: 'wom';
  processingDepth: 'summary';
  recordType: 'object';                // Tabs are whole objects
  objectId: string;
  vector: Float32Array;                // Required for WOM
};

// WOM - Tab group summary
export type WOMGroupVector = BaseVectorRecord & {
  layer: 'wom';
  processingDepth: 'summary';
  recordType: 'object';                // Tab groups are whole objects
  mediaType: 'tab_group';              // Explicitly a tab group
  objectId?: undefined;                // Synthetic row
  tabGroupId: string;
  title: string;
  vector: Float32Array;
};

// LOM - Document chunk
export type LOMChunkVector = BaseVectorRecord & {
  layer: 'lom';
  processingDepth: 'chunk';
  recordType: 'chunk';                 // This is a part of an object
  objectId: string;
  sqlChunkId: number;
  chunkIdx: number;
  vector: Float32Array;
  content: string;
};

// LOM - Document summary
export type LOMSummaryVector = BaseVectorRecord & {
  layer: 'lom';
  processingDepth: 'summary';
  recordType: 'object';                // Summary of whole object
  objectId: string;
  vector: Float32Array;
};

// OM - Ontology concept (not currently embedded)
export type OMVector = BaseVectorRecord & {
  layer: 'om';
  processingDepth: 'summary' | 'chunk';
  recordType: 'object';                // Ontological concepts are whole things
  objectId: string;
  vector: Float32Array;
};

// Union type
export type VectorRecord = 
  | INSVector
  | WOMTabVector 
  | WOMGroupVector
  | LOMChunkVector
  | LOMSummaryVector
  | OMVector;

/**
 * Filter options that map to LanceDB WHERE clauses
 */
export interface VectorSearchFilter {
  // Layer filtering
  layer?: BaseVectorRecord['layer'] | BaseVectorRecord['layer'][];
  processingDepth?: BaseVectorRecord['processingDepth'] | BaseVectorRecord['processingDepth'][];
  
  // Record type filtering
  recordType?: BaseVectorRecord['recordType'] | BaseVectorRecord['recordType'][];
  mediaType?: MediaType | MediaType[];
  
  // ID filtering
  objectId?: string | string[];
  notebookId?: string;
  tabGroupId?: string;
  
  // Array contains (requires special SQL)
  hasTag?: string;
  hasTags?: string[];
  
  // Date range
  createdAfter?: number;
  createdBefore?: number;
  
  // Text search (if LanceDB supports)
  titleContains?: string;
  contentContains?: string;
  
  // Custom SQL escape hatch
  customWhere?: string;
}

/**
 * Options for vector search operations
 */
export interface VectorSearchOptions {
  k?: number;                          // Number of results
  filter?: VectorSearchFilter;         // Filter criteria
  includeScore?: boolean;              // Include similarity scores
  includeDistance?: boolean;           // Include raw distances
}

/**
 * Search result with metadata
 */
export interface VectorSearchResult {
  record: VectorRecord;                // The full record
  score: number;                       // Similarity score (0-1)
  distance: number;                    // Raw distance from query
}

/**
 * Interface for vector store operations.
 * Replaces the minimal IVectorStore in chunk.types.ts
 */
export interface IVectorStoreModel {
  // Initialization
  initialize(): Promise<void>;
  isReady(): boolean;
  
  // Document operations
  addDocuments(documents: VectorRecord[]): Promise<string[]>;
  addDocumentsWithText(texts: string[], metadata: Omit<VectorRecord, 'vector' | 'content'>[]): Promise<string[]>;
  deleteDocumentsByIds(ids: string[]): Promise<void>;
  
  // Search operations
  querySimilarByText(queryText: string, options?: VectorSearchOptions): Promise<VectorSearchResult[]>;
  querySimilarByVector(queryVector: number[], options?: VectorSearchOptions): Promise<VectorSearchResult[]>;
  
  // LangChain compatibility
  getRetriever?(k?: number, filter?: VectorSearchFilter): Promise<any>;
  
  // Batch operations
  updateMetadata?(objectId: string, metadata: Partial<BaseVectorRecord>): Promise<void>;
  
  // Admin operations
  createIndex?(field: keyof BaseVectorRecord): Promise<void>;
  vacuum?(): Promise<void>;
}

/**
 * LanceDB-specific table configuration
 */
export interface LanceTableConfig {
  tableName: string;
  vectorDimension: number;
  distanceMetric?: 'cosine' | 'euclidean' | 'dot';
  indexType?: 'ivf_pq' | 'ivf_sq' | 'flat';
}