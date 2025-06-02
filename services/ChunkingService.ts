import { OpenAiAgent, ChunkLLMResult } from "./agents/OpenAiAgent";
import { ObjectModel } from "../models/ObjectModel";
import { ChunkSqlModel } from "../models/ChunkModel";
import { EmbeddingSqlModel } from '../models/EmbeddingModel';
import { IngestionJobModel } from '../models/IngestionJobModel';
import { Document } from "@langchain/core/documents";
import { logger } from "../utils/logger";
import { LLMService } from './LLMService';
import type { JeffersObject, ObjectStatus, IVectorStore, JobStatus } from "../shared/types";
import type Database from 'better-sqlite3';

const EMBEDDING_MODEL_NAME_FOR_RECORD = "text-embedding-3-small";

/**
 * Runs a concurrent polling loop with rate limiting. Every `intervalMs` it:
 *   1. grabs multiple objects whose status === 'parsed' (up to concurrency limit)
 *   2. atomically flips them to 'embedding' (race‑safe)
 *   3. asks OpenAI‑GPT‑4.1‑nano to produce semantic chunks
 *   4. bulk‑inserts the chunks into SQL
 *   5. adds chunk embeddings to Chroma via the injected IVectorStore
 *   6. marks objects 'embedded' or 'embedding_failed'
 *
 * Implements proper rate limiting for OpenAI API Tier 1 limits.
 */
export class ChunkingService {
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly agent: OpenAiAgent;
  private readonly objectModel: ObjectModel;
  private readonly chunkSqlModel: ChunkSqlModel;
  private readonly embeddingSqlModel: EmbeddingSqlModel;
  private readonly ingestionJobModel: IngestionJobModel;
  private readonly vectorStore: IVectorStore;
  private isProcessing: boolean = false; // Helps prevent overlapping processing
  private orphanedObjectAttempts: Map<string, number> = new Map(); // Track attempts for orphaned objects
  
  // Concurrency management
  private readonly concurrency: number;
  private activeProcessing: Set<string> = new Set(); // Track active object IDs
  
  // Rate limiting for OpenAI (Tier 1: 500 RPM)
  private readonly maxRequestsPerMinute = 450; // Conservative limit (90% of 500)
  private requestTimes: number[] = []; // Track request timestamps for rate limiting

  /**
   * Creates a new ChunkingService instance.
   * @param db Database instance to use for all data access
   * @param vectorStore Instance conforming to IVectorStore for embedding storage.
   * @param intervalMs Polling interval in milliseconds (default: 30s)
   * @param agent OpenAI agent instance for semantic chunking
   * @param objectModel Object data model instance (or new one created if not provided)
   * @param chunkSqlModel Chunk data model instance (or new one created if not provided)
   * @param embeddingSqlModel Embedding data model instance (or new one created if not provided)
   * @param ingestionJobModel IngestionJobModel instance (newly added)
   * @param llmService LLM service for AI operations
   * @param concurrency Maximum number of concurrent chunking operations (default: 5)
   */
  constructor(
    db: Database.Database,
    vectorStore: IVectorStore,
    intervalMs = 30_000, // 30s default
    agent?: OpenAiAgent,
    objectModel?: ObjectModel,
    chunkSqlModel?: ChunkSqlModel,
    embeddingSqlModel?: EmbeddingSqlModel,
    ingestionJobModel?: IngestionJobModel,
    llmService?: LLMService,
    concurrency = 5 // Good balance for Tier 1 rate limits
  ) {
    this.intervalMs = intervalMs;
    this.concurrency = concurrency;
    
    // If agent is not provided but llmService is, create OpenAiAgent with llmService
    if (!agent && llmService) {
      this.agent = new OpenAiAgent(llmService);
    } else if (agent) {
      this.agent = agent;
    } else {
      throw new Error('Either agent or llmService must be provided to ChunkingService');
    }
    
    this.vectorStore = vectorStore;
    
    // Create model instances if not provided (using the same db instance)
    this.objectModel = objectModel ?? new ObjectModel(db);
    this.chunkSqlModel = chunkSqlModel ?? new ChunkSqlModel(db);
    this.embeddingSqlModel = embeddingSqlModel ?? new EmbeddingSqlModel(db);
    this.ingestionJobModel = ingestionJobModel ?? new IngestionJobModel(db);
  }

