"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChunkSqlModel = void 0;
// import getDb from './db'; // Remove unused import
const logger_1 = require("../utils/logger");
// Helper to convert DB record (snake_case) to application object (camelCase)
function mapRecordToChunk(record) {
    return {
        id: record.id,
        objectId: record.object_id,
        notebookId: record.notebook_id,
        chunkIdx: record.chunk_idx,
        content: record.content,
        summary: record.summary,
        tagsJson: record.tags_json,
        propositionsJson: record.propositions_json,
        tokenCount: record.token_count,
        createdAt: new Date(record.created_at),
    };
}
class ChunkSqlModel {
    /**
     * Creates an instance of ChunkSqlModel.
     * @param dbInstance - An initialized better-sqlite3 database instance.
     */
    constructor(dbInstance) {
        this.db = dbInstance; // Store the passed DB instance
    }
    /**
     * Creates a new chunk record in the database.
     * @param data - The chunk data, including objectId.
     * @returns Promise resolving to the fully created ObjectChunk including generated ID and createdAt.
     */
    async addChunk(data) {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
            INSERT INTO chunks (object_id, notebook_id, chunk_idx, content, summary, tags_json, propositions_json, token_count, created_at)
            VALUES (@objectId, @notebookIdDb, @chunkIdx, @content, @summary, @tagsJson, @propositionsJson, @tokenCount, @createdAt)
        `);
        try {
            const info = stmt.run({
                objectId: data.objectId,
                notebookIdDb: data.notebookId ?? null,
                chunkIdx: data.chunkIdx,
                content: data.content,
                summary: data.summary ?? null,
                tagsJson: data.tagsJson ?? null,
                propositionsJson: data.propositionsJson ?? null,
                tokenCount: data.tokenCount ?? null,
                createdAt: now,
            });
            const newId = info.lastInsertRowid;
            logger_1.logger.debug(`[ChunkSqlModel] Added chunk with ID: ${newId} for object ${data.objectId}`);
            // Fetch and return the newly created chunk
            const newRecord = this.getById(newId);
            if (!newRecord) {
                // Should not happen if insert succeeded
                throw new Error('Failed to retrieve newly created chunk');
            }
            return newRecord;
        }
        catch (error) {
            logger_1.logger.error(`[ChunkSqlModel] Failed to add chunk for object ${data.objectId}, index ${data.chunkIdx}:`, error);
            throw error;
        }
    }
    /**
     * Creates a new chunk record in the database synchronously.
     * For use within transactions where async operations are not allowed.
     * @param data - The chunk data, including objectId.
     * @returns The created ObjectChunk including generated ID and createdAt.
     */
    addChunkSync(data) {
        const now = new Date();
        const nowISO = now.toISOString();
        const stmt = this.db.prepare(`
            INSERT INTO chunks (object_id, notebook_id, chunk_idx, content, summary, tags_json, propositions_json, token_count, created_at)
            VALUES (@objectId, @notebookIdDb, @chunkIdx, @content, @summary, @tagsJson, @propositionsJson, @tokenCount, @createdAt)
        `);
        try {
            const info = stmt.run({
                objectId: data.objectId,
                notebookIdDb: data.notebookId ?? null,
                chunkIdx: data.chunkIdx,
                content: data.content,
                summary: data.summary ?? null,
                tagsJson: data.tagsJson ?? null,
                propositionsJson: data.propositionsJson ?? null,
                tokenCount: data.tokenCount ?? null,
                createdAt: nowISO,
            });
            const newId = info.lastInsertRowid;
            logger_1.logger.debug(`[ChunkSqlModel] Added chunk synchronously with ID: ${newId} for object ${data.objectId}`);
            // getById is already synchronous, so we can use it directly
            const newRecord = this.getById(newId);
            if (!newRecord) {
                // Should not happen if insert succeeded
                throw new Error('Failed to retrieve newly created chunk');
            }
            return newRecord;
        }
        catch (error) {
            logger_1.logger.error(`[ChunkSqlModel] Failed to add chunk synchronously for object ${data.objectId}, index ${data.chunkIdx}:`, error);
            throw error;
        }
    }
    /**
     * Adds multiple chunks in a single transaction.
     * @param chunks - An array of chunk data to insert.
     * @returns Promise resolving to an array of the created ObjectChunk IDs.
     */
    async addChunksBulk(chunks) {
        if (chunks.length === 0)
            return [];
        const insertStmt = this.db.prepare(`
            INSERT INTO chunks (object_id, notebook_id, chunk_idx, content, summary, tags_json, propositions_json, token_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const now = new Date().toISOString();
        const insertedIds = [];
        const insertMany = this.db.transaction((chunkBatch) => {
            for (const c of chunkBatch) {
                const info = insertStmt.run(c.objectId, c.notebookId ?? null, c.chunkIdx, c.content, c.summary ?? null, c.tagsJson ?? null, c.propositionsJson ?? null, c.tokenCount ?? null, now);
                insertedIds.push(info.lastInsertRowid);
            }
        });
        try {
            const result = await insertMany(chunks);
            logger_1.logger.debug(`[ChunkSqlModel] Bulk added ${insertedIds.length} chunks for object ${chunks[0]?.objectId}`);
            return insertedIds;
        }
        catch (error) {
            logger_1.logger.error(`[ChunkSqlModel] Failed to bulk add chunks for object ${chunks[0]?.objectId}:`, error);
            throw error;
        }
    }
    /**
     * Retrieves chunks that do not yet have an associated embedding record.
     * @param limit - Maximum number of chunks to retrieve.
     * @returns An array of ObjectChunk that need embedding.
     */
    listUnembedded(limit = 100) {
        const stmt = this.db.prepare(`
            SELECT c.*
            FROM chunks c
            LEFT JOIN embeddings e ON e.chunk_id = c.id
            WHERE e.id IS NULL
            ORDER BY c.object_id, c.chunk_idx -- Consistent ordering
            LIMIT ?
        `);
        try {
            const records = stmt.all(limit);
            logger_1.logger.debug(`[ChunkSqlModel] Found ${records.length} unembedded chunks.`);
            return records.map(mapRecordToChunk);
        }
        catch (error) {
            logger_1.logger.error('[ChunkSqlModel] Failed to list unembedded chunks:', error);
            throw error;
        }
    }
    /**
     * Retrieves a single chunk by its ID.
     * @param id - The primary key ID of the chunk.
     * @returns The ObjectChunk or null if not found.
     */
    getById(id) {
        const stmt = this.db.prepare('SELECT * FROM chunks WHERE id = ?');
        try {
            const record = stmt.get(id);
            return record ? mapRecordToChunk(record) : null;
        }
        catch (error) {
            logger_1.logger.error(`[ChunkSqlModel] Failed to get chunk by ID ${id}:`, error);
            throw error;
        }
    }
    /**
     * Retrieves all chunks associated with a specific object ID.
     * @param objectId - The UUID of the parent object.
     * @returns An array of ObjectChunk ordered by chunk index.
     */
    listByObjectId(objectId) {
        const stmt = this.db.prepare('SELECT * FROM chunks WHERE object_id = ? ORDER BY chunk_idx ASC');
        try {
            const records = stmt.all(objectId);
            logger_1.logger.debug(`[ChunkSqlModel] Found ${records.length} chunks for object ${objectId}.`);
            return records.map(mapRecordToChunk);
        }
        catch (error) {
            logger_1.logger.error(`[ChunkSqlModel] Failed to list chunks for object ${objectId}:`, error);
            throw error;
        }
    }
    /**
     * Retrieves all chunks associated with a specific notebook ID.
     * @param notebookId - The UUID of the parent notebook.
     * @returns An array of ObjectChunk ordered by chunk index.
     */
    async listByNotebookId(notebookId) {
        const stmt = this.db.prepare('SELECT * FROM chunks WHERE notebook_id = ? ORDER BY chunk_idx ASC');
        try {
            const records = stmt.all(notebookId);
            logger_1.logger.debug(`[ChunkSqlModel] Found ${records.length} chunks for notebook ${notebookId}.`);
            return records.map(mapRecordToChunk);
        }
        catch (error) {
            logger_1.logger.error(`[ChunkSqlModel] Failed to list chunks for notebook ${notebookId}:`, error);
            throw error;
        }
    }
    /**
     * Fetches full chunk data for the given chunk primary key IDs.
     * Handles string IDs from sources like Chroma metadata, converting them to numbers.
     * Safely parses JSON fields (tags, propositions).
     * Returns an empty array if no valid IDs are provided or no matching chunks are found.
     * NOTE: Does not guarantee result order matches input order. Caller must re-sort if needed.
     * NOTE: For > 999 IDs, this will currently fail. Implement batching if needed.
     * @param chunkIds Array of chunk primary key IDs, expected as strings.
     * @returns Array of ObjectChunk objects.
     */
    getChunksByIds(chunkIds) {
        if (!chunkIds || chunkIds.length === 0) {
            return [];
        }
        const numericIds = [];
        const invalidIds = [];
        // Validate and convert IDs to numbers
        for (const idStr of chunkIds) {
            const idNum = Number(idStr);
            if (!isNaN(idNum) && Number.isInteger(idNum)) {
                numericIds.push(idNum);
            }
            else {
                invalidIds.push(idStr);
            }
        }
        if (invalidIds.length > 0) {
            logger_1.logger.warn(`[ChunkModel] getChunksByIds received invalid non-numeric IDs: [${invalidIds.join(', ')}]`);
        }
        if (numericIds.length === 0) {
            logger_1.logger.warn('[ChunkModel] getChunksByIds called with no valid numeric IDs.');
            return [];
        }
        // Create placeholders: (?, ?, ?)
        const placeholders = numericIds.map(() => '?').join(', ');
        const query = `SELECT * FROM chunks WHERE id IN (${placeholders})`;
        try {
            logger_1.logger.debug(`[ChunkModel] Fetching chunks for ${numericIds.length} valid IDs: [${numericIds.slice(0, 5).join(', ')}...]`);
            const stmt = this.db.prepare(query);
            const rows = stmt.all(numericIds); // Use validated numeric IDs
            logger_1.logger.debug(`[ChunkModel] Found ${rows.length} chunks for ${numericIds.length} provided valid IDs.`);
            // Map results with safe JSON parsing
            return rows.map(record => {
                let tags = [];
                let propositions = [];
                try {
                    if (record.tags_json) {
                        // Basic validation: check if it looks like JSON before parsing
                        if (record.tags_json.trim().startsWith('[') && record.tags_json.trim().endsWith(']')) {
                            tags = JSON.parse(record.tags_json);
                        }
                        else {
                            logger_1.logger.warn(`[ChunkModel] Chunk ${record.id} has invalid tags_json (not an array): ${record.tags_json}`);
                        }
                    }
                }
                catch (e) {
                    logger_1.logger.warn(`[ChunkModel] Failed to parse tags_json for chunk ${record.id}: ${e instanceof Error ? e.message : e}. Content: ${record.tags_json}`);
                }
                try {
                    if (record.propositions_json) {
                        if (record.propositions_json.trim().startsWith('[') && record.propositions_json.trim().endsWith(']')) {
                            propositions = JSON.parse(record.propositions_json);
                        }
                        else {
                            logger_1.logger.warn(`[ChunkModel] Chunk ${record.id} has invalid propositions_json (not an array): ${record.propositions_json}`);
                        }
                    }
                }
                catch (e) {
                    logger_1.logger.warn(`[ChunkModel] Failed to parse propositions_json for chunk ${record.id}: ${e instanceof Error ? e.message : e}. Content: ${record.propositions_json}`);
                }
                return {
                    id: record.id,
                    objectId: record.object_id,
                    notebookId: record.notebook_id,
                    chunkIdx: record.chunk_idx,
                    content: record.content,
                    summary: record.summary,
                    // Return potentially modified tagsJson/propositionsJson or the original
                    tagsJson: record.tags_json,
                    propositionsJson: record.propositions_json,
                    // These might eventually be derived *from* the safe parsing above
                    // For now, keep separate if needed elsewhere, but consider unifying
                    // safeTags: tags,
                    // safePropositions: propositions,
                    tokenCount: record.token_count,
                    createdAt: new Date(record.created_at),
                };
            });
        }
        catch (error) {
            // Avoid logging potentially large array of IDs in error message itself
            logger_1.logger.error(`[ChunkModel] Failed to fetch chunks for ${numericIds.length} IDs. First few: [${numericIds.slice(0, 5).join(', ')}...]`, error);
            throw new Error(`Database error fetching chunk details: ${error.message}`);
        }
    }
    /**
     * Assigns a chunk to a notebook.
     * @param chunkId - The ID of the chunk to assign.
     * @param notebookId - The ID of the notebook to assign the chunk to.
     * @returns Promise<boolean> - True if the update was successful, false otherwise.
     */
    async assignToNotebook(chunkId, notebookId) {
        const stmt = this.db.prepare(`
            UPDATE chunks
            SET notebook_id = @notebookId
            WHERE id = @chunkId
        `);
        try {
            const result = stmt.run({ chunkId, notebookId });
            if (result.changes > 0) {
                logger_1.logger.debug(`[ChunkSqlModel] Assigned chunk ${chunkId} to notebook ${notebookId}`);
                return true;
            }
            logger_1.logger.warn(`[ChunkSqlModel] No chunk found with ID ${chunkId} to assign to notebook, or notebook_id was already set to that value.`);
            return false;
        }
        catch (error) {
            logger_1.logger.error(`[ChunkSqlModel] Error assigning chunk ${chunkId} to notebook ${notebookId}:`, error);
            throw error;
        }
    }
    /**
     * Retrieves all chunks for a specific object.
     * @param objectId - The ID of the object.
     * @returns Array of ObjectChunk for the object.
     */
    getChunksByObjectId(objectId) {
        const stmt = this.db.prepare(`
            SELECT * FROM chunks
            WHERE object_id = ?
            ORDER BY chunk_idx ASC
        `);
        try {
            const records = stmt.all(objectId);
            logger_1.logger.debug(`[ChunkSqlModel] Found ${records.length} chunks for object ${objectId}.`);
            return records.map(mapRecordToChunk);
        }
        catch (error) {
            logger_1.logger.error(`[ChunkSqlModel] Failed to get chunks for object ${objectId}:`, error);
            throw error;
        }
    }
}
exports.ChunkSqlModel = ChunkSqlModel;
// Export a singleton instance
// export const chunkSqlModel = new ChunkSqlModel(); 
//# sourceMappingURL=ChunkModel.js.map