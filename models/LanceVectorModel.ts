// Conditional vectordb import will be handled by getVectorDB function
// import { connect, Table, Connection } from 'vectordb';
// import * as lancedb from 'vectordb';
import { Document } from '@langchain/core/documents';
import { VectorStoreRetriever } from '@langchain/core/vectorstores';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { createEmbeddingModel } from '../utils/llm';
import { OpenAIEmbeddings } from '@langchain/openai';
import Database from 'better-sqlite3';
import * as arrow from 'apache-arrow';
import { 
  IVectorStoreModel, 
  VectorRecord, 
  VectorSearchOptions, 
  VectorSearchResult,
  VectorSearchFilter,
  BaseVectorRecord
} from '../shared/types/vector.types';

// Type for the vectordb module
type VectorDBModule = {
  connect: (path: string) => any;
  Table: any;
  Connection: any;
  [key: string]: any;
};

/**
 * Helper function to conditionally load the correct vectordb module.
 * Checks if running in Electron (and not via ELECTRON_RUN_AS_NODE) 
 * and loads the appropriate build (packaged vs. unpackaged vs. default Node).
 */
function getVectorDB(): VectorDBModule {
  const isElectron = typeof process.versions.electron === 'string';
  const isElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE === '1';
  const isTrueElectron = isElectron && !isElectronRunAsNode;
  
  let app: any;
  let isPackaged = false;
  if (isTrueElectron) {
    try {
      // Conditionally require electron only when needed and available
      app = require('electron').app;
      // Ensure app was successfully required before checking isPackaged
      isPackaged = app?.isPackaged ?? false; 
    } catch (e) {
      logger.warn("[LanceVectorModel] Failed to require Electron module, assuming unpackaged environment.");
    }
  }

  if (isTrueElectron) {
    let electronVectorDBPath: string | undefined;
    
    // Check isPackaged (which implies app was successfully required)
    if (isPackaged) { 
      // Packaged App: Look relative to resourcesPath (expecting it to be unpacked)
      const basePath = (process as { resourcesPath: string }).resourcesPath;
      // Try common unpacked path first
      let potentialPath = path.join(basePath, 'app.asar.unpacked', 'electron_modules', 'vectordb');
      if (fs.existsSync(potentialPath)) {
          electronVectorDBPath = potentialPath;
      } else {
          // Try path directly in resourcesPath
          potentialPath = path.join(basePath, 'electron_modules', 'vectordb');
          if (fs.existsSync(potentialPath)) {
             electronVectorDBPath = potentialPath;
          }
      }
      if (electronVectorDBPath) {
           logger.info(`[LanceVectorModel] Packaged Electron detected. Attempting load from: ${electronVectorDBPath}`);
      } else {
          logger.warn(`[LanceVectorModel] Packaged Electron detected, but module not found at expected unpacked paths relative to resourcesPath: ${basePath}. Will attempt default load.`);
      }

    } else {
      // Unpackaged Electron (Development): Look relative to __dirname
      try {
          const potentialPath = path.resolve(__dirname, '../../electron_modules', 'vectordb');
          if (fs.existsSync(potentialPath)) {
             electronVectorDBPath = potentialPath;
             logger.info(`[LanceVectorModel] Unpackaged Electron detected. Attempting load from: ${electronVectorDBPath}`);
          } else {
             logger.warn(`[LanceVectorModel] Unpackaged Electron detected, but module not found at relative path: ${potentialPath}. Will attempt default load.`);
          }
      } catch (resolveError) {
         logger.warn(`[LanceVectorModel] Error resolving relative path for unpackaged Electron build:`, resolveError);
      }
    }
    
    // Attempt to load the Electron-specific path if found
    if (electronVectorDBPath) {
       try {
          const vectordb = require(electronVectorDBPath) as VectorDBModule;
          logger.info('[LanceVectorModel] Successfully loaded Electron-specific vectordb build.');
          return vectordb;
       } catch (error) {
           logger.warn(`[LanceVectorModel] Found Electron-specific path but failed to load module:`, error);
           // Fall through to default load
       }
    }
  }
  
  // Default / Fallback: Load the standard Node build from node_modules
  logger.debug('[LanceVectorModel] Loading default vectordb build from node_modules.');
  try {
     return require('vectordb') as VectorDBModule;
  } catch (defaultError) {
     logger.error(`[LanceVectorModel] CRITICAL: Failed to load default vectordb build!`, defaultError);
     // This is a fatal error for the vector DB layer
     throw defaultError;
  }
}

export interface LanceVectorModelDeps {
  userDataPath: string;
}

