import { connect, Table } from 'vectordb';
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

export interface IVectorStoreModel {
  initialize(): Promise<void>;
  isReady(): boolean;
  addDocuments(documents: Document[], documentIds?: string[]): Promise<string[]>;
  querySimilarByText(queryText: string, k?: number, filter?: any): Promise<[Document, number][]>;
  querySimilarByVector(queryVector: number[], k?: number, filter?: any): Promise<[Document, number][]>;
  deleteDocumentsByIds(ids: string[]): Promise<void>;
  getRetriever(k?: number, filter?: any): Promise<any>;
}

export interface LanceVectorModelDeps {
  userDataPath: string;
}

const TABLE_NAME = 'jeffers_embeddings';
const VECTOR_DIMENSION = 1536;

export class LanceVectorModel implements IVectorStoreModel {
  private db: any; // LanceDB connection
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
        
        // Create table with a dummy row to establish schema
        const dummyId = uuidv4();
        // Create a Float32Array for the vector - this is what LanceDB expects!
        const dummyVector = new Float32Array(VECTOR_DIMENSION);
        // Float32Array is already initialized with zeros
        
        this.table = await this.db.createTable(TABLE_NAME, [
          { 
            id: dummyId, 
            vector: dummyVector, 
            content: 'dummy'  // Non-empty string
          }
        ]);
        
        // Immediately delete the dummy row
        await this.table!.delete(`id = '${dummyId}'`);
        
        logger.info('[LanceVectorModel] Created new table and removed dummy row.');
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

  async addDocuments(documents: Document[], documentIds?: string[]): Promise<string[]> {
    if (!this.isInitialized || !this.table || !this.embeddings) {
      throw new Error('LanceVectorModel not initialized');
    }

    if (documents.length === 0) {
      logger.debug('[LanceVectorModel] No documents to add.');
      return [];
    }

    try {
      logger.debug(`[LanceVectorModel] Adding ${documents.length} documents...`);

      // Generate embeddings for all documents
      const texts = documents.map(doc => doc.pageContent);
      const embeddings = await this.embeddings.embedDocuments(texts);
      
      // Prepare records for insertion
      const records = documents.map((doc, i) => {
        const vectorId = documentIds?.[i] || uuidv4();
        // Convert embedding to Float32Array - critical for LanceDB compatibility!
        const vectorFloat32 = new Float32Array(embeddings[i]);
        
        return {
          id: vectorId,
          vector: vectorFloat32,
          content: doc.pageContent
          // TODO: Add metadata support once we figure out the schema
        };
      });

      // Insert into LanceDB
      await this.table!.add(records);
      
      const vectorIds = records.map(r => r.id);
      logger.info(`[LanceVectorModel] Added ${documents.length} documents to LanceDB.`);
      
      return vectorIds;
    } catch (error) {
      logger.error('[LanceVectorModel] Error adding documents:', error);
      throw error;
    }
  }

  async querySimilarByText(queryText: string, k: number = 10, filter?: any): Promise<[Document, number][]> {
    if (!this.isInitialized || !this.table || !this.embeddings) {
      throw new Error('LanceVectorModel not initialized');
    }

    try {
      logger.debug(`[LanceVectorModel] Querying similar documents by text, k=${k}`);
      
      // Embed the query text
      const queryVector = await this.embeddings.embedQuery(queryText);
      
      // Use the vector query method
      return this.querySimilarByVector(queryVector, k, filter);
    } catch (error) {
      logger.error('[LanceVectorModel] Error querying by text:', error);
      throw error;
    }
  }

