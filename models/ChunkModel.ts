import Database from 'better-sqlite3'; // Import the Database type
// import getDb from './db'; // Remove unused import
import { logger } from '../utils/logger';
import { ObjectChunk } from '../shared/types'; // Assuming this type exists/will exist

// Define the structure returned by the database (snake_case)
interface ChunkRecord {
    id: number;
    object_id: string;
    notebook_id: string | null;
    chunk_idx: number;
    content: string;
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

// Type for data needed to create a chunk (SQL layer)
export type ChunkData = Omit<ObjectChunk, 'id' | 'createdAt'> & { objectId: string, notebookId?: string | null };

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
     * Creates a new chunk record in the database.
     * @param data - The chunk data, including objectId.
     * @returns Promise resolving to the fully created ObjectChunk including generated ID and createdAt.
     */
    async addChunk(data: ChunkData): Promise<ObjectChunk> {
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
     * Creates a new chunk record in the database synchronously.
     * For use within transactions where async operations are not allowed.
     * @param data - The chunk data, including objectId.
     * @returns The created ObjectChunk including generated ID and createdAt.
     */
    addChunkSync(data: ChunkData): ObjectChunk {
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

            const newId = info.lastInsertRowid as number;
            logger.debug(`[ChunkSqlModel] Added chunk synchronously with ID: ${newId} for object ${data.objectId}`);

            // getById is already synchronous, so we can use it directly
            const newRecord = this.getById(newId);
            if (!newRecord) {
                // Should not happen if insert succeeded
                throw new Error('Failed to retrieve newly created chunk');
            }
            return newRecord;

        } catch (error) {
            logger.error(`[ChunkSqlModel] Failed to add chunk synchronously for object ${data.objectId}, index ${data.chunkIdx}:`, error);
            throw error;
        }
    }