const TABLE_NAME = 'enai_embeddings';
const VECTOR_DIMENSION = 1536;

export class LanceVectorModel implements IVectorStoreModel {
  private db: any = null;
  private table: any = null;
  private embeddings: OpenAIEmbeddings | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private initializationError: Error | null = null;
  private deps: LanceVectorModelDeps;

  constructor(deps: LanceVectorModelDeps) {
    this.deps = deps;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('[LanceVectorModel] Already initialized.');
      return;
    }

    if (this.initializationPromise) {
      logger.debug('[LanceVectorModel] Initialization in progress, waiting...');
      return this.initializationPromise;
    }

    this.initializationPromise = this._performInitialization();
    return this.initializationPromise;
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  private async _performInitialization(): Promise<void> {
    try {
      logger.info('[LanceVectorModel] Starting initialization...');

      // Get the path for LanceDB storage
      const lanceDbPath = path.join(this.deps.userDataPath, 'data', 'lancedb');
      
      // Ensure directory exists
      fs.mkdirSync(lanceDbPath, { recursive: true });
      logger.debug('[LanceVectorModel] LanceDB path:', lanceDbPath);

      // Connect to LanceDB
      const vectordb = getVectorDB();
      this.db = await vectordb.connect(lanceDbPath);
      logger.info('[LanceVectorModel] Connected to LanceDB.');

      // Open or create table
      try {
        this.table = await this.db.openTable(TABLE_NAME);
        logger.info('[LanceVectorModel] Opened existing table:', TABLE_NAME);
      } catch (error) {
        logger.info('[LanceVectorModel] Table not found, creating new table:', TABLE_NAME);
        
        // Create table with full schema using a dummy row
        const dummyId = uuidv4();
        const dummyVector = new Float32Array(VECTOR_DIMENSION);
        
        // Create a dummy record with all fields from BaseVectorRecord
        const dummyRecord: BaseVectorRecord = {
          // Primary key
          id: dummyId,
          
          // Record classification
          recordType: 'chunk',
          mediaType: 'webpage' as any, // Dummy value, immediately deleted
          
          // Cognitive layer fields
          layer: 'lom',
          processingDepth: 'chunk',
          
          // Vector data
          vector: dummyVector,
          content: 'dummy',
          
          // Timestamp
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          
          // Foreign keys - use empty strings instead of undefined for Arrow type inference
          objectId: '',  // Empty string instead of undefined
          sqlChunkId: 0, // Use 0 instead of undefined for numbers
          chunkIdx: 0,
          notebookId: '',
          tabGroupId: '',
          
          // Semantic metadata - use empty strings for Arrow type inference
          title: '',
          summary: '',
          sourceUri: '',
          
          // Array fields - need at least one element for Arrow type inference
          tags: ['dummy-tag'],
          propositions: ['dummy-proposition']
        };
        
        this.table = await this.db.createTable(TABLE_NAME, [dummyRecord] as unknown as Record<string, unknown>[]);
        
        // Immediately delete the dummy row
        await this.table!.delete(`\`id\` = '${dummyId}'`);
        
        logger.info('[LanceVectorModel] Created new table with full schema and removed dummy row.');
      }

      // Initialize OpenAI embeddings
      this.embeddings = createEmbeddingModel('text-embedding-3-small');
      logger.info('[LanceVectorModel] OpenAI embedding model initialized.');

      // Check if we need to create an index (for large datasets)
      try {
        // Check if table has any records using filter instead of search
        const countResult = await this.table!.filter("1=1").limit(1).execute();
        // Skip index creation for now - can be added later based on performance needs
        logger.debug('[LanceVectorModel] Table initialized successfully.');
      } catch (error) {
        logger.debug('[LanceVectorModel] Could not check table size:', error);
      }

      this.isInitialized = true;
      logger.info('[LanceVectorModel] Initialization complete.');
    } catch (error) {
      this.initializationError = error as Error;
      logger.error('[LanceVectorModel] Initialization failed:', error);
      throw error;
    }
  }

