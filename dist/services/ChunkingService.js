"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChunkingService = exports.ChunkingService = void 0;
const OpenAiAgent_1 = require("./agents/OpenAiAgent");
const ObjectModel_1 = require("../models/ObjectModel");
const ChunkSqlModel_1 = require("../models/ChunkSqlModel");
const ChromaVectorModel_1 = require("../models/ChromaVectorModel");
const documents_1 = require("@langchain/core/documents");
const logger_1 = require("../utils/logger");
/**
 * Runs a single‑threaded polling loop. Every `intervalMs` it:
 *   1. grabs one object whose status === 'parsed'
 *   2. atomically flips it to 'embedding' (race‑safe)
 *   3. asks OpenAI‑GPT‑4.1‑nano to produce semantic chunks
 *   4. bulk‑inserts the chunks into SQL
 *   5. adds chunk embeddings to Chroma
 *   6. marks the object 'embedded' or 'embedding_failed'
 *
 * v1 is intentionally simple: single worker, no retry queue, no
 * back‑pressure. Concurrency and exponential retry can be layered on
 * later without changing the public API.
 */
class ChunkingService {
    /**
     * Creates a new ChunkingService instance.
     * @param db Database instance to use for all data access
     * @param intervalMs Polling interval in milliseconds (default: 30s)
     * @param agent OpenAI agent instance for semantic chunking
     * @param objectModel Object data model instance (or new one created if not provided)
     * @param chunkSqlModel Chunk data model instance (or new one created if not provided)
     */
    constructor(db, intervalMs = 30000, // 30s default
    agent = new OpenAiAgent_1.OpenAiAgent(), objectModel, chunkSqlModel) {
        this.timer = null;
        this.isProcessing = false; // Helps prevent overlapping processing
        this.intervalMs = intervalMs;
        this.agent = agent;
        // Create model instances if not provided (using the same db instance)
        this.objectModel = objectModel !== null && objectModel !== void 0 ? objectModel : new ObjectModel_1.ObjectModel(db);
        this.chunkSqlModel = chunkSqlModel !== null && chunkSqlModel !== void 0 ? chunkSqlModel : new ChunkSqlModel_1.ChunkSqlModel(db);
    }
    /**
     * Start the polling loop. A second call is a no‑op.
     * @returns this (for method chaining)
     */
    start() {
        if (this.timer) {
            logger_1.logger.debug("[ChunkingService] start() called but service is already running");
            return this; // Already running
        }
        // Run immediately on start
        this.tick().catch(e => logger_1.logger.error("[ChunkingService] Error during first tick:", e));
        this.timer = setInterval(() => this.tick().catch(err => logger_1.logger.error("[ChunkingService] Error during tick:", err)), this.intervalMs);
        logger_1.logger.info(`[ChunkingService] Started with interval ${this.intervalMs}ms`);
        return this;
    }
    /**
     * Stop the polling loop; pending LLM calls are not interrupted.
     * @returns this (for method chaining)
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logger_1.logger.info("[ChunkingService] Stopped polling");
        }
        else {
            logger_1.logger.debug("[ChunkingService] stop() called but service was not running");
        }
        return this;
    }
    /**
     * Is the service currently running its polling loop?
     */
    isRunning() {
        return this.timer !== null;
    }
    // --- private helpers -----------------------------------------------------
    /**
     * Process at most ONE object per tick.
     * Keeps v1 single‑threaded & easy to reason about.
     */
    async tick() {
        // Skip if we're still processing the previous tick
        if (this.isProcessing) {
            logger_1.logger.debug("[ChunkingService] Skipping tick as previous work is still processing");
            return;
        }
        let claimedObjectId = null; // Keep track of the object ID we claimed
        this.isProcessing = true;
        try {
            // Fetch the next object with 'parsed' status
            const objects = await this.objectModel.findByStatus(['parsed']);
            if (!objects || objects.length === 0) {
                logger_1.logger.debug("[ChunkingService] No objects with 'parsed' status found");
                return; // Exit early, no finally block needed here
            }
            const targetObj = objects[0]; // Take the first one
            claimedObjectId = targetObj.id; // Store the ID before attempting claim
            // Attempt atomic status transition to 'embedding' (race-condition safe)
            await this.objectModel.updateStatus(claimedObjectId, 'embedding');
            // Double-check we actually got the object (in case we lost a race)
            const obj = await this.objectModel.getById(claimedObjectId);
            if (!obj || obj.status !== 'embedding') { // Check for 'embedding' status
                logger_1.logger.warn(`[ChunkingService] Failed to claim object ${claimedObjectId} for embedding (lost race or object disappeared)`);
                claimedObjectId = null; // Reset claimed ID as we didn't get it
                return; // Exit early
            }
            logger_1.logger.info(`[ChunkingService] Processing object ${obj.id} for chunking & embedding (${obj.sourceUri || 'no source URI'})`);
            // Process object (includes chunking, SQL storage, and vector embedding)
            await this.processObject(obj);
            // Update status to 'embedded' on success
            await this.objectModel.updateStatus(obj.id, 'embedded');
            logger_1.logger.info(`[ChunkingService] Object ${obj.id} successfully chunked and embedded`);
            claimedObjectId = null; // Successfully processed, clear claimed ID
        }
        catch (err) {
            const error = err;
            logger_1.logger.error(`[ChunkingService] Error during tick processing object ${claimedObjectId !== null && claimedObjectId !== void 0 ? claimedObjectId : 'unknown'}: ${error.message}`, error);
            // If we had claimed an object but failed to process it, update its status
            if (claimedObjectId) {
                try {
                    await this.objectModel.updateStatus(claimedObjectId, 'embedding_failed', // Use new failure status
                    undefined, // parsedAt unchanged
                    error.message.slice(0, 1000) // Truncate very long error messages
                    );
                    logger_1.logger.info(`[ChunkingService] Marked object ${claimedObjectId} as embedding_failed`);
                }
                catch (statusUpdateError) {
                    logger_1.logger.error(`[ChunkingService] CRITICAL: Failed to update status to embedding_failed for object ${claimedObjectId} after initial error:`, statusUpdateError);
                }
            }
            // Do not reset claimedObjectId here, it's handled by the finally block if needed
        }
        finally {
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
    async processObject(obj) {
        const objectId = obj.id; // Capture for error messages
        try {
            if (!obj.cleanedText) {
                throw new Error(`cleanedText is NULL`);
            }
            // 1. Call the agent to generate chunks
            logger_1.logger.debug(`[ChunkingService] Object ${objectId}: Calling OpenAiAgent for chunking...`);
            const chunks = await this.agent.chunkText(obj.cleanedText, objectId);
            if (!chunks || chunks.length === 0) {
                throw new Error(`LLM returned empty chunks array`);
            }
            logger_1.logger.debug(`[ChunkingService] Object ${objectId}: LLM generated ${chunks.length} chunks`);
            // 2. Prepare chunks for SQL database insertion
            const preparedSqlChunks = chunks.map((chunk, idx) => ({
                objectId: objectId,
                chunkIdx: idx, // Use the index from the LLM response
                content: chunk.content,
                summary: chunk.summary || null,
                tagsJson: chunk.tags && chunk.tags.length > 0 ? JSON.stringify(chunk.tags) : null,
                propositionsJson: chunk.propositions && chunk.propositions.length > 0 ? JSON.stringify(chunk.propositions) : null,
            }));
            // 3. Bulk insert the chunks into SQL
            logger_1.logger.debug(`[ChunkingService] Object ${objectId}: Storing ${preparedSqlChunks.length} chunks in SQL...`);
            await this.chunkSqlModel.addChunksBulk(preparedSqlChunks);
            logger_1.logger.info(`[ChunkingService] Object ${objectId}: Successfully stored ${preparedSqlChunks.length} chunks in SQL database`);
            // 4. Prepare LangChain Documents for Chroma
            logger_1.logger.debug(`[ChunkingService] Object ${objectId}: Preparing ${chunks.length} LangChain documents for embedding...`);
            const documents = chunks.map(chunk => {
                var _a, _b, _c, _d;
                return new documents_1.Document({
                    pageContent: chunk.content,
                    metadata: {
                        objectId: objectId,
                        chunkIdx: chunk.chunkIdx, // Use index from LLM result
                        summary: (_a = chunk.summary) !== null && _a !== void 0 ? _a : undefined,
                        tags: (_b = chunk.tags) !== null && _b !== void 0 ? _b : undefined,
                        propositions: (_c = chunk.propositions) !== null && _c !== void 0 ? _c : undefined,
                        sourceUri: (_d = obj.sourceUri) !== null && _d !== void 0 ? _d : undefined // Include source URI if available
                        // Add other relevant metadata from obj if needed
                    }
                });
            });
            // 5. Generate stable Document IDs for Chroma upsert
            const documentIds = chunks.map(chunk => `${objectId}_${chunk.chunkIdx}`);
            // 6. Add documents to Chroma via ChromaVectorModel (handles embedding)
            logger_1.logger.debug(`[ChunkingService] Object ${objectId}: Calling ChromaVectorModel to add/embed ${documents.length} documents...`);
            await ChromaVectorModel_1.chromaVectorModel.addDocuments(documents, documentIds);
            logger_1.logger.info(`[ChunkingService] Object ${objectId}: Successfully added/embedded ${documents.length} documents in Chroma`);
        }
        catch (error) {
            // Re-throw error, ensuring objectId is included for the tick() error handler
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed processing objectId: ${objectId}. Reason: ${message}`);
        }
    }
}
exports.ChunkingService = ChunkingService;
/**
 * Create and export a factory function for the application
 * Note: actual initialization should happen in electron/main.ts
 */
const createChunkingService = (db, intervalMs) => {
    return new ChunkingService(db, intervalMs);
};
exports.createChunkingService = createChunkingService;
//# sourceMappingURL=ChunkingService.js.map