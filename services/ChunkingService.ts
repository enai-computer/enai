import { OpenAiAgent, ChunkLLMResult } from "./agents/OpenAiAgent";
import { ObjectModel } from "../models/ObjectModel";
import { ChunkSqlModel } from "../models/ChunkModel";
import { EmbeddingSqlModel } from '../models/EmbeddingModel';
import { Document } from "@langchain/core/documents";
import { logger } from "../utils/logger";
import { LLMService } from './LLMService';
import type { JeffersObject, ObjectStatus, IVectorStore } from "../shared/types";
import type Database from 'better-sqlite3';

const EMBEDDING_MODEL_NAME_FOR_RECORD = "text-embedding-3-small";

/**
 * Runs a single‑threaded polling loop. Every `intervalMs` it:
 *   1. grabs one object whose status === 'parsed'
 *   2. atomically flips it to 'embedding' (race‑safe)
 *   3. asks OpenAI‑GPT‑4.1‑nano to produce semantic chunks
 *   4. bulk‑inserts the chunks into SQL
 *   5. adds chunk embeddings to Chroma via the injected IVectorStore
 *   6. marks the object 'embedded' or 'embedding_failed'
 *
 * v1 is intentionally simple: single worker, no retry queue, no
 * back‑pressure. Concurrency and exponential retry can be layered on
 * later without changing the public API.
 */
export class ChunkingService {
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly agent: OpenAiAgent;
  private readonly objectModel: ObjectModel;
  private readonly chunkSqlModel: ChunkSqlModel;
  private readonly embeddingSqlModel: EmbeddingSqlModel;
  private readonly vectorStore: IVectorStore;
  private isProcessing: boolean = false; // Helps prevent overlapping processing

  /**
   * Creates a new ChunkingService instance.
   * @param db Database instance to use for all data access
   * @param vectorStore Instance conforming to IVectorStore for embedding storage.
   * @param intervalMs Polling interval in milliseconds (default: 30s)
   * @param agent OpenAI agent instance for semantic chunking
   * @param objectModel Object data model instance (or new one created if not provided)
   * @param chunkSqlModel Chunk data model instance (or new one created if not provided)
   * @param embeddingSqlModel Embedding data model instance (or new one created if not provided)
   */
  constructor(
    db: Database.Database,
    vectorStore: IVectorStore,
    intervalMs = 30_000, // 30s default
    agent?: OpenAiAgent,
    objectModel?: ObjectModel,
    chunkSqlModel?: ChunkSqlModel,
    embeddingSqlModel?: EmbeddingSqlModel,
    llmService?: LLMService
  ) {
    this.intervalMs = intervalMs;
    
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
   * Process at most ONE object per tick.
   * Keeps v1 single‑threaded & easy to reason about.
   */
  private async tick(): Promise<void> {
    // Skip if we're still processing the previous tick
    if (this.isProcessing) {
      logger.debug("[ChunkingService] Skipping tick as previous work is still processing");
      return;
    }

    let claimedObjectId: string | null = null; // Keep track of the object ID we claimed

    this.isProcessing = true;

    try {
      // Fetch the next object with 'parsed' status
      const objects = await this.objectModel.findByStatus(['parsed']);

      if (!objects || objects.length === 0) {
        logger.debug("[ChunkingService] No objects with 'parsed' status found");
        return; // Exit early, no finally block needed here
      }

      const targetObj = objects[0]; // Take the first one
      claimedObjectId = targetObj.id; // Store the ID before attempting claim

      // Attempt atomic status transition to 'embedding' (race-condition safe)
      await this.objectModel.updateStatus(claimedObjectId, 'embedding');

      // Double-check we actually got the object (in case we lost a race)
      const obj = await this.objectModel.getById(claimedObjectId);

      if (!obj || obj.status !== 'embedding') { // Check for 'embedding' status
        logger.warn(`[ChunkingService] Failed to claim object ${claimedObjectId} for embedding (lost race or object disappeared)`);
        claimedObjectId = null; // Reset claimed ID as we didn't get it
        return; // Exit early
      }

      logger.info(`[ChunkingService] Processing object ${obj.id} for chunking & embedding (${obj.sourceUri || 'no source URI'})`);

      // Process object (includes chunking, SQL storage, and vector embedding)
      await this.processObject(obj);

      // Update status to 'embedded' on success
      await this.objectModel.updateStatus(obj.id, 'embedded');
      logger.info(`[ChunkingService] Object ${obj.id} successfully chunked and embedded`);
      claimedObjectId = null; // Successfully processed, clear claimed ID

    } catch (err) {
      const error = err as Error;
      logger.error(`[ChunkingService] Error during tick processing object ${claimedObjectId ?? 'unknown'}: ${error.message}`, error);

      // If we had claimed an object but failed to process it, update its status
      if (claimedObjectId) {
        try {
            await this.objectModel.updateStatus(
                claimedObjectId,
                'embedding_failed', // Use new failure status
                undefined, // parsedAt unchanged
                error.message.slice(0, 1000) // Truncate very long error messages
            );
            logger.info(`[ChunkingService] Marked object ${claimedObjectId} as embedding_failed`);
        } catch (statusUpdateError) {
             logger.error(`[ChunkingService] CRITICAL: Failed to update status to embedding_failed for object ${claimedObjectId} after initial error:`, statusUpdateError);
        }
      }
      // Do not reset claimedObjectId here, it's handled by the finally block if needed

    } finally {
      // Always reset processing flag, even if an unexpected exception occurs
      this.isProcessing = false;
       // Ensure claimedObjectId is cleared if not already null
      // claimedObjectId = null; // No, keep it for potential error logging in next tick if needed
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
  intervalMs?: number
): ChunkingService => {
  return new ChunkingService(db, vectorStore, intervalMs, undefined, undefined, undefined, embeddingSqlModel, llmService);
};
