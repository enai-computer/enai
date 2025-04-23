import Database from 'better-sqlite3'; // Import the Database type
// import getDb from './db'; // Remove unused import
import { logger } from '../utils/logger';
import { ObjectChunk } from '../shared/types'; // Assuming this type exists/will exist

// Define the structure returned by the database (snake_case)
interface ChunkRecord {
    id: number;
    object_id: string;
    chunk_idx: number;
    text: string;
    summary: string | null;
    tags_json: string | null;
    propositions_json: string | null;
    token_count: number | null;
    created_at: string;
}

// Helper to convert DB record (snake_case) to application object (camelCase)
function mapRecordToChunk(record: ChunkRecord): ObjectChunk {
    return {
        id: record.id,
        objectId: record.object_id,
        chunkIdx: record.chunk_idx,
        text: record.text,
        summary: record.summary,
        tagsJson: record.tags_json,
        propositionsJson: record.propositions_json,
        tokenCount: record.token_count,
        createdAt: new Date(record.created_at),
    };
}

export class ChunkSqlModel {
    private db: Database.Database; // Add private db instance variable

    /**
     * Creates an instance of ChunkSqlModel.
     * @param dbInstance - An initialized better-sqlite3 database instance.
     */
    constructor(dbInstance: Database.Database) {
        this.db = dbInstance; // Store the passed DB instance
    }

    /**
     * Adds a single chunk to the database.
     * @param data - Chunk data excluding id and created_at.
     * @returns The fully created ObjectChunk including generated fields.
     */
    addChunk(data: Omit<ObjectChunk, 'id' | 'createdAt'>): ObjectChunk {
        const stmt = this.db.prepare(`
            INSERT INTO chunks (object_id, chunk_idx, text, summary, tags_json, propositions_json, token_count)
            VALUES (@objectId, @chunkIdx, @text, @summary, @tagsJson, @propositionsJson, @tokenCount)
        `);

        try {
            const info = stmt.run({
                objectId: data.objectId,
                chunkIdx: data.chunkIdx,
                text: data.text,
                summary: data.summary ?? null,
                tagsJson: data.tagsJson ?? null,
                propositionsJson: data.propositionsJson ?? null,
                tokenCount: data.tokenCount ?? null,
            });

            const newId = info.lastInsertRowid as number;
            logger.debug(`[ChunkSqlModel] Added chunk with ID: ${newId} for object ${data.objectId}`);

            // Fetch and return the newly created chunk
            const newRecord = this.getById(newId);
            if (!newRecord) {
                // Should not happen if insert succeeded
                throw new Error('Failed to retrieve newly created chunk');
            }
            return newRecord;

        } catch (error) {
            logger.error(`[ChunkSqlModel] Failed to add chunk for object ${data.objectId}, index ${data.chunkIdx}:`, error);
            throw error;
        }
    }

    /**
     * Adds multiple chunks in a single transaction.
     * @param chunks - An array of chunk data excluding id and created_at.
     */
    addChunksBulk(chunks: Omit<ObjectChunk, 'id' | 'createdAt'>[]): void {
        if (chunks.length === 0) return;

        const insert = this.db.prepare(`
            INSERT INTO chunks (object_id, chunk_idx, text, summary, tags_json, propositions_json, token_count)
            VALUES (@objectId, @chunkIdx, @text, @summary, @tagsJson, @propositionsJson, @tokenCount)
        `);

        const runTransaction = this.db.transaction((chunkData: typeof chunks) => {
            for (const c of chunkData) {
                insert.run({
                    objectId: c.objectId,
                    chunkIdx: c.chunkIdx,
                    text: c.text,
                    summary: c.summary ?? null,
                    tagsJson: c.tagsJson ?? null,
                    propositionsJson: c.propositionsJson ?? null,
                    tokenCount: c.tokenCount ?? null,
                });
            }
        });

        try {
            runTransaction(chunks);
            logger.debug(`[ChunkSqlModel] Bulk added ${chunks.length} chunks for object ${chunks[0]?.objectId}`);
        } catch (error) {
            logger.error(`[ChunkSqlModel] Failed to bulk add chunks for object ${chunks[0]?.objectId}:`, error);
            throw error;
        }
    }

    /**
     * Retrieves chunks that do not yet have an associated embedding record.
     * @param limit - Maximum number of chunks to retrieve.
     * @returns An array of ObjectChunk that need embedding.
     */
    listUnembedded(limit = 100): ObjectChunk[] {
        const stmt = this.db.prepare(`
            SELECT c.*
            FROM chunks c
            LEFT JOIN embeddings e ON e.chunk_id = c.id
            WHERE e.id IS NULL
            ORDER BY c.object_id, c.chunk_idx -- Consistent ordering
            LIMIT ?
        `);

        try {
            const records = stmt.all(limit) as ChunkRecord[];
            logger.debug(`[ChunkSqlModel] Found ${records.length} unembedded chunks.`);
            return records.map(mapRecordToChunk);
        } catch (error) {
            logger.error('[ChunkSqlModel] Failed to list unembedded chunks:', error);
            throw error;
        }
    }

    /**
     * Retrieves a single chunk by its ID.
     * @param id - The primary key ID of the chunk.
     * @returns The ObjectChunk or null if not found.
     */
    getById(id: number): ObjectChunk | null {
        const stmt = this.db.prepare('SELECT * FROM chunks WHERE id = ?');
        try {
            const record = stmt.get(id) as ChunkRecord | undefined;
            return record ? mapRecordToChunk(record) : null;
        } catch (error) {
            logger.error(`[ChunkSqlModel] Failed to get chunk by ID ${id}:`, error);
            throw error;
        }
    }

    /**
     * Retrieves all chunks associated with a specific object ID.
     * @param objectId - The UUID of the parent object.
     * @returns An array of ObjectChunk ordered by chunk index.
     */
    listByObjectId(objectId: string): ObjectChunk[] {
        const stmt = this.db.prepare('SELECT * FROM chunks WHERE object_id = ? ORDER BY chunk_idx ASC');
        try {
            const records = stmt.all(objectId) as ChunkRecord[];
            logger.debug(`[ChunkSqlModel] Found ${records.length} chunks for object ${objectId}.`);
            return records.map(mapRecordToChunk);
        } catch (error) {
            logger.error(`[ChunkSqlModel] Failed to list chunks for object ${objectId}:`, error);
            throw error;
        }
    }

    // TODO: Add delete methods if needed (e.g., deleteByObjectId)
}

// Export a singleton instance
// export const chunkSqlModel = new ChunkSqlModel(); 