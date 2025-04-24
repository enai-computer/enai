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
     * Adds a single chunk to the database.
     * @param data - Chunk data excluding id and created_at.
     * @returns The fully created ObjectChunk including generated fields.
     */
    addChunk(data) {
        var _a, _b, _c, _d;
        const stmt = this.db.prepare(`
            INSERT INTO chunks (object_id, chunk_idx, content, summary, tags_json, propositions_json, token_count)
            VALUES (@objectId, @chunkIdx, @content, @summary, @tagsJson, @propositionsJson, @tokenCount)
        `);
        try {
            const info = stmt.run({
                objectId: data.objectId,
                chunkIdx: data.chunkIdx,
                content: data.content,
                summary: (_a = data.summary) !== null && _a !== void 0 ? _a : null,
                tagsJson: (_b = data.tagsJson) !== null && _b !== void 0 ? _b : null,
                propositionsJson: (_c = data.propositionsJson) !== null && _c !== void 0 ? _c : null,
                tokenCount: (_d = data.tokenCount) !== null && _d !== void 0 ? _d : null,
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
     * Adds multiple chunks in a single transaction.
     * @param chunks - An array of chunk data excluding id and created_at.
     */
    addChunksBulk(chunks) {
        var _a, _b;
        if (chunks.length === 0)
            return;
        const insert = this.db.prepare(`
            INSERT INTO chunks (object_id, chunk_idx, content, summary, tags_json, propositions_json, token_count)
            VALUES (@objectId, @chunkIdx, @content, @summary, @tagsJson, @propositionsJson, @tokenCount)
        `);
        const runTransaction = this.db.transaction((chunkData) => {
            var _a, _b, _c, _d;
            for (const c of chunkData) {
                insert.run({
                    objectId: c.objectId,
                    chunkIdx: c.chunkIdx,
                    content: c.content,
                    summary: (_a = c.summary) !== null && _a !== void 0 ? _a : null,
                    tagsJson: (_b = c.tagsJson) !== null && _b !== void 0 ? _b : null,
                    propositionsJson: (_c = c.propositionsJson) !== null && _c !== void 0 ? _c : null,
                    tokenCount: (_d = c.tokenCount) !== null && _d !== void 0 ? _d : null,
                });
            }
        });
        try {
            runTransaction(chunks);
            logger_1.logger.debug(`[ChunkSqlModel] Bulk added ${chunks.length} chunks for object ${(_a = chunks[0]) === null || _a === void 0 ? void 0 : _a.objectId}`);
        }
        catch (error) {
            logger_1.logger.error(`[ChunkSqlModel] Failed to bulk add chunks for object ${(_b = chunks[0]) === null || _b === void 0 ? void 0 : _b.objectId}:`, error);
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
}
exports.ChunkSqlModel = ChunkSqlModel;
// Export a singleton instance
// export const chunkSqlModel = new ChunkSqlModel(); 
//# sourceMappingURL=ChunkSqlModel.js.map