  async addDocumentsWithText(texts: string[], metadata: Omit<VectorRecord, 'vector' | 'content'>[]): Promise<string[]> {
    if (!this.isInitialized || !this.table || !this.embeddings) {
      throw new Error('LanceVectorModel not initialized');
    }

    if (texts.length === 0) {
      logger.debug('[LanceVectorModel] No texts to add.');
      return [];
    }

    if (texts.length !== metadata.length) {
      throw new Error(`Text count (${texts.length}) does not match metadata count (${metadata.length})`);
    }

    try {
      logger.debug(`[LanceVectorModel] Embedding ${texts.length} texts...`);
      
      // Generate embeddings for all texts
      const embeddings = await this.embeddings.embedDocuments(texts);
      
      // Create full VectorRecord objects
      const records: VectorRecord[] = texts.map((text, index) => {
        const meta = metadata[index];
        const record: BaseVectorRecord = {
          ...meta,
          vector: new Float32Array(embeddings[index]),
          content: text,
          // Ensure required fields have defaults if not provided
          layer: meta.layer || 'lom',
          processingDepth: meta.processingDepth || 'chunk',
          createdAt: meta.createdAt || new Date().toISOString(),
          lastAccessedAt: meta.lastAccessedAt || new Date().toISOString(),
          tags: meta.tags || [],
          propositions: meta.propositions || []
        };
        return record as VectorRecord;
      });

      // Use the existing addDocuments method
      return this.addDocuments(records);
    } catch (error) {
      logger.error('[LanceVectorModel] Error in addDocumentsWithText:', error);
      throw error;
    }
  }

  async addDocuments(documents: VectorRecord[]): Promise<string[]> {
    if (!this.isInitialized || !this.table || !this.embeddings) {
      throw new Error('LanceVectorModel not initialized');
    }

    if (documents.length === 0) {
      logger.debug('[LanceVectorModel] No documents to add.');
      return [];
    }

    try {
      logger.debug(`[LanceVectorModel] Adding ${documents.length} documents...`);

      // Prepare records for insertion with proper type handling
      const records = documents.map(doc => {
        // Ensure vector is Float32Array if provided
        const vectorFloat32 = doc.vector 
          ? (doc.vector instanceof Float32Array ? doc.vector : new Float32Array(doc.vector))
          : new Float32Array(VECTOR_DIMENSION); // Provide empty vector if missing
        
        // Ensure ALL fields match the dummy record schema exactly
        const record: BaseVectorRecord = {
          // Primary key
          id: doc.id,
          
          // Record classification - required fields
          recordType: doc.recordType,
          mediaType: doc.mediaType,
          
          // Cognitive layer fields - required
          layer: doc.layer || 'lom',
          processingDepth: doc.processingDepth || 'chunk',
          
          // Vector data
          vector: vectorFloat32,
          content: doc.content || '',
          
          // Timestamp
          createdAt: doc.createdAt || new Date().toISOString(),
          lastAccessedAt: doc.lastAccessedAt || new Date().toISOString(),
          
          // Foreign keys - use empty strings instead of undefined
          objectId: doc.objectId || '',
          sqlChunkId: doc.sqlChunkId ?? 0,  // Use 0 for undefined numbers
          chunkIdx: doc.chunkIdx ?? 0,
          notebookId: doc.notebookId || '',
          tabGroupId: doc.tabGroupId || '',
          
          // Semantic metadata - use empty strings instead of undefined
          title: doc.title || '',
          summary: doc.summary || '',
          sourceUri: doc.sourceUri || '',
          
          // Array fields - ensure non-empty arrays
          tags: (doc.tags && doc.tags.length > 0) ? doc.tags : [''],
          propositions: (doc.propositions && doc.propositions.length > 0) ? doc.propositions : ['']
        };
        
        return record;
      });

      // Insert into LanceDB
      await this.table!.add(records as unknown as Record<string, unknown>[]);
      
      const vectorIds = records.map(r => r.id);
      logger.info(`[LanceVectorModel] Added ${documents.length} documents to LanceDB.`);
      
      return vectorIds;
    } catch (error) {
      logger.error('[LanceVectorModel] Error adding documents:', error);
      throw error;
    }
  }

  async querySimilarByText(queryText: string, options: VectorSearchOptions = {}): Promise<VectorSearchResult[]> {
    if (!this.isInitialized || !this.table || !this.embeddings) {
      throw new Error('LanceVectorModel not initialized');
    }

    try {
      const { k = 10, filter } = options;
      logger.debug(`[LanceVectorModel] Querying similar documents by text, k=${k}`);
      
      // Embed the query text
      const queryVector = await this.embeddings.embedQuery(queryText);
      
      // Use the vector query method
      return this.querySimilarByVector(queryVector, options);
    } catch (error) {
      logger.error('[LanceVectorModel] Error querying by text:', error);
      throw error;
    }
  }

