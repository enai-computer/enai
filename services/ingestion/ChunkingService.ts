import { IngestionAiService, ChunkLLMResult } from "./IngestionAIService";
import { v4 as uuidv4 } from 'uuid';
import { ObjectModelCore } from "../../models/ObjectModelCore";
import { ChunkModel } from "../../models/ChunkModel";
import { EmbeddingModel } from '../../models/EmbeddingModel';
import { IngestionJobModel } from '../../models/IngestionJobModel';
import { Document } from "@langchain/core/documents";
import type { JeffersObject, ObjectStatus, JobStatus, MediaType } from "../../shared/types";
import type { IVectorStoreModel, VectorRecord, LOMChunkVector } from "../../shared/types/vector.types";
import type Database from 'better-sqlite3';
import { BaseService } from '../base/BaseService';
import { BaseServiceDependencies } from '../interfaces';
import { TransactionHelper } from '../base/TransactionHelper';

const EMBEDDING_MODEL_NAME_FOR_RECORD = "text-embedding-3-small";

interface ChunkingServiceDeps extends BaseServiceDependencies {
  ingestionAiService: IngestionAiService;
  objectModelCore: ObjectModelCore;
  chunkModel: ChunkModel;
  embeddingModel: EmbeddingModel;
  ingestionJobModel: IngestionJobModel;
  vectorStore: IVectorStoreModel;
}

/**
 * Processes objects by:
 *   1. grabs multiple objects whose status === 'parsed' (up to concurrency limit)
 *   2. atomically flips them to 'embedding' (race‑safe)
 *   3. asks OpenAI‑GPT‑4.1‑nano to produce semantic chunks
 *   4. bulk‑inserts the chunks into SQL
 *   5. adds chunk embeddings to Chroma via the injected IVectorStore
 *   6. marks objects 'embedded' or 'embedding_failed'
 *
 * Implements proper rate limiting for OpenAI API Tier 1 limits.
 */
export class ChunkingService extends BaseService<ChunkingServiceDeps> {
  private isProcessing: boolean = false; // Helps prevent overlapping processing
  private orphanedObjectAttempts: Map<string, number> = new Map(); // Track attempts for orphaned objects
  
  // Concurrency management
  private activeProcessing: Set<string> = new Set(); // Track active object IDs
  
  // Rate limiting for OpenAI (Tier 2: 5000 RPM for embeddings)
  private readonly maxRequestsPerMinute = 4900; // Conservative limit (98% of 5000)
  private requestTimes: number[] = []; // Track request timestamps for rate limiting

  /**
   * Creates a new ChunkingService instance.
   * @param deps Service dependencies
   * @param concurrency Maximum number of concurrent chunking operations (default: 60)
   */
  constructor(
    deps: ChunkingServiceDeps,
    private readonly concurrency = 60 // Increased for Tier 2 limits (5000 RPM GPT-4.1-nano, 5000 RPM embeddings)
  ) {
    super('ChunkingService', deps);
  }

  /**
   * Process available objects for chunking.
   * This method is called by SchedulerService at regular intervals.
   * Implements rate limiting to respect OpenAI API limits.
   */
  async tick(): Promise<void> {
    return this.execute('tick', async () => {
      await this.processAvailableObjects();
    });
  }

  // --- private helpers -----------------------------------------------------

