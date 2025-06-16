import { IngestionAiService, ChunkLLMResult } from "./IngestionAIService";
import { ObjectModel } from "../../models/ObjectModel";
import { ChunkSqlModel } from "../../models/ChunkModel";
import { EmbeddingSqlModel } from '../../models/EmbeddingModel';
import { IngestionJobModel } from '../../models/IngestionJobModel';
import { Document } from "@langchain/core/documents";
import type { JeffersObject, ObjectStatus, JobStatus } from "../../shared/types";
import type { IVectorStoreModel } from "../../models/ChromaVectorModel";
import type Database from 'better-sqlite3';
import { BaseService } from '../base/BaseService';
import { BaseServiceDependencies } from '../interfaces';

const EMBEDDING_MODEL_NAME_FOR_RECORD = "text-embedding-3-small";

interface ChunkingServiceDeps extends BaseServiceDependencies {
  ingestionAiService: IngestionAiService;
  objectModel: ObjectModel;
  chunkSqlModel: ChunkSqlModel;
  embeddingSqlModel: EmbeddingSqlModel;
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
      const objects = await this.deps.objectModel.findByStatus(['parsed']);

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
          await this.deps.objectModel.updateStatus(
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
      await this.deps.objectModel.updateStatus(objectId, 'embedding');
      
      // Double-check we actually got the object (in case we lost a race)
      const claimedObj = await this.deps.objectModel.getById(objectId);
      
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
      await this.deps.objectModel.updateStatus(objectId, 'embedded');
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
        await this.deps.objectModel.updateStatus(
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
        this.logDebug(`Object ${objectId}: Calling IngestionAiService for chunking...`);
        const chunks = await this.deps.ingestionAiService.chunkText(obj.cleanedText, objectId);

        if (!chunks || chunks.length === 0) {
            throw new Error(`LLM returned empty chunks array`);
        }
        this.logDebug(`Object ${objectId}: LLM generated ${chunks.length} chunks`);

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
        this.logDebug(`Object ${objectId}: Storing ${preparedSqlChunksData.length} chunks in SQL...`);
        await this.deps.chunkSqlModel.addChunksBulk(preparedSqlChunksData);
        this.logInfo(`Object ${objectId}: Successfully stored ${preparedSqlChunksData.length} chunks in SQL database`);

        // 3b. Fetch the newly created chunks WITH their IDs
        const storedChunks = await this.deps.chunkSqlModel.listByObjectId(objectId);
        if (storedChunks.length !== chunks.length) {
            // This indicates a potential issue with the bulk insert or fetch logic
            this.logWarn(`Object ${objectId}: Mismatch between expected chunks (${chunks.length}) and fetched SQL chunks (${storedChunks.length}) after insert.`);
            // Decide how to handle this - throw, log and continue, etc.
            // For now, proceed, but this might cause issues linking embeddings.
             if (storedChunks.length === 0) {
                 throw new Error(`Failed to retrieve any chunks from SQL after bulk insert for object ${objectId}`);
             }
        }
        // Create a map for quick lookup by chunk index if needed, assuming order is preserved
        const storedChunkMap = new Map(storedChunks.map(c => [c.chunkIdx, c]));


        // 4. Prepare LangChain Documents for the vector store
        this.logDebug(`Object ${objectId}: Preparing ${storedChunks.length} LangChain documents for embedding...`);
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
        this.logDebug(`Object ${objectId}: Calling injected vectorStore to add/embed ${documents.length} documents...`);
        const vectorIds = await this.deps.vectorStore.addDocuments(documents);
        // NOTE: We might want to store the mapping between sqlChunkId and vectorId in the 'embeddings' table here.
        // This depends on whether ChromaVectorModel.addDocuments returns IDs in a predictable order
        // and whether we need that link explicitly. Skipping for now.
        this.logInfo(`Object ${objectId}: Successfully added/embedded ${documents.length} documents via vectorStore. Vector IDs count: ${vectorIds.length}`);

        // 6. Create records in the 'embeddings' SQL table to link SQL chunks to vector IDs
        if (vectorIds.length === storedChunks.length) {
            this.logDebug(`Object ${objectId}: Storing ${vectorIds.length} embedding links in SQL...`);
            for (let i = 0; i < storedChunks.length; i++) {
                const dbChunk = storedChunks[i];
                const vectorId = vectorIds[i];
                if (dbChunk && vectorId) { // Basic check
                    try {
                        this.deps.embeddingSqlModel.addEmbeddingRecord({
                            chunkId: dbChunk.id, // This is the SQL primary key from 'chunks' table
                            model: EMBEDDING_MODEL_NAME_FOR_RECORD, // Use the defined constant
                            vectorId: vectorId, // The ID returned by the vector store
                        });
                    } catch (linkError) {
                        this.logError(`Object ${objectId}: Failed to store embedding link for chunk SQL ID ${dbChunk.id} and vector ID ${vectorId}:`, linkError);
                        // Decide if this is fatal for the object or if we should continue.
                        // For now, log and continue, but the object might be in an inconsistent state.
                    }
                } else {
                    this.logWarn(`Object ${objectId}: Missing dbChunk or vectorId at index ${i} when creating embedding links. Skipping.`);
                }
            }
            this.logInfo(`Object ${objectId}: Successfully stored ${vectorIds.length} embedding links in SQL.`);
        } else {
            this.logError(`Object ${objectId}: Mismatch between stored SQL chunks (${storedChunks.length}) and returned vector IDs (${vectorIds.length}). Cannot reliably store embedding links.`);
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
        this.logDebug(`Processing PDF object ${objectId}: ${obj.title}`);
        
        // 1. Fetch the existing chunk for this PDF
        const existingChunks = await this.deps.chunkSqlModel.listByObjectId(objectId);
        
        if (!existingChunks || existingChunks.length === 0) {
            throw new Error(`No chunks found for PDF object ${objectId}`);
        }
        
        if (existingChunks.length > 1) {
            this.logWarn(`PDF object ${objectId} has ${existingChunks.length} chunks, expected 1. Processing only the first.`);
        }
        
        const pdfChunk = existingChunks[0];
        this.logDebug(`Found PDF chunk ID ${pdfChunk.id} for object ${objectId}`);
        
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
        this.logDebug(`PDF object ${objectId}: Creating embedding...`);
        const vectorIds = await this.deps.vectorStore.addDocuments([document]);
        
        if (!vectorIds || vectorIds.length === 0) {
            throw new Error(`Failed to create embedding for PDF object ${objectId}`);
        }
        
        const vectorId = vectorIds[0];
        this.logInfo(`PDF object ${objectId}: Successfully created embedding with vector ID ${vectorId}`);
        
        // 4. Link embedding in SQL
        try {
            this.deps.embeddingSqlModel.addEmbeddingRecord({
                chunkId: pdfChunk.id,
                model: EMBEDDING_MODEL_NAME_FOR_RECORD,
                vectorId: vectorId
            });
            this.logDebug(`PDF object ${objectId}: Successfully linked embedding record`);
        } catch (linkError) {
            this.logError(`PDF object ${objectId}: Failed to store embedding link:`, linkError);
            throw linkError; // This is critical for PDFs
        }
        
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed processing PDF objectId: ${objectId}. Reason: ${message}`);
    }
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
      await this.deps.vectorStore.querySimilarByText('test', 1);
      
      // Check for stuck processing (objects in activeProcessing for too long)
      // This is a simple check - in production you might track timestamps
      if (this.activeProcessing.size > this.concurrency * 2) {
        this.logWarn(`Health check warning: ${this.activeProcessing.size} active processing (max expected: ${this.concurrency * 2})`);
        return false;
      }
      
      return true;
    } catch (error) {
      this.logError('Health check failed:', error);
      return false;
    }
  }
}