  private createVectorRecordFromResult(data: Record<string, any>): VectorRecord {
    // Helper function to safely convert to number
    const toNumber = (value: any): number | undefined => {
      if (value === undefined || value === null) return undefined;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') return Number(value);
      if (typeof value === 'bigint') return Number(value);
      return undefined;
    };

    return {
      id: data.id as string,
      recordType: data.recordType as VectorRecord['recordType'],
      mediaType: data.mediaType as string,
      layer: data.layer as VectorRecord['layer'],
      processingDepth: data.processingDepth as VectorRecord['processingDepth'],
      vector: data.vector as Float32Array | undefined,
      content: data.content as string | undefined,
      createdAt: data.createdAt as string,
      lastAccessedAt: data.lastAccessedAt as string | undefined,
      objectId: data.objectId as string | undefined,
      sqlChunkId: toNumber(data.sqlChunkId),
      chunkIdx: toNumber(data.chunkIdx),
      notebookId: data.notebookId as string | undefined,
      tabGroupId: data.tabGroupId as string | undefined,
      title: data.title as string | undefined,
      summary: data.summary as string | undefined,
      sourceUri: data.sourceUri as string | undefined,
      tags: data.tags as string[] | undefined,
      propositions: data.propositions as string[] | undefined
    } as VectorRecord;
  }

  async querySimilarByVector(queryVector: number[], options: VectorSearchOptions = {}): Promise<VectorSearchResult[]> {
    if (!this.isInitialized || !this.table) {
      throw new Error('LanceVectorModel not initialized');
    }

    try {
      const { k = 10, filter } = options;
      logger.debug(`[LanceVectorModel] Querying similar documents by vector, k=${k}`);
      
      let search = this.table!.search(queryVector).limit(k);
      
      if (filter) {
        const whereClause = this.buildWhereClause(filter);
        if (whereClause) {
          search = search.where(whereClause);
          logger.debug('[LanceVectorModel] Applied filter:', whereClause);
        }
      }
      
      const results = await search.execute();
      
      const searchResults: VectorSearchResult[] = results.map((result: any) => {
        const rawResult = result as Record<string, unknown> & { _distance?: number };
        const distance = rawResult._distance || 0;
        const similarity = 1 - distance;
        
        return {
          record: this.createVectorRecordFromResult(rawResult),
          score: similarity,
          distance: distance
        };
      });
      
      logger.debug(`[LanceVectorModel] Found ${searchResults.length} similar documents.`);
      return searchResults;
    } catch (error) {
      logger.error('[LanceVectorModel] Error querying by vector:', error);
      throw error;
    }
  }

  async deleteDocumentsByIds(ids: string[]): Promise<void> {
    if (!this.isInitialized || !this.table) {
      throw new Error('LanceVectorModel not initialized');
    }

    if (ids.length === 0) {
      logger.debug('[LanceVectorModel] No documents to delete.');
      return;
    }

    try {
      logger.debug(`[LanceVectorModel] Deleting ${ids.length} documents...`);
      
      // Build deletion predicate
      const idList = ids.map(id => `'${id}'`).join(', ');
      const predicate = `id IN [${idList}]`;
      
      // Execute deletion
      await this.table!.delete(predicate);
      
      logger.info(`[LanceVectorModel] Deleted ${ids.length} documents from LanceDB.`);
    } catch (error) {
      logger.error('[LanceVectorModel] Error deleting documents:', error);
      throw error;
    }
  }

  async getRetriever(k: number = 10, filter?: VectorSearchFilter): Promise<VectorStoreRetriever> {
    if (!this.isInitialized) {
      throw new Error('LanceVectorModel not initialized');
    }

    const vectorStore = {
      similaritySearch: async (query: string, k: number, filter?: VectorSearchFilter): Promise<Document[]> => {
        const results = await this.querySimilarByText(query, { k, filter });
        return results.map(r => new Document({ 
          pageContent: r.record.content || '', 
          metadata: r.record as unknown as Record<string, unknown>
        }));
      },
      _vectorstoreType: () => 'lancedb',
    } as any;

    return new VectorStoreRetriever({
      vectorStore,
      k,
      filter
    });
  }


  // Helper method for LangChain compatibility
  async similaritySearch(query: string, k: number = 10, filter?: VectorSearchFilter): Promise<Document[]> {
    const results = await this.querySimilarByText(query, { k, filter });
    return results.map(r => new Document({ pageContent: r.record.content || '', metadata: r.record }));
  }