  /**
   * Process multiple objects concurrently up to concurrency limit.
   * Implements rate limiting to respect OpenAI API limits.
   */
  private async processAvailableObjects(): Promise<void> {
    try {
      // Clean up old request timestamps (older than 1 minute)
      const oneMinuteAgo = Date.now() - 60000;
      this.requestTimes = this.requestTimes.filter(time => time > oneMinuteAgo);
      
      // Calculate how many new objects we can process
      const currentActive = this.activeProcessing.size;
      const slotsAvailable = this.concurrency - currentActive;
      
      if (slotsAvailable <= 0) {
        this.logDebug(`All ${this.concurrency} slots full (active: ${Array.from(this.activeProcessing).join(', ')})`);
        return;
      }
      
      // Check rate limit - assume 1.5 requests per object on average (most succeed on first try)
      const currentRPM = this.requestTimes.length;
      const maxNewObjects = Math.floor((this.maxRequestsPerMinute - currentRPM) / 1.5);
      
      if (maxNewObjects <= 0) {
        this.logDebug(`Rate limit reached (${currentRPM}/${this.maxRequestsPerMinute} RPM), waiting`);
        return;
      }
      
      // Determine how many objects to process this tick
      const objectsToProcess = Math.min(slotsAvailable, maxNewObjects);
      
      // Fetch objects with 'parsed' status
      const objects = await this.deps.objectModelCore.findByStatus(['parsed']);

      if (!objects || objects.length === 0) {
        this.logDebug("No objects with 'parsed' status found for chunking");
        return; 
      }

      // Process up to objectsToProcess objects
      const objectsToStart = objects.slice(0, objectsToProcess);
      
      this.logInfo(`Starting ${objectsToStart.length} new chunking operations (${currentActive} already active, ${this.requestTimes.length} RPM)`);
      
      // Start processing each object without awaiting
      for (const obj of objectsToStart) {
        // Don't await - let it run in background
        this.processObjectConcurrent(obj).catch(error => {
          this.logError(`Background processing failed for object ${obj.id}:`, error);
        });
      }
      
    } catch (err) {
      this.logError(`Error during tick:`, err);
    }
  }

  /**
   * Process a single object concurrently with proper state tracking and rate limiting.
   * @param obj The object to process
   */
  private async processObjectConcurrent(obj: JeffersObject): Promise<void> {
    const objectId = obj.id;
    let originatingJobId: string | null = null;
    
    try {
      // Add to active processing set
      this.activeProcessing.add(objectId);
      
      // Find the originating ingestion job
      const jobToUpdate = await this.deps.ingestionJobModel.findJobAwaitingChunking(objectId);
      
      if (!jobToUpdate) {
        // Track orphaned object attempts
        const attempts = (this.orphanedObjectAttempts.get(objectId) || 0) + 1;
        this.orphanedObjectAttempts.set(objectId, attempts);
        
        if (attempts >= 3) {
          // Mark as error after 3 attempts
          this.logWarn(`Object ${objectId} is orphaned (no job found) after ${attempts} attempts. Marking as error.`);
          await this.deps.objectModelCore.updateStatus(
            objectId, 
            'error', 
            undefined, 
            'Orphaned object: no corresponding ingestion job found after 3 attempts'
          );
          this.orphanedObjectAttempts.delete(objectId);
        } else {
          this.logWarn(`Object ${objectId} is 'parsed' but no corresponding job found. Attempt ${attempts}/3.`);
        }
        return;
      }
      
      originatingJobId = jobToUpdate.id;
      
      // Attempt atomic status transition to 'embedding' for the object
      await this.deps.objectModelCore.updateStatus(objectId, 'embedding');
      
      // Double-check we actually got the object (in case we lost a race)
      const claimedObj = await this.deps.objectModelCore.getById(objectId);
      
      if (!claimedObj || claimedObj.status !== 'embedding') {
        this.logWarn(`Failed to claim object ${objectId} for embedding (lost race)`);
        // Update job to reflect failure
        if (originatingJobId) {
          await this.deps.ingestionJobModel.update(originatingJobId, {
            chunking_status: 'failed',
            chunking_error_info: 'Failed to claim object for embedding - race condition',
            status: 'failed' as JobStatus
          });
        }
        return;
      }
      
      // Update the ingestion job to show chunking is in progress
      await this.deps.ingestionJobModel.update(originatingJobId, {
        chunking_status: 'in_progress'
      });
      
      this.logInfo(`Processing object ${objectId} for chunking & embedding (Job: ${originatingJobId})`);
      
      // Track API request for rate limiting
      this.requestTimes.push(Date.now());
      
      // Process object (includes chunking, SQL storage, and vector embedding)
      await this.processObject(claimedObj);
      
      // Update object status to 'embedded' on success
      await this.deps.objectModelCore.updateStatus(objectId, 'embedded');
      this.logInfo(`Object ${objectId} successfully chunked and embedded`);
      
      // Clear from orphaned tracking if it was there
      this.orphanedObjectAttempts.delete(objectId);
      
      // Update the ingestion job as completed
      await this.deps.ingestionJobModel.update(originatingJobId, {
        chunking_status: 'completed',
        status: 'completed' as JobStatus,
        completedAt: Date.now()
      });
      
    } catch (err) {
      const error = err as Error;
      this.logError(`Error processing object ${objectId}: ${error.message}`, error);
      
      // Update object status
      try {
        await this.deps.objectModelCore.updateStatus(
          objectId,
          'embedding_failed',
          undefined,
          error.message.slice(0, 1000)
        );
      } catch (statusUpdateError) {
        this.logError(`Failed to update object status for ${objectId}:`, statusUpdateError);
      }
      
      // Update job status if we have one
      if (originatingJobId) {
        try {
          await this.deps.ingestionJobModel.update(originatingJobId, {
            chunking_status: 'failed',
            chunking_error_info: error.message.slice(0, 1000),
            status: 'failed' as JobStatus,
            completedAt: Date.now()
          });
        } catch (jobUpdateError) {
          this.logError(`Failed to update job ${originatingJobId}:`, jobUpdateError);
        }
      }
      
    } finally {
      // Always remove from active processing set
      this.activeProcessing.delete(objectId);
    }
  }