    /**
     * Adds multiple chunks in a single transaction.
     * @param chunks - An array of chunk data to insert.
     * @returns Promise resolving to an array of the created ObjectChunk IDs.
     */
    async addChunksBulk(chunks: ChunkData[]): Promise<number[]> {
        if (chunks.length === 0) return [];

        const insertStmt = this.db.prepare(`
            INSERT INTO chunks (object_id, notebook_id, chunk_idx, content, summary, tags_json, propositions_json, token_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const now = new Date().toISOString();
        const insertedIds: number[] = [];

        const insertMany = this.db.transaction((chunkBatch: ChunkData[]) => {
            for (const c of chunkBatch) {
                const info = insertStmt.run(
                    c.objectId,
                    c.notebookId ?? null,
                    c.chunkIdx,
                    c.content,
                    c.summary ?? null,
                    c.tagsJson ?? null,
                    c.propositionsJson ?? null,
                    c.tokenCount ?? null,
                    now
                );
                insertedIds.push(info.lastInsertRowid as number);
            }
        });

        try {
            const result = await insertMany(chunks);
            logger.debug(`[ChunkSqlModel] Bulk added ${insertedIds.length} chunks for object ${chunks[0]?.objectId}`);
            return insertedIds;
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

    /**
     * Retrieves all chunks associated with a specific notebook ID.
     * @param notebookId - The UUID of the parent notebook.
     * @returns An array of ObjectChunk ordered by chunk index.
     */
    async listByNotebookId(notebookId: string): Promise<ObjectChunk[]> {
        const stmt = this.db.prepare('SELECT * FROM chunks WHERE notebook_id = ? ORDER BY chunk_idx ASC');
        try {
            const records = stmt.all(notebookId) as ChunkRecord[];
            logger.debug(`[ChunkSqlModel] Found ${records.length} chunks for notebook ${notebookId}.`);
            return records.map(mapRecordToChunk);
        } catch (error) {
            logger.error(`[ChunkSqlModel] Failed to list chunks for notebook ${notebookId}:`, error);
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
    getChunksByIds(chunkIds: string[]): ObjectChunk[] {
        if (!chunkIds || chunkIds.length === 0) {
            return [];
        }

        const numericIds: number[] = [];
        const invalidIds: string[] = [];

        // Validate and convert IDs to numbers
        for (const idStr of chunkIds) {
            const idNum = Number(idStr);
            if (!isNaN(idNum) && Number.isInteger(idNum)) {
                numericIds.push(idNum);
            } else {
                invalidIds.push(idStr);
            }
        }

        if (invalidIds.length > 0) {
            logger.warn(`[ChunkModel] getChunksByIds received invalid non-numeric IDs: [${invalidIds.join(', ')}]`);
        }

        if (numericIds.length === 0) {
            logger.warn('[ChunkModel] getChunksByIds called with no valid numeric IDs.');
            return [];
        }

        // Create placeholders: (?, ?, ?)
        const placeholders = numericIds.map(() => '?').join(', ');
        const query = `SELECT * FROM chunks WHERE id IN (${placeholders})`;

        try {
            logger.debug(`[ChunkModel] Fetching chunks for ${numericIds.length} valid IDs: [${numericIds.slice(0, 5).join(', ')}...]`);
            const stmt = this.db.prepare(query);
            const rows = stmt.all(numericIds) as ChunkRecord[]; // Use validated numeric IDs

            logger.debug(`[ChunkModel] Found ${rows.length} chunks for ${numericIds.length} provided valid IDs.`);

            // Map results with safe JSON parsing
            return rows.map(record => {
                let tags: string[] = [];
                let propositions: string[] = [];

                try {
                    if (record.tags_json) {
                        // Basic validation: check if it looks like JSON before parsing
                        if (record.tags_json.trim().startsWith('[') && record.tags_json.trim().endsWith(']')) {
                             tags = JSON.parse(record.tags_json);
                        } else {
                            logger.warn(`[ChunkModel] Chunk ${record.id} has invalid tags_json (not an array): ${record.tags_json}`);
                        }
                    }
                } catch (e) {
                    logger.warn(`[ChunkModel] Failed to parse tags_json for chunk ${record.id}: ${e instanceof Error ? e.message : e}. Content: ${record.tags_json}`);
                }

                try {
                     if (record.propositions_json) {
                        if (record.propositions_json.trim().startsWith('[') && record.propositions_json.trim().endsWith(']')) {
                             propositions = JSON.parse(record.propositions_json);
                        } else {
                            logger.warn(`[ChunkModel] Chunk ${record.id} has invalid propositions_json (not an array): ${record.propositions_json}`);
                        }
                     }
                } catch (e) {
                    logger.warn(`[ChunkModel] Failed to parse propositions_json for chunk ${record.id}: ${e instanceof Error ? e.message : e}. Content: ${record.propositions_json}`);
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

        } catch (error: any) {
            // Avoid logging potentially large array of IDs in error message itself
            logger.error(`[ChunkModel] Failed to fetch chunks for ${numericIds.length} IDs. First few: [${numericIds.slice(0, 5).join(', ')}...]`, error);
            throw new Error(`Database error fetching chunk details: ${error.message}`);
        }
    }

    /**
     * Assigns a chunk to a notebook.
     * @param chunkId - The ID of the chunk to assign.
     * @param notebookId - The ID of the notebook to assign the chunk to.
     * @returns Promise<boolean> - True if the update was successful, false otherwise.
     */
    async assignToNotebook(chunkId: number, notebookId: string | null): Promise<boolean> {
        const stmt = this.db.prepare(`
            UPDATE chunks
            SET notebook_id = @notebookId
            WHERE id = @chunkId
        `);
        try {
            const result = stmt.run({ chunkId, notebookId });
            if (result.changes > 0) {
                logger.debug(`[ChunkSqlModel] Assigned chunk ${chunkId} to notebook ${notebookId}`);
                return true;
            }
            logger.warn(`[ChunkSqlModel] No chunk found with ID ${chunkId} to assign to notebook, or notebook_id was already set to that value.`);
            return false;
        } catch (error) {
            logger.error(`[ChunkSqlModel] Error assigning chunk ${chunkId} to notebook ${notebookId}:`, error);
            throw error;
        }
    }

    /**
     * Retrieves all chunks for a specific object.
     * @param objectId - The ID of the object.
     * @returns Array of ObjectChunk for the object.
     */
    getChunksByObjectId(objectId: string): ObjectChunk[] {
        const stmt = this.db.prepare(`
            SELECT * FROM chunks
            WHERE object_id = ?
            ORDER BY chunk_idx ASC
        `);

        try {
            const records = stmt.all(objectId) as ChunkRecord[];
            logger.debug(`[ChunkSqlModel] Found ${records.length} chunks for object ${objectId}.`);
            return records.map(mapRecordToChunk);
        } catch (error) {
            logger.error(`[ChunkSqlModel] Failed to get chunks for object ${objectId}:`, error);
            throw error;
        }
    }

    /**
     * Get all chunk IDs associated with the given object IDs.
     * Used before deletion to identify vectors in ChromaDB.
     * Handles batching for large numbers of object IDs.
     */
    async getChunkIdsByObjectIds(objectIds: string[]): Promise<string[]> {
        if (objectIds.length === 0) {
            return [];
        }

        const BATCH_SIZE = 500; // Safe under SQL variable limit
        const allChunkIds: string[] = [];

        for (let i = 0; i < objectIds.length; i += BATCH_SIZE) {
            const batch = objectIds.slice(i, i + BATCH_SIZE);
            const placeholders = batch.map(() => '?').join(', ');
            const query = `SELECT id FROM chunks WHERE object_id IN (${placeholders})`;

            try {
                const stmt = this.db.prepare(query);
                const rows = stmt.all(...batch) as { id: number }[];
                const chunkIds = rows.map(row => row.id.toString());
                allChunkIds.push(...chunkIds);
                
                logger.debug(`[ChunkSqlModel] Found ${chunkIds.length} chunks for batch of ${batch.length} objects`);
            } catch (error) {
                logger.error('[ChunkSqlModel] Failed to get chunk IDs by object IDs:', error);
                throw error;
            }
        }

        logger.info(`[ChunkSqlModel] Found ${allChunkIds.length} total chunks for ${objectIds.length} objects`);
        return allChunkIds;
    }

    /**
     * Delete all chunks associated with the given object IDs.
     * This should be called within a transaction from the service layer.
     * Handles batching for large numbers of object IDs.
     */
    deleteByObjectIds(objectIds: string[]): void {
        if (objectIds.length === 0) {
            return;
        }

        const BATCH_SIZE = 500; // Safe under SQL variable limit
        let totalDeleted = 0;

        for (let i = 0; i < objectIds.length; i += BATCH_SIZE) {
            const batch = objectIds.slice(i, i + BATCH_SIZE);
            const placeholders = batch.map(() => '?').join(', ');
            const stmt = this.db.prepare(`DELETE FROM chunks WHERE object_id IN (${placeholders})`);

            try {
                const result = stmt.run(...batch);
                totalDeleted += result.changes;
                logger.debug(`[ChunkSqlModel] Deleted ${result.changes} chunks for batch of ${batch.length} objects`);
            } catch (error) {
                logger.error('[ChunkSqlModel] Failed to delete chunks by object IDs:', error);
                throw error;
            }
        }

        logger.info(`[ChunkSqlModel] Deleted ${totalDeleted} total chunks for ${objectIds.length} objects`);
    }

    /**
     * Get the database instance for transaction management.
     * Used by services to coordinate transactions across models.
     */
    getDatabase(): Database.Database {
        return this.db;
    }
}

// Export a singleton instance
// export const chunkSqlModel = new ChunkSqlModel(); 