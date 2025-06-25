import { connect, Table, Connection } from 'vectordb';
import * as lancedb from 'vectordb';
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

export interface LanceVectorModelDeps {
  userDataPath: string;
}

const TABLE_NAME = 'jeffers_embeddings';
const VECTOR_DIMENSION = 1536;

export class LanceVectorModel implements IVectorStoreModel {
  private db: Connection | null = null;
  private table: Table | null = null;
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
      this.db = await connect(lanceDbPath);
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
        const now = Date.now();
        
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
          createdAt: now,
          
          // Foreign keys (all optional, so can be undefined)
          objectId: undefined,
          sqlChunkId: undefined,
          chunkIdx: undefined,
          notebookId: undefined,
          tabGroupId: undefined,
          
          // Semantic metadata (all optional)
          title: undefined,
          summary: undefined,
          sourceUri: undefined,
          
          // Array fields (empty arrays for schema)
          tags: [],
          propositions: []
        };
        
        this.table = await this.db.createTable(TABLE_NAME, [dummyRecord] as unknown as Record<string, unknown>[]);
        
        // Immediately delete the dummy row
        await this.table!.delete(`id = '${dummyId}'`);
        
        logger.info('[LanceVectorModel] Created new table with full schema and removed dummy row.');
      }

      // Initialize OpenAI embeddings
      this.embeddings = createEmbeddingModel('text-embedding-3-small');
      logger.info('[LanceVectorModel] OpenAI embedding model initialized.');

      // Check if we need to create an index (for large datasets)
      try {
        // LanceDB doesn't have countRows, need to use a different approach
        const countResult = await this.table!.search([]).limit(1).execute();
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
          createdAt: meta.createdAt || Date.now(),
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
          : undefined;
        
        // Ensure all required fields are present with defaults
        const record: BaseVectorRecord = {
          // Copy all fields from the document
          ...doc,
          
          // Ensure vector is properly typed
          vector: vectorFloat32,
          
          // Ensure required fields have defaults if not provided
          layer: doc.layer || 'lom',
          processingDepth: doc.processingDepth || 'chunk',
          createdAt: doc.createdAt || Date.now(),
          
          // Ensure array fields are arrays (not undefined)
          tags: doc.tags || [],
          propositions: doc.propositions || []
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
    return {
      id: data.id as string,
      recordType: data.recordType as VectorRecord['recordType'],
      mediaType: data.mediaType as string,
      layer: data.layer as VectorRecord['layer'],
      processingDepth: data.processingDepth as VectorRecord['processingDepth'],
      vector: data.vector as Float32Array | undefined,
      content: data.content as string | undefined,
      createdAt: data.createdAt as number,
      objectId: data.objectId as string | undefined,
      sqlChunkId: data.sqlChunkId as number | undefined,
      chunkIdx: data.chunkIdx as number | undefined,
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
      
      const searchResults: VectorSearchResult[] = results.map(result => {
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

  async getRowCount(): Promise<number> {
    if (!this.isInitialized || !this.table) {
      return 0;
    }
    try {
      return await this.table.countRows();
    } catch (error) {
      logger.error('[LanceVectorModel] Error counting rows:', error);
      return 0;
    }
  }

  // Helper method for LangChain compatibility
  async similaritySearch(query: string, k: number = 10, filter?: VectorSearchFilter): Promise<Document[]> {
    const results = await this.querySimilarByText(query, { k, filter });
    return results.map(r => new Document({ pageContent: r.record.content || '', metadata: r.record }));
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
        conditions.push(`layer IN (${filter.layer.map(l => `'${l}'`).join(', ')})`);
      } else {
        conditions.push(`layer = '${filter.layer}'`);
      }
    }

    // Handle processingDepth filtering
    if (filter.processingDepth) {
      if (Array.isArray(filter.processingDepth)) {
        conditions.push(`processingDepth IN (${filter.processingDepth.map(d => `'${d}'`).join(', ')})`);
      } else {
        conditions.push(`processingDepth = '${filter.processingDepth}'`);
      }
    }

    // Handle ID filtering
    if (filter.objectId) {
      if (Array.isArray(filter.objectId)) {
        conditions.push(`objectId IN (${filter.objectId.map(id => `'${id}'`).join(', ')})`);
      } else {
        conditions.push(`objectId = '${filter.objectId}'`);
      }
    }

    if (filter.notebookId) {
      conditions.push(`notebookId = '${filter.notebookId}'`);
    }

    if (filter.tabGroupId) {
      conditions.push(`tabGroupId = '${filter.tabGroupId}'`);
    }

    // Handle mediaType filtering
    if (filter.mediaType) {
      if (Array.isArray(filter.mediaType)) {
        conditions.push(`mediaType IN (${filter.mediaType.map(t => `'${t}'`).join(', ')})`);
      } else {
        conditions.push(`mediaType = '${filter.mediaType}'`);
      }
    }

    // Handle date range filters
    if (filter.createdAfter) {
      conditions.push(`createdAt > ${filter.createdAfter}`);
    }

    if (filter.createdBefore) {
      conditions.push(`createdAt < ${filter.createdBefore}`);
    }

    // Handle text search (if supported by LanceDB)
    if (filter.titleContains) {
      conditions.push(`title LIKE '%${filter.titleContains}%'`);
    }

    if (filter.contentContains) {
      conditions.push(`content LIKE '%${filter.contentContains}%'`);
    }

    // Handle custom where clause
    if (filter.customWhere) {
      conditions.push(`(${filter.customWhere})`);
    }

    // TODO: Add support for array contains (hasTag, hasTags) when LanceDB supports it

    return conditions.length > 0 ? conditions.join(' AND ') : null;
  }

  // ChromaDB migration has been removed since ChromaDB is no longer a dependency.
  // Users should re-embed their content using the reembed script.
}