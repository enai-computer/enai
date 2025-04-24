"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChunkingService = exports.ChunkingService = void 0;
const OpenAiAgent_1 = require("./agents/OpenAiAgent");
const ObjectModel_1 = require("../models/ObjectModel");
const ChunkSqlModel_1 = require("../models/ChunkSqlModel");
const logger_1 = require("../utils/logger");
/**
 * Runs a single‑threaded polling loop. Every `intervalMs` it:
 *   1. grabs one object whose status === 'parsed'
 *   2. atomically flips it to 'chunking' (race‑safe)
 *   3. asks OpenAI‑GPT‑4.1‑nano to produce semantic chunks
 *   4. bulk‑inserts the chunks
 *   5. marks the object 'chunked' or 'chunking_failed'
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
        this.isProcessing = true;
        try {
            // Fetch the next object with 'parsed' status
            const objects = await this.objectModel.findByStatus(['parsed']);
            if (!objects || objects.length === 0) {
                logger_1.logger.debug("[ChunkingService] No objects with 'parsed' status found");
                return;
            }
            const targetObj = objects[0]; // Take the first one
            // Attempt atomic status transition (race-condition safe)
            await this.objectModel.updateStatus(targetObj.id, 'chunking');
            // Double-check we actually got the object (in case we lost a race)
            const obj = await this.objectModel.getById(targetObj.id);
            if (!obj || obj.status !== 'chunking') {
                logger_1.logger.warn(`[ChunkingService] Failed to claim object ${targetObj.id} for chunking (lost race or object disappeared)`);
                return;
            }
            logger_1.logger.info(`[ChunkingService] Processing object ${obj.id} (${obj.sourceUri || 'no source URI'})`);
            await this.processObject(obj);
            // Update status to 'chunked' on success
            await this.objectModel.updateStatus(obj.id, 'chunked');
            logger_1.logger.info(`[ChunkingService] Object ${obj.id} successfully chunked`);
        }
        catch (err) {
            const error = err;
            logger_1.logger.error(`[ChunkingService] Error during tick: ${error.message}`, error);
            // If we had claimed an object but failed to process it, update its status
            if (error.message.includes('objectId:')) {
                // Extract object ID from the error message
                const match = error.message.match(/objectId: ([a-f0-9-]+)/i);
                if (match && match[1]) {
                    const failedId = match[1];
                    await this.objectModel.updateStatus(failedId, 'chunking_failed', undefined, // parsedAt unchanged
                    error.message.slice(0, 1000) // Truncate very long error messages
                    );
                    logger_1.logger.info(`[ChunkingService] Marked object ${failedId} as chunking_failed`);
                }
            }
        }
        finally {
            // Always reset processing flag, even if an unexpected exception occurs
            this.isProcessing = false;
        }
    }
    /**
     * Process a single object through the chunking pipeline.
     * @param obj The object to process
     * @throws Error if processing fails at any step
     */
    async processObject(obj) {
        if (!obj.cleanedText) {
            throw new Error(`cleanedText is NULL (objectId: ${obj.id})`);
        }
        // Call the agent to generate chunks (now with objectId for logging)
        const chunks = await this.agent.chunkText(obj.cleanedText, obj.id);
        if (!chunks || chunks.length === 0) {
            throw new Error(`LLM returned empty chunks array (objectId: ${obj.id})`);
        }
        logger_1.logger.debug(`[ChunkingService] Object ${obj.id}: LLM generated ${chunks.length} chunks`);
        // Prepare chunks for database insertion (ensure proper objectId and sequential chunkIdx)
        const preparedChunks = chunks.map((chunk, idx) => ({
            objectId: obj.id,
            chunkIdx: idx,
            content: chunk.content,
            summary: chunk.summary || null,
            // Set empty arrays to NULL rather than storing '[]'
            tagsJson: chunk.tags && chunk.tags.length > 0 ? JSON.stringify(chunk.tags) : null,
            propositionsJson: chunk.propositions && chunk.propositions.length > 0 ? JSON.stringify(chunk.propositions) : null,
            // We could estimate tokenCount here, but we already have it from OpenAiAgent's validation
        }));
        // Bulk insert the chunks
        await this.chunkSqlModel.addChunksBulk(preparedChunks);
        logger_1.logger.info(`[ChunkingService] Object ${obj.id}: Successfully stored ${preparedChunks.length} chunks in database`);
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