  async querySimilarByVector(queryVector: number[], k: number = 10, filter?: any): Promise<[Document, number][]> {
    if (!this.isInitialized || !this.table) {
      throw new Error('LanceVectorModel not initialized');
    }

    try {
      logger.debug(`[LanceVectorModel] Querying similar documents by vector, k=${k}`);
      
      // Build search query
      let search = this.table!.search(queryVector).limit(k);
      
      // Apply filter if provided
      if (filter) {
        const whereClause = this.buildWhereClause(filter);
        if (whereClause) {
          search = search.where(whereClause);
          logger.debug('[LanceVectorModel] Applied filter:', whereClause);
        }
      }
      
      // Execute search
      const results = await search.execute();
      
      // Convert results to [Document, similarity] tuples
      const documents: [Document, number][] = results.map(result => {
        // LanceDB returns distance; convert to similarity score
        // For cosine distance: similarity = 1 - distance
        // The _distance field contains the distance value
        const distance = (result as any)._distance || (result as any).distance || 0;
        const similarity = 1 - distance;
        
        const doc = new Document({
          pageContent: (result as any).content || '',
          metadata: {}  // TODO: Add metadata support once we figure out the schema
        });
        
        return [doc, similarity];
      });
      
      // Sort by similarity descending (should already be sorted by LanceDB)
      documents.sort((a, b) => b[1] - a[1]);
      
      logger.debug(`[LanceVectorModel] Found ${documents.length} similar documents.`);
      return documents;
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

  async getRetriever(k: number = 10, filter?: any): Promise<VectorStoreRetriever<any>> {
    if (!this.isInitialized) {
      throw new Error('LanceVectorModel not initialized');
    }

    // Create a retriever using LangChain's VectorStoreRetriever
    // We need to expose a similaritySearch method for compatibility
    const vectorStore = {
      similaritySearch: async (query: string, k: number, filter?: any): Promise<Document[]> => {
        const results = await this.querySimilarByText(query, k, filter);
        return results.map(([doc, _score]) => doc);
      }
    };

    return new VectorStoreRetriever({
      vectorStore: vectorStore as any,
      k,
      filter
    });
  }

  // Helper method for LangChain compatibility
  async similaritySearch(query: string, k: number = 10, filter?: any): Promise<Document[]> {
    const results = await this.querySimilarByText(query, k, filter);
    return results.map(([doc, _score]) => doc);
  }

  // Helper to build where clause from filter object
  private buildWhereClause(filter: any): string | null {
    if (!filter || typeof filter !== 'object') {
      return null;
    }

    // Handle simple equality filters
    // Example: { objectId: "123" } -> "metadata.objectId = '123'"
    const conditions: string[] = [];
    
    for (const [key, value] of Object.entries(filter)) {
      if (typeof value === 'string' || typeof value === 'number') {
        conditions.push(`metadata.${key} = '${value}'`);
      }
      // TODO: Add support for complex operators ($and, $or, $in, etc.) as needed
    }

    return conditions.length > 0 ? conditions.join(' AND ') : null;
  }

  // Migration method (to be called from modelBootstrap)
  async migrateFromChroma(sqliteDB: Database.Database): Promise<void> {
    logger.info('[LanceVectorModel] Starting migration from ChromaDB...');
    
    // Check if ChromaDB URL is configured
    const chromaUrl = process.env.CHROMA_URL;
    if (!chromaUrl) {
      logger.warn('[LanceVectorModel] No CHROMA_URL configured, skipping migration.');
      return;
    }

    try {
      // Import ChromaDB client (still available during migration)
      const { ChromaClient } = await import('chromadb');
      const client = new ChromaClient({ path: chromaUrl });
      
      // Try to get the collection
      let collection;
      try {
        collection = await client.getCollection({ name: 'jeffers_embeddings' });
      } catch (err) {
        logger.warn('[LanceVectorModel] Chroma collection not found, skipping migration.');
        return;
      }

      // Get all embedding records from SQLite
      const embeddingRecords = sqliteDB.prepare('SELECT chunk_id, vector_id FROM embeddings').all() as Array<{
        chunk_id: number;
        vector_id: string;
      }>;
      
      if (embeddingRecords.length === 0) {
        logger.info('[LanceVectorModel] No embeddings to migrate.');
        return;
      }

      logger.info(`[LanceVectorModel] Found ${embeddingRecords.length} embeddings to migrate.`);
      
      // Process in batches
      const BATCH_SIZE = 100;
      let migratedCount = 0;
      
      for (let i = 0; i < embeddingRecords.length; i += BATCH_SIZE) {
        const batch = embeddingRecords.slice(i, i + BATCH_SIZE);
        const vectorIds = batch.map(r => r.vector_id);
        
        try {
          // Fetch from Chroma
          const chromaData = await collection.get({
            ids: vectorIds,
            include: ['documents' as any, 'metadatas' as any, 'embeddings' as any]
          });
          
          if (!chromaData.ids || chromaData.ids.length === 0) {
            logger.warn(`[LanceVectorModel] No data returned for batch starting at index ${i}`);
            continue;
          }
          
          // Prepare records for LanceDB
          const records = [];
          for (let j = 0; j < chromaData.ids.length; j++) {
            const oldId = chromaData.ids[j];
            const embedding = chromaData.embeddings?.[j];
            const content = chromaData.documents?.[j] || '';
            const metadata = chromaData.metadatas?.[j] || {};
            
            if (!embedding) {
              logger.warn(`[LanceVectorModel] No embedding found for ID ${oldId}, skipping.`);
              continue;
            }
            
            // Find the corresponding chunk ID
            const embeddingRecord = batch.find(r => r.vector_id === oldId);
            if (!embeddingRecord) {
              logger.warn(`[LanceVectorModel] No chunk ID found for vector ID ${oldId}, skipping.`);
              continue;
            }
            
            // Use chunk ID as the new vector ID
            const newId = String(embeddingRecord.chunk_id);
            
            records.push({
              id: newId,
              vector: embedding,
              content: content,
              metadata: metadata
            } as any);
          }
          
          if (records.length > 0) {
            // Insert into LanceDB
            await this.table!.add(records);
            migratedCount += records.length;
            logger.debug(`[LanceVectorModel] Migrated batch: ${records.length} vectors.`);
          }
        } catch (error) {
          logger.error(`[LanceVectorModel] Error migrating batch at index ${i}:`, error);
          // Continue with next batch
        }
      }
      
      logger.info(`[LanceVectorModel] Migration complete. Migrated ${migratedCount} vectors.`);
      
      // Update SQLite records to use chunk IDs as vector IDs
      if (migratedCount > 0) {
        try {
          const updateStmt = sqliteDB.prepare('UPDATE embeddings SET vector_id = CAST(chunk_id AS TEXT)');
          const result = updateStmt.run();
          logger.info(`[LanceVectorModel] Updated ${result.changes} embedding records with new vector IDs.`);
        } catch (error) {
          logger.error('[LanceVectorModel] Error updating embedding vector IDs:', error);
          // Non-critical error, continue
        }
      }
    } catch (error) {
      logger.error('[LanceVectorModel] Migration failed:', error);
      // Don't throw - allow app to continue without migration
    }
  }
}