  // Helper to escape SQL string values
  private escapeString(value: string): string {
    // Escape single quotes by doubling them (SQL standard)
    return value.replace(/'/g, "''");
  }

  // Helper to build where clause from filter object
  private buildWhereClause(filter: VectorSearchFilter): string | null {
    if (!filter || typeof filter !== 'object') {
      return null;
    }

    const conditions: string[] = [];

    // Handle layer filtering
    if (filter.layer) {
      if (Array.isArray(filter.layer)) {
        const escapedLayers = filter.layer.map(l => `'${this.escapeString(l)}'`).join(', ');
        conditions.push(`\`layer\` IN (${escapedLayers})`);
      } else {
        conditions.push(`\`layer\` = '${this.escapeString(filter.layer)}'`);
      }
    }

    // Handle processingDepth filtering
    if (filter.processingDepth) {
      if (Array.isArray(filter.processingDepth)) {
        const escapedDepths = filter.processingDepth.map(d => `'${this.escapeString(d)}'`).join(', ');
        conditions.push(`\`processingDepth\` IN (${escapedDepths})`);
      } else {
        conditions.push(`\`processingDepth\` = '${this.escapeString(filter.processingDepth)}'`);
      }
    }

    // Handle ID filtering
    if (filter.objectId) {
      if (Array.isArray(filter.objectId)) {
        const escapedIds = filter.objectId.map(id => `'${this.escapeString(id)}'`).join(', ');
        conditions.push(`\`objectId\` IN (${escapedIds})`);
      } else {
        conditions.push(`\`objectId\` = '${this.escapeString(filter.objectId)}'`);
      }
    }

    if (filter.notebookId) {
      conditions.push(`\`notebookId\` = '${this.escapeString(filter.notebookId)}'`);
    }

    if (filter.tabGroupId) {
      conditions.push(`\`tabGroupId\` = '${this.escapeString(filter.tabGroupId)}'`);
    }

    // Handle mediaType filtering
    if (filter.mediaType) {
      if (Array.isArray(filter.mediaType)) {
        const escapedTypes = filter.mediaType.map(t => `'${this.escapeString(t)}'`).join(', ');
        conditions.push(`\`mediaType\` IN (${escapedTypes})`);
      } else {
        conditions.push(`\`mediaType\` = '${this.escapeString(filter.mediaType)}'`);
      }
    }

    // Handle date range filters (ISO string values)
    if (filter.createdAfter) {
      conditions.push(`\`createdAt\` > '${this.escapeString(filter.createdAfter)}'`);
    }

    if (filter.createdBefore) {
      conditions.push(`\`createdAt\` < '${this.escapeString(filter.createdBefore)}'`);
    }

    // Handle text search (if supported by LanceDB)
    if (filter.titleContains) {
      conditions.push(`\`title\` LIKE '%${this.escapeString(filter.titleContains)}%'`);
    }

    if (filter.contentContains) {
      conditions.push(`\`content\` LIKE '%${this.escapeString(filter.contentContains)}%'`);
    }

    // Handle custom where clause
    if (filter.customWhere) {
      conditions.push(`(${filter.customWhere})`);
    }

    // TODO: Add support for array contains (hasTag, hasTags) when LanceDB supports it

    return conditions.length > 0 ? conditions.join(' AND ') : null;
  }

  /**
   * Updates metadata for a vector record.
   * @param objectId - The object ID to update
   * @param metadata - The metadata to update (e.g., last_accessed_at)
   */
  async updateMetadata(objectId: string, metadata: Partial<BaseVectorRecord>): Promise<void> {
    if (!this.isInitialized || !this.table) {
      throw new Error('LanceVectorModel not initialized');
    }

    try {
      logger.debug(`[LanceVectorModel] Updating metadata for object ${objectId}`, metadata);
      
      // Filter for records with the given objectId (using filter instead of search)
      // Use backticks around field name to preserve case sensitivity
      const results = await this.table.filter(`\`objectId\` = '${this.escapeString(objectId)}'`)
        .limit(1000) // Get all vectors for this object
        .execute();
      
      if (results.length === 0) {
        logger.warn(`[LanceVectorModel] No vectors found for object ${objectId}`);
        return;
      }
      
      // Update each vector record with new metadata
      const updatedRecords = results.map((result: any) => {
        const record = this.createVectorRecordFromResult(result as any);
        return { ...record, ...metadata };
      });
      
      // Delete old records and insert updated ones
      // Note: LanceDB doesn't have direct update, so we delete and re-insert
      await this.table.delete(`\`objectId\` = '${this.escapeString(objectId)}'`);
      await this.addDocuments(updatedRecords as VectorRecord[]);
      
      logger.info(`[LanceVectorModel] Updated metadata for ${updatedRecords.length} vectors with objectId ${objectId}`);
    } catch (error) {
      logger.error(`[LanceVectorModel] Failed to update metadata for object ${objectId}:`, error);
      throw error;
    }
  }

  // ChromaDB migration has been removed since ChromaDB is no longer a dependency.
  // Users should re-embed their content using the reembed script.
}