  /**
   * Process a single object through the chunking and embedding pipeline.
   * Uses saga pattern for atomic multi-step operations.
   * @param obj The object to process (must have status 'embedding')
   * @throws Error if processing fails at any step, including objectId in the message.
   */
  private async processObject(obj: JeffersObject): Promise<void> {
    const objectId = obj.id;

    try {
      // Handle PDFs specially - they already have a single chunk
      if (obj.objectType === 'pdf') {
        await this.processPdfObject(obj);
        return;
      }

      // For non-PDF documents, proceed with normal chunking
      if (!obj.cleanedText) {
        throw new Error(`cleanedText is NULL`);
      }

      // 1. Call the agent to generate chunks
      this.logDebug(`Object ${objectId}: Calling IngestionAiService for chunking...`);
      const chunks = await this.deps.ingestionAiService.chunkText(obj.cleanedText, objectId);

      if (!chunks || chunks.length === 0) {
        throw new Error(`LLM returned empty chunks array`);
      }
      this.logDebug(`Object ${objectId}: LLM generated ${chunks.length} chunks`);

      // 2. Prepare chunks data
      const preparedSqlChunksData = chunks.map((chunk, idx) => ({
        objectId: objectId,
        chunkIdx: chunk.chunkIdx ?? idx,
        content: chunk.content,
        summary: chunk.summary || null,
        tagsJson: chunk.tags && chunk.tags.length > 0 ? JSON.stringify(chunk.tags) : null,
        propositionsJson: chunk.propositions && chunk.propositions.length > 0 ? JSON.stringify(chunk.propositions) : null,
      }));

      // 3. Process chunks with transaction helper
      const result = await this.processChunksWithTransaction(objectId, preparedSqlChunksData, obj);
      
      if (!result.success) {
        throw new Error(`Chunking failed: ${result.error?.message}`);
      }

      this.logInfo(`Object ${objectId}: Successfully completed chunking and embedding`);

    } catch (error) {
      // Re-throw error, ensuring objectId is included
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed processing objectId: ${objectId}. Reason: ${message}`);
    }
  }

  /**
   * Process chunks using simplified transaction approach
   */
  private async processChunksWithTransaction(
    objectId: string,
    chunksData: any[],
    obj: JeffersObject
  ) {
    interface SqlResult {
      chunkIds: number[];
      chunks: any[];
    }

    return TransactionHelper.executeWithExternal<SqlResult, string[], void>(
      this.deps.db,
      // Step 1: Insert chunks in SQL transaction
      () => {
        this.logDebug(`Object ${objectId}: Storing ${chunksData.length} chunks in SQL...`);
        const chunkIds = this.deps.chunkModel.addChunksBulkSync(chunksData);
        const chunks = this.deps.chunkModel.listByObjectId(objectId);
        
        if (chunks.length === 0) {
          throw new Error('No chunks found after insertion');
        }
        
        if (chunks.length !== chunksData.length) {
          this.logWarn(`Object ${objectId}: Mismatch between expected chunks (${chunksData.length}) and fetched SQL chunks (${chunks.length})`);
        }
        
        this.logInfo(`Object ${objectId}: Successfully stored ${chunksData.length} chunks in SQL database`);
        return { chunkIds, chunks };
      },
      // Step 2: Create embeddings in LanceDB
      async (sqlResult) => {
        this.logDebug(`Object ${objectId}: Preparing ${sqlResult.chunks.length} chunks for embedding...`);
        
        // Extract texts and metadata separately for addDocumentsWithText
        const texts: string[] = [];
        const metadata: Omit<LOMChunkVector, 'vector' | 'content'>[] = [];
        
        for (const dbChunk of sqlResult.chunks) {
          // Parse arrays from JSON strings
          let tags: string[] = [];
          let propositions: string[] = [];
          
          try {
            if (dbChunk.tagsJson) {
              tags = JSON.parse(dbChunk.tagsJson);
            }
          } catch (e) {
            this.logWarn(`Failed to parse tags for chunk ${dbChunk.id}`);
          }
          
          try {
            if (dbChunk.propositionsJson) {
              propositions = JSON.parse(dbChunk.propositionsJson);
            }
          } catch (e) {
            this.logWarn(`Failed to parse propositions for chunk ${dbChunk.id}`);
          }
          
          // Add text content
          texts.push(dbChunk.content);
          
          // Create metadata object (without vector and content)
          const meta: Omit<LOMChunkVector, 'vector' | 'content'> = {
            id: uuidv4(), // Generate UUID for the new vector record
            recordType: 'chunk',
            mediaType: obj.objectType,
            layer: 'lom',
            processingDepth: 'chunk',
            createdAt: Date.now(),
            objectId: dbChunk.objectId,
            sqlChunkId: dbChunk.id,
            chunkIdx: dbChunk.chunkIdx,
            notebookId: dbChunk.notebookId || undefined,
            summary: dbChunk.summary || undefined,
            sourceUri: obj.sourceUri || undefined,
            title: obj.title || undefined,
            tags,
            propositions
          };
          
          metadata.push(meta);
        }
        
        this.logDebug(`Object ${objectId}: Creating embeddings for ${texts.length} chunks...`);
        const vectorIds = await this.deps.vectorStore.addDocumentsWithText(texts, metadata);
        this.logInfo(`Object ${objectId}: Successfully created ${vectorIds.length} embeddings`);
        
        return vectorIds;
      },
      // Step 3: Link embeddings in SQL
      (sqlResult, vectorIds) => {
        if (vectorIds.length !== sqlResult.chunks.length) {
          throw new Error(`Vector ID count mismatch: ${vectorIds.length} vs ${sqlResult.chunks.length} chunks`);
        }

        this.logDebug(`Object ${objectId}: Creating ${vectorIds.length} embedding links in SQL...`);
        
        const embeddingLinks = sqlResult.chunks.map((chunk, i) => ({
          chunkId: chunk.id,
          vectorId: vectorIds[i],
          model: EMBEDDING_MODEL_NAME_FOR_RECORD
        }));

        this.deps.embeddingModel.addEmbeddingRecordsBulk(embeddingLinks);
        
        this.logInfo(`Object ${objectId}: Successfully created ${vectorIds.length} embedding links`);
      },
      {
        name: 'chunking-process',
        serviceName: 'ChunkingService',
        retryable: true,
        maxRetries: 3,
        circuitBreaker: {
          failureThreshold: 5,
          resetTimeout: 60000, // 1 minute
          halfOpenMaxAttempts: 2
        },
        maxConcurrent: 10, // Limit concurrent ChromaDB operations
        cleanup: async (data) => {
          // Best-effort cleanup
          if ('chunkIds' in data) {
            // SQL cleanup
            const sqlData = data as SqlResult;
            try {
              this.deps.chunkModel.deleteByIds(sqlData.chunkIds);
              this.deps.embeddingModel.deleteByChunkIds(sqlData.chunkIds);
            } catch (error) {
              this.logError('Failed to cleanup SQL data:', error);
            }
          } else if (Array.isArray(data)) {
            // ChromaDB cleanup
            try {
              await this.deps.vectorStore.deleteDocumentsByIds(data);
            } catch (error) {
              this.logError('Failed to cleanup vector store:', error);
            }
          }
        }
      }
    );
  }

  /**
   * Process a PDF object which already has a single chunk created by PdfIngestionService
   * Uses saga pattern for atomic operations
   * @param obj The PDF object to process (must have status 'embedding')
   * @throws Error if processing fails at any step
   */
  private async processPdfObject(obj: JeffersObject): Promise<void> {
    const objectId = obj.id;
    
    try {
      this.logDebug(`Processing PDF object ${objectId}: ${obj.title}`);
      
      // Process PDF with transaction helper
      const result = await this.processPdfWithTransaction(objectId, obj);
      
      if (!result.success) {
        throw new Error(`PDF embedding failed: ${result.error?.message}`);
      }

      this.logInfo(`PDF object ${objectId}: Successfully completed embedding`);
        
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed processing PDF objectId: ${objectId}. Reason: ${message}`);
    }
  }

  /**
   * Process PDF using simplified transaction approach
   */
  private async processPdfWithTransaction(
    objectId: string,
    obj: JeffersObject
  ) {
    // For PDFs, we just need to fetch the existing chunk and create its embedding
    const existingChunks = await this.deps.chunkModel.listByObjectId(objectId);
    
    if (!existingChunks || existingChunks.length === 0) {
      throw new Error(`No chunks found for PDF object ${objectId}`);
    }
    
    if (existingChunks.length > 1) {
      this.logWarn(`PDF object ${objectId} has ${existingChunks.length} chunks, expected 1. Processing only the first.`);
    }
    
    const pdfChunk = existingChunks[0];
    this.logDebug(`Found PDF chunk ID ${pdfChunk.id} for object ${objectId}`);

    // Since PDF chunks already exist, we only need to create embeddings
    return TransactionHelper.executeWithExternal<any, string, void>(
      this.deps.db,
      // Step 1: No SQL operations needed - chunk already exists
      () => pdfChunk,
      // Step 2: Create embedding in LanceDB
      async (chunk) => {
        const text = chunk.content;
        const metadata: Omit<LOMChunkVector, 'vector' | 'content'> = {
          id: uuidv4(), // Generate UUID for the new vector record
          recordType: 'chunk',
          mediaType: 'pdf',
          layer: 'lom',
          processingDepth: 'chunk',
          createdAt: Date.now(),
          objectId: chunk.objectId,
          sqlChunkId: chunk.id,
          chunkIdx: 0,
          title: obj.title ?? undefined,
          sourceUri: obj.sourceUri ?? undefined,
          tags: [],
          propositions: []
        };

        this.logDebug(`PDF object ${objectId}: Creating embedding...`);
        const vectorIds = await this.deps.vectorStore.addDocumentsWithText([text], [metadata]);
        
        if (!vectorIds || vectorIds.length === 0) {
          throw new Error(`Failed to create embedding for PDF object ${objectId}`);
        }
        
        const vectorId = vectorIds[0];
        this.logInfo(`PDF object ${objectId}: Successfully created embedding with vector ID ${vectorId}`);
        return vectorId;
      },
      // Step 3: Link embedding in SQL
      (chunk, vectorId) => {
        this.deps.embeddingModel.addEmbeddingRecord({
          chunkId: chunk.id,
          model: EMBEDDING_MODEL_NAME_FOR_RECORD,
          vectorId: vectorId
        });
        this.logDebug(`PDF object ${objectId}: Successfully linked embedding record`);
      },
      {
        name: 'pdf-embedding-process',
        serviceName: 'ChunkingService',
        retryable: true,
        maxRetries: 3,
        circuitBreaker: {
          failureThreshold: 5,
          resetTimeout: 60000, // 1 minute
          halfOpenMaxAttempts: 2
        },
        maxConcurrent: 10, // Limit concurrent ChromaDB operations
        cleanup: async (vectorId) => {
          if (typeof vectorId === 'string') {
            try {
              await this.deps.vectorStore.deleteDocumentsByIds([vectorId]);
            } catch (error) {
              this.logError('Failed to cleanup PDF embedding:', error);
            }
          }
        }
      }
    );
  }

  /**
   * Cleanup method for graceful shutdown.
   * Waits for all active processing to complete.
   */
  async cleanup(): Promise<void> {
    this.logInfo('Cleanup requested, waiting for active processing to complete...');
    
    // Wait for all active processing to complete (with timeout)
    const timeout = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (this.activeProcessing.size > 0) {
      if (Date.now() - startTime > timeout) {
        this.logWarn(`Cleanup timeout: ${this.activeProcessing.size} objects still processing`);
        break;
      }
      
      this.logDebug(`Waiting for ${this.activeProcessing.size} objects to complete processing...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    this.logInfo('ChunkingService cleanup completed');
  }

  /**
   * Health check for the service.
   * Verifies vector store connectivity and no stuck processing.
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check if vector store is accessible
      await this.deps.vectorStore.querySimilarByText('test', { k: 1 });
      
      // Check for stuck processing (objects in activeProcessing for too long)
      // This is a simple check - in production you might track timestamps
      if (this.activeProcessing.size > this.concurrency * 2) {
        this.logWarn(`Health check warning: ${this.activeProcessing.size} active processing (max expected: ${this.concurrency * 2})`);
        return false;
      }
      
      // Check for empty vector store when there should be embeddings
      const embeddedObjectsCount = await this.deps.objectModelCore.countObjectsByStatus(['embedded']);
      if (embeddedObjectsCount > 0) {
        // We have embedded objects, so check if we have any embeddings
        const embeddingsCount = this.deps.embeddingModel.getCount();
        if (embeddingsCount === 0) {
          this.logError(`Health check failed: Found ${embeddedObjectsCount} embedded objects but no embeddings in vector store. Re-embedding may be required.`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      this.logError('Health check failed:', error);
      return false;
    }
  }

  /**
   * Embed all chunks that don't have corresponding embeddings in the vector store.
   * This is useful for bulk re-embedding after a vector store migration.
   * @returns The number of chunks successfully embedded
   */
  public async embedAllUnembeddedChunks(): Promise<number> {
    return this.execute('embedAllUnembeddedChunks', async () => {
      this.logInfo('Starting bulk embedding of unembedded chunks...');
      
      // Query for chunks without embeddings, including object metadata
      const unembeddedChunksQuery = `
        SELECT c.id, c.content, c.object_id, c.chunk_idx, c.tags_json, c.propositions_json, c.summary,
               o.object_type, o.title, o.source_uri
        FROM chunks c
        LEFT JOIN embeddings e ON c.id = e.chunk_id
        LEFT JOIN objects o ON c.object_id = o.id
        WHERE e.id IS NULL
        ORDER BY c.created_at
      `;
      
      const unembeddedChunks = this.deps.db.prepare(unembeddedChunksQuery).all() as Array<{
        id: number;
        content: string;
        object_id: string;
        chunk_idx: number;
        tags_json: string | null;
        propositions_json: string | null;
        summary: string | null;
        object_type: string;
        title: string | null;
        source_uri: string | null;
      }>;
      
      if (unembeddedChunks.length === 0) {
        this.logInfo('No unembedded chunks found. Nothing to do.');
        return 0;
      }
      
      this.logInfo(`Found ${unembeddedChunks.length} chunks to embed.`);
      
      // Process in batches to avoid API rate limits and memory issues
      const BATCH_SIZE = 50; // Conservative batch size for embeddings
      let totalEmbedded = 0;
      let batchNumber = 0;
      
      for (let i = 0; i < unembeddedChunks.length; i += BATCH_SIZE) {
        batchNumber++;
        const batch = unembeddedChunks.slice(i, i + BATCH_SIZE);
        const batchStartIdx = i + 1;
        const batchEndIdx = Math.min(i + BATCH_SIZE, unembeddedChunks.length);
        
        this.logInfo(`Processing batch ${batchNumber} (chunks ${batchStartIdx}-${batchEndIdx} of ${unembeddedChunks.length})...`);
        
        try {
          // Prepare texts and metadata for the new method
          const texts: string[] = batch.map(chunk => chunk.content);
          const metadata: Omit<LOMChunkVector, 'vector' | 'content'>[] = batch.map(chunk => {
            let tags: string[] = [];
            let propositions: string[] = [];
            try {
              if (chunk.tags_json) tags = JSON.parse(chunk.tags_json);
              if (chunk.propositions_json) propositions = JSON.parse(chunk.propositions_json);
            } catch (e) {
              this.logWarn(`Failed to parse JSON for chunk ${chunk.id} during bulk re-embedding`);
            }
            return {
              id: uuidv4(), // Generate UUID for the new vector record
              recordType: 'chunk',
              mediaType: chunk.object_type as MediaType,
              layer: 'lom',
              processingDepth: 'chunk',
              createdAt: Date.now(), // Or use chunk.created_at if available
              objectId: chunk.object_id,
              sqlChunkId: chunk.id,
              chunkIdx: chunk.chunk_idx,
              title: chunk.title ?? undefined,
              sourceUri: chunk.source_uri ?? undefined,
              summary: chunk.summary ?? undefined,
              tags,
              propositions
            };
          });

          // Embed and store in vector store
          const returnedIds = await this.deps.vectorStore.addDocumentsWithText(texts, metadata);
          
          if (returnedIds.length !== batch.length) {
            throw new Error(`Vector store returned ${returnedIds.length} IDs but expected ${batch.length}`);
          }
          
          // Insert embedding records into SQLite in a single transaction
          const embeddingLinks = batch.map((chunk, j) => ({
            chunkId: chunk.id,
            vectorId: returnedIds[j],
            model: EMBEDDING_MODEL_NAME_FOR_RECORD
          }));
          this.deps.embeddingModel.addEmbeddingRecordsBulk(embeddingLinks);
          
          totalEmbedded += batch.length;
          this.logInfo(`Batch ${batchNumber} completed. Embedded ${batch.length} chunks.`);
          
          // Log progress every 500 chunks
          if (totalEmbedded % 500 === 0 || totalEmbedded === unembeddedChunks.length) {
            this.logInfo(`Progress: ${totalEmbedded}/${unembeddedChunks.length} chunks embedded (${Math.round(totalEmbedded / unembeddedChunks.length * 100)}%)`);
          }
          
          // Small delay to be nice to the API (optional - OpenAI embeddings have high rate limits)
          if (i + BATCH_SIZE < unembeddedChunks.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
        } catch (error) {
          this.logError(`Failed to embed batch ${batchNumber}:`, error);
          throw new Error(`Embedding failed at batch ${batchNumber} (chunks ${batchStartIdx}-${batchEndIdx}): ${error}`);
        }
      }
      
      this.logInfo(`Bulk embedding complete. Successfully embedded ${totalEmbedded} chunks.`);
      return totalEmbedded;
    });
  }
}