  /** 
   * Start the polling loop. A second call is a no‑op.
   * @returns this (for method chaining)
   */
  start(): ChunkingService {
    if (this.timer) {
      logger.debug("[ChunkingService] start() called but service is already running");
      return this; // Already running
    }
    
    // Run immediately on start
    this.tick().catch(e => logger.error("[ChunkingService] Error during first tick:", e));
    
    this.timer = setInterval(
      () => this.tick().catch(err => logger.error("[ChunkingService] Error during tick:", err)),
      this.intervalMs
    );
    
    logger.info(`[ChunkingService] Started with interval ${this.intervalMs}ms`);
    return this;
  }

  /** 
   * Stop the polling loop; pending LLM calls are not interrupted.
   * @returns this (for method chaining)
   */
  stop(): ChunkingService {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info("[ChunkingService] Stopped polling");
    } else {
      logger.debug("[ChunkingService] stop() called but service was not running");
    }
    return this;
  }

  /**
   * Is the service currently running its polling loop?
   */
  isRunning(): boolean {
    return this.timer !== null;
  }

  // --- private helpers -----------------------------------------------------

  /**
   * Process multiple objects concurrently up to concurrency limit.
   * Implements rate limiting to respect OpenAI API limits.
   */
  private async tick(): Promise<void> {
    try {
      // Clean up old request timestamps (older than 1 minute)
      const oneMinuteAgo = Date.now() - 60000;
      this.requestTimes = this.requestTimes.filter(time => time > oneMinuteAgo);
      
      // Calculate how many new objects we can process
      const currentActive = this.activeProcessing.size;
      const slotsAvailable = this.concurrency - currentActive;
      
      if (slotsAvailable <= 0) {
        logger.debug(`[ChunkingService] All ${this.concurrency} slots full (active: ${Array.from(this.activeProcessing).join(', ')})`);
        return;
      }
      
      // Check rate limit - be conservative, assume 2 requests per object (chunking + possible retry)
      const currentRPM = this.requestTimes.length;
      const maxNewObjects = Math.floor((this.maxRequestsPerMinute - currentRPM) / 2);
      
      if (maxNewObjects <= 0) {
        logger.debug(`[ChunkingService] Rate limit reached (${currentRPM}/${this.maxRequestsPerMinute} RPM), waiting`);
        return;
      }
      
      // Determine how many objects to process this tick
      const objectsToProcess = Math.min(slotsAvailable, maxNewObjects);
      
      // Fetch objects with 'parsed' status
      const objects = await this.objectModel.findByStatus(['parsed']);

      if (!objects || objects.length === 0) {
        logger.debug("[ChunkingService] No objects with 'parsed' status found for chunking");
        return; 
      }

      // Process up to objectsToProcess objects
      const objectsToStart = objects.slice(0, objectsToProcess);
      
      logger.info(`[ChunkingService] Starting ${objectsToStart.length} new chunking operations (${currentActive} already active, ${this.requestTimes.length} RPM)`);
      
      // Start processing each object without awaiting
      for (const obj of objectsToStart) {
        // Don't await - let it run in background
        this.processObjectConcurrent(obj).catch(error => {
          logger.error(`[ChunkingService] Background processing failed for object ${obj.id}:`, error);
        });
      }
      
    } catch (err) {
      logger.error(`[ChunkingService] Error during tick:`, err);
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
      const jobToUpdate = await this.ingestionJobModel.findJobAwaitingChunking(objectId);
      
      if (!jobToUpdate) {
        // Track orphaned object attempts
        const attempts = (this.orphanedObjectAttempts.get(objectId) || 0) + 1;
        this.orphanedObjectAttempts.set(objectId, attempts);
        
        if (attempts >= 3) {
          // Mark as error after 3 attempts
          logger.warn(`[ChunkingService] Object ${objectId} is orphaned (no job found) after ${attempts} attempts. Marking as error.`);
          await this.objectModel.updateStatus(
            objectId, 
            'error', 
            undefined, 
            'Orphaned object: no corresponding ingestion job found after 3 attempts'
          );
          this.orphanedObjectAttempts.delete(objectId);
        } else {
          logger.warn(`[ChunkingService] Object ${objectId} is 'parsed' but no corresponding job found. Attempt ${attempts}/3.`);
        }
        return;
      }
      
      originatingJobId = jobToUpdate.id;
      
      // Attempt atomic status transition to 'embedding' for the object
      await this.objectModel.updateStatus(objectId, 'embedding');
      
      // Double-check we actually got the object (in case we lost a race)
      const claimedObj = await this.objectModel.getById(objectId);
      
      if (!claimedObj || claimedObj.status !== 'embedding') {
        logger.warn(`[ChunkingService] Failed to claim object ${objectId} for embedding (lost race)`);
        // Update job to reflect failure
        if (originatingJobId) {
          await this.ingestionJobModel.update(originatingJobId, {
            chunking_status: 'failed',
            chunking_error_info: 'Failed to claim object for embedding - race condition',
            status: 'failed' as JobStatus
          });
        }
        return;
      }
      
      // Update the ingestion job to show chunking is in progress
      await this.ingestionJobModel.update(originatingJobId, {
        chunking_status: 'in_progress'
      });
      
      logger.info(`[ChunkingService] Processing object ${objectId} for chunking & embedding (Job: ${originatingJobId})`);
      
      // Track API request for rate limiting
      this.requestTimes.push(Date.now());
      
      // Process object (includes chunking, SQL storage, and vector embedding)
      await this.processObject(claimedObj);
      
      // Update object status to 'embedded' on success
      await this.objectModel.updateStatus(objectId, 'embedded');
      logger.info(`[ChunkingService] Object ${objectId} successfully chunked and embedded`);
      
      // Clear from orphaned tracking if it was there
      this.orphanedObjectAttempts.delete(objectId);
      
      // Update the ingestion job as completed
      await this.ingestionJobModel.update(originatingJobId, {
        chunking_status: 'completed',
        status: 'completed' as JobStatus,
        completedAt: Date.now()
      });
      
    } catch (err) {
      const error = err as Error;
      logger.error(`[ChunkingService] Error processing object ${objectId}: ${error.message}`, error);
      
      // Update object status
      try {
        await this.objectModel.updateStatus(
          objectId,
          'embedding_failed',
          undefined,
          error.message.slice(0, 1000)
        );
      } catch (statusUpdateError) {
        logger.error(`[ChunkingService] Failed to update object status for ${objectId}:`, statusUpdateError);
      }
      
      // Update job status if we have one
      if (originatingJobId) {
        try {
          await this.ingestionJobModel.update(originatingJobId, {
            chunking_status: 'failed',
            chunking_error_info: error.message.slice(0, 1000),
            status: 'failed' as JobStatus,
            completedAt: Date.now()
          });
        } catch (jobUpdateError) {
          logger.error(`[ChunkingService] Failed to update job ${originatingJobId}:`, jobUpdateError);
        }
      }
      
    } finally {
      // Always remove from active processing set
      this.activeProcessing.delete(objectId);
    }
  }

  /**
   * Process a single object through the chunking and embedding pipeline.
   * @param obj The object to process (must have status 'embedding')
   * @throws Error if processing fails at any step, including objectId in the message.
   */
  private async processObject(obj: JeffersObject): Promise<void> {
    const objectId = obj.id; // Capture for error messages

    try {
        // Handle PDFs specially - they already have a single chunk
        if (obj.objectType === 'pdf_document') {
            await this.processPdfObject(obj);
            return;
        }

        // For non-PDF documents, proceed with normal chunking
        if (!obj.cleanedText) {
            throw new Error(`cleanedText is NULL`);
        }

        // 1. Call the agent to generate chunks
        logger.debug(`[ChunkingService] Object ${objectId}: Calling OpenAiAgent for chunking...`);
        const chunks = await this.agent.chunkText(obj.cleanedText, objectId);

        if (!chunks || chunks.length === 0) {
            throw new Error(`LLM returned empty chunks array`);
        }
        logger.debug(`[ChunkingService] Object ${objectId}: LLM generated ${chunks.length} chunks`);

        // 2. Prepare chunks *without* ID first
        // @claude where are we actually preparing SqlChunksData? Where are we sending the prompt to the AI to generate chunk.content, chunk.summary, and so on?
        
        const preparedSqlChunksData = chunks.map((chunk, idx) => ({
            objectId: objectId,
            chunkIdx: chunk.chunkIdx ?? idx, // Use LLM index if provided, else fallback
            content: chunk.content,
            summary: chunk.summary || null,
            tagsJson: chunk.tags && chunk.tags.length > 0 ? JSON.stringify(chunk.tags) : null,
            propositionsJson: chunk.propositions && chunk.propositions.length > 0 ? JSON.stringify(chunk.propositions) : null,
        }));

        // 3. Bulk insert the chunks into SQL AND retrieve them with IDs
        // Assuming addChunksBulk can be modified or a new method exists to return IDs
        // For simplicity, let's assume we re-fetch after bulk insert (less efficient but works)
        logger.debug(`[ChunkingService] Object ${objectId}: Storing ${preparedSqlChunksData.length} chunks in SQL...`);
        await this.chunkSqlModel.addChunksBulk(preparedSqlChunksData);
        logger.info(`[ChunkingService] Object ${objectId}: Successfully stored ${preparedSqlChunksData.length} chunks in SQL database`);

        // 3b. Fetch the newly created chunks WITH their IDs
        const storedChunks = await this.chunkSqlModel.listByObjectId(objectId);
        if (storedChunks.length !== chunks.length) {
            // This indicates a potential issue with the bulk insert or fetch logic
            logger.warn(`[ChunkingService] Object ${objectId}: Mismatch between expected chunks (${chunks.length}) and fetched SQL chunks (${storedChunks.length}) after insert.`);
            // Decide how to handle this - throw, log and continue, etc.
            // For now, proceed, but this might cause issues linking embeddings.
             if (storedChunks.length === 0) {
                 throw new Error(`Failed to retrieve any chunks from SQL after bulk insert for object ${objectId}`);
             }
        }
        // Create a map for quick lookup by chunk index if needed, assuming order is preserved
        const storedChunkMap = new Map(storedChunks.map(c => [c.chunkIdx, c]));


        // 4. Prepare LangChain Documents for the vector store
        logger.debug(`[ChunkingService] Object ${objectId}: Preparing ${storedChunks.length} LangChain documents for embedding...`);
        const documents = storedChunks.map(dbChunk => new Document({
            pageContent: dbChunk.content,
            metadata: {
                sqlChunkId: dbChunk.id, // Use the actual SQL ID!
                objectId: dbChunk.objectId,
                chunkIdx: dbChunk.chunkIdx,
                summary: dbChunk.summary ?? undefined,
                tags: dbChunk.tagsJson ?? undefined, // Pass the raw JSON string? Or parse? Check IVectorStore expected format. Assume string for now.
                propositions: dbChunk.propositionsJson ?? undefined,
                sourceUri: obj.sourceUri ?? undefined,
                title: obj.title ?? undefined // Include the object's title in metadata
            }
        }));

        // 5. Add documents to vector store via the injected interface
        logger.debug(`[ChunkingService] Object ${objectId}: Calling injected vectorStore to add/embed ${documents.length} documents...`);
        const vectorIds = await this.vectorStore.addDocuments(documents);
        // NOTE: We might want to store the mapping between sqlChunkId and vectorId in the 'embeddings' table here.
        // This depends on whether ChromaVectorModel.addDocuments returns IDs in a predictable order
        // and whether we need that link explicitly. Skipping for now.
        logger.info(`[ChunkingService] Object ${objectId}: Successfully added/embedded ${documents.length} documents via vectorStore. Vector IDs count: ${vectorIds.length}`);

        // 6. Create records in the 'embeddings' SQL table to link SQL chunks to vector IDs
        if (vectorIds.length === storedChunks.length) {
            logger.debug(`[ChunkingService] Object ${objectId}: Storing ${vectorIds.length} embedding links in SQL...`);
            for (let i = 0; i < storedChunks.length; i++) {
                const dbChunk = storedChunks[i];
                const vectorId = vectorIds[i];
                if (dbChunk && vectorId) { // Basic check
                    try {
                        this.embeddingSqlModel.addEmbeddingRecord({
                            chunkId: dbChunk.id, // This is the SQL primary key from 'chunks' table
                            model: EMBEDDING_MODEL_NAME_FOR_RECORD, // Use the defined constant
                            vectorId: vectorId, // The ID returned by the vector store
                        });
                    } catch (linkError) {
                        logger.error(`[ChunkingService] Object ${objectId}: Failed to store embedding link for chunk SQL ID ${dbChunk.id} and vector ID ${vectorId}:`, linkError);
                        // Decide if this is fatal for the object or if we should continue.
                        // For now, log and continue, but the object might be in an inconsistent state.
                    }
                } else {
                    logger.warn(`[ChunkingService] Object ${objectId}: Missing dbChunk or vectorId at index ${i} when creating embedding links. Skipping.`);
                }
            }
            logger.info(`[ChunkingService] Object ${objectId}: Successfully stored ${vectorIds.length} embedding links in SQL.`);
        } else {
            logger.error(`[ChunkingService] Object ${objectId}: Mismatch between stored SQL chunks (${storedChunks.length}) and returned vector IDs (${vectorIds.length}). Cannot reliably store embedding links.`);
            // This is a more serious issue, potentially throw to mark object as failed.
            throw new Error(`Mismatch in chunk count and vector ID count for object ${objectId}. Embedding links cannot be stored.`);
        }

    } catch (error) {
        // Re-throw error, ensuring objectId is included for the tick() error handler
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed processing objectId: ${objectId}. Reason: ${message}`);
    }
  }

  /**
   * Process a PDF object which already has a single chunk created by PdfIngestionService
   * @param obj The PDF object to process (must have status 'embedding')
   * @throws Error if processing fails at any step
   */
  private async processPdfObject(obj: JeffersObject): Promise<void> {
    const objectId = obj.id;
    
    try {
        logger.debug(`[ChunkingService] Processing PDF object ${objectId}: ${obj.title}`);
        
        // 1. Fetch the existing chunk for this PDF
        const existingChunks = await this.chunkSqlModel.listByObjectId(objectId);
        
        if (!existingChunks || existingChunks.length === 0) {
            throw new Error(`No chunks found for PDF object ${objectId}`);
        }
        
        if (existingChunks.length > 1) {
            logger.warn(`[ChunkingService] PDF object ${objectId} has ${existingChunks.length} chunks, expected 1. Processing only the first.`);
        }
        
        const pdfChunk = existingChunks[0];
        logger.debug(`[ChunkingService] Found PDF chunk ID ${pdfChunk.id} for object ${objectId}`);
        
        // 2. Prepare document for embedding
        const document = new Document({
            pageContent: pdfChunk.content,
            metadata: {
                sqlChunkId: pdfChunk.id,
                objectId: pdfChunk.objectId,
                chunkIdx: 0,
                documentType: 'pdf_ai_summary',
                title: obj.title ?? undefined,
                sourceUri: obj.sourceUri ?? undefined,
                // Include object-level data since chunk doesn't duplicate it
                tags: obj.tagsJson ?? undefined,
                propositions: obj.propositionsJson ?? undefined
            }
        });
        
        // 3. Add to vector store
        logger.debug(`[ChunkingService] PDF object ${objectId}: Creating embedding...`);
        const vectorIds = await this.vectorStore.addDocuments([document]);
        
        if (!vectorIds || vectorIds.length === 0) {
            throw new Error(`Failed to create embedding for PDF object ${objectId}`);
        }
        
        const vectorId = vectorIds[0];
        logger.info(`[ChunkingService] PDF object ${objectId}: Successfully created embedding with vector ID ${vectorId}`);
        
        // 4. Link embedding in SQL
        try {
            this.embeddingSqlModel.addEmbeddingRecord({
                chunkId: pdfChunk.id,
                model: EMBEDDING_MODEL_NAME_FOR_RECORD,
                vectorId: vectorId
            });
            logger.debug(`[ChunkingService] PDF object ${objectId}: Successfully linked embedding record`);
        } catch (linkError) {
            logger.error(`[ChunkingService] PDF object ${objectId}: Failed to store embedding link:`, linkError);
            throw linkError; // This is critical for PDFs
        }
        
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed processing PDF objectId: ${objectId}. Reason: ${message}`);
    }
  }
}

/**
 * Create and export a factory function for the application
 * Note: actual initialization should happen in electron/main.ts
 */
export const createChunkingService = (
  db: Database.Database,
  vectorStore: IVectorStore,
  llmService: LLMService,
  embeddingSqlModel?: EmbeddingSqlModel,
  ingestionJobModel?: IngestionJobModel,
  intervalMs?: number,
  concurrency?: number
): ChunkingService => {
  // Ensure IngestionJobModel is also passed or created if not provided
  const finalIngestionJobModel = ingestionJobModel ?? new IngestionJobModel(db);
  return new ChunkingService(
    db, 
    vectorStore, 
    intervalMs, 
    undefined, // agent, let constructor handle LLMService
    undefined, // objectModel
    undefined, // chunkSqlModel
    embeddingSqlModel,
    finalIngestionJobModel,
    llmService,
    concurrency
  );
};
