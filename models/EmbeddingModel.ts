import Database from 'better-sqlite3'; // Import the Database type
// import getDb from './db'; // Remove unused import
import { logger } from '../utils/logger';
import { EmbeddingRecord } from '../shared/types'; // Assuming this type exists/will exist

// Define the structure returned by the database (snake_case)
interface DbEmbeddingRecord {
    id: number;
    chunk_id: number;
    model: string;
    vector_id: string;
    created_at: string;
}

// Helper to convert DB record (snake_case) to application object (camelCase)
function mapRecordToEmbedding(record: DbEmbeddingRecord): EmbeddingRecord {
    return {
        id: record.id,
        chunkId: record.chunk_id,
        model: record.model,
        vectorId: record.vector_id,
        createdAt: new Date(record.created_at),
    };
}

export class EmbeddingSqlModel {
    private db: Database.Database; // Add private db instance variable

    /**
     * Creates an instance of EmbeddingSqlModel.
     * @param dbInstance - An initialized better-sqlite3 database instance.
     */
    constructor(dbInstance: Database.Database) {
        this.db = dbInstance; // Store the passed DB instance
    }

    /**
     * Inserts a record indicating an embedding vector has been stored externally (e.g., Chroma).
     * Handles potential unique constraint violations on vector_id by returning the existing record.
     * @param data - Embedding metadata excluding id and created_at.
     * @returns The fully created or existing EmbeddingRecord.
     */
    addEmbeddingRecord(data: Omit<EmbeddingRecord, 'id' | 'createdAt'>): EmbeddingRecord {
        const stmt = this.db.prepare(`
            INSERT INTO embeddings (chunk_id, model, vector_id)
            VALUES (@chunkId, @model, @vectorId)
        `);

        try {
            const info = stmt.run({
                chunkId: data.chunkId,
                model: data.model,
                vectorId: data.vectorId,
            });

            const newId = info.lastInsertRowid as number;
            logger.debug(`[EmbeddingSqlModel] Added embedding record with ID: ${newId} for chunk ${data.chunkId}`);

            // Fetch and return the newly created record
            const newRecord = this.getById(newId);
            if (!newRecord) {
                throw new Error('Failed to retrieve newly created embedding record');
            }
            return newRecord;

        } catch (err: any) {
            // Handle UNIQUE constraint violation (likely on vector_id)
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                logger.warn(`[EmbeddingSqlModel] UNIQUE constraint violation for vector_id ${data.vectorId} (Chunk ID: ${data.chunkId}, Model: ${data.model}). Fetching existing.`);
                // Attempt to return the existing record matching the unique vector_id
                const existingRecord = this.findByVectorId(data.vectorId);
                if (existingRecord) {
                    return existingRecord;
                }
                // If fetching existing fails for some reason, re-throw original error
                logger.error(`[EmbeddingSqlModel] UNIQUE constraint hit, but failed to fetch existing record by vector_id ${data.vectorId}.`);
            }
            logger.error(`[EmbeddingSqlModel] Failed to add embedding record for chunk ${data.chunkId}:`, err);
            throw err; // Re-throw other errors
        }
    }

    /**
     * Finds an embedding record by its primary key ID.
     * @param id The primary key ID.
     * @returns The EmbeddingRecord or null if not found.
     */
    getById(id: number): EmbeddingRecord | null {
        const stmt = this.db.prepare('SELECT * FROM embeddings WHERE id = ?');
        try {
            const record = stmt.get(id) as DbEmbeddingRecord | undefined;
            return record ? mapRecordToEmbedding(record) : null;
        } catch (error) {
            logger.error(`[EmbeddingSqlModel] Failed to get embedding record by ID ${id}:`, error);
            throw error;
        }
    }

    /**
     * Finds an embedding record by the associated chunk ID.
     * @param chunkId The ID of the chunk.
     * @returns The EmbeddingRecord or null if not found.
     */
    findByChunkId(chunkId: number): EmbeddingRecord | null {
        const stmt = this.db.prepare('SELECT * FROM embeddings WHERE chunk_id = ?');
        try {
            const record = stmt.get(chunkId) as DbEmbeddingRecord | undefined;
            return record ? mapRecordToEmbedding(record) : null;
        } catch (error) {
            logger.error(`[EmbeddingSqlModel] Failed to find embedding record by chunk ID ${chunkId}:`, error);
            throw error;
        }
    }

    /**
     * Finds an embedding record by the unique vector ID (e.g., Chroma ID).
     * @param vectorId The unique ID of the vector in the external store.
     * @returns The EmbeddingRecord or null if not found.
     */
    findByVectorId(vectorId: string): EmbeddingRecord | null {
        const stmt = this.db.prepare('SELECT * FROM embeddings WHERE vector_id = ?');
        try {
            const record = stmt.get(vectorId) as DbEmbeddingRecord | undefined;
            return record ? mapRecordToEmbedding(record) : null;
        } catch (error) {
            logger.error(`[EmbeddingSqlModel] Failed to find embedding record by vector ID ${vectorId}:`, error);
            throw error;
        }
    }

    /**
     * Danger-zone: Deletes the embedding record from *this database only*.
     * Does NOT affect the vector stored externally (e.g., in Chroma).
     * Coordination must happen at the service layer.
     * @param id The primary key ID of the embedding record to delete.
     * @returns Promise<void>
     */
    deleteById(id: number): void {
        const stmt = this.db.prepare('DELETE FROM embeddings WHERE id = ?');
        try {
            const info = stmt.run(id);
            if (info.changes > 0) {
                logger.debug(`[EmbeddingSqlModel] Deleted embedding record with ID: ${id}`);
            } else {
                logger.warn(`[EmbeddingSqlModel] Attempted to delete non-existent embedding record ID ${id}`);
            }
        } catch (error) {
            logger.error(`[EmbeddingSqlModel] Failed to delete embedding record by ID ${id}:`, error);
            throw error;
        }
    }

    // Delete by Chunk ID might also be useful, but keep the same warning.
    /**
     * Danger-zone: Deletes embedding records by chunk ID from *this database only*.
     * Does NOT affect vectors stored externally (e.g., in Chroma).
     * @param chunkId The ID of the chunk whose embedding records should be deleted.
     * @returns Promise<void>
     */
    deleteByChunkId(chunkId: number): void {
        const stmt = this.db.prepare('DELETE FROM embeddings WHERE chunk_id = ?');
        try {
            const info = stmt.run(chunkId);
            if (info.changes > 0) {
                logger.debug(`[EmbeddingSqlModel] Deleted ${info.changes} embedding record(s) for chunk ID: ${chunkId}`);
            } else {
                // Not necessarily a warning, could just mean no embeddings existed for this chunk
                 logger.debug(`[EmbeddingSqlModel] No embedding records found to delete for chunk ID ${chunkId}`);
            }
        } catch (error) {
            logger.error(`[EmbeddingSqlModel] Failed to delete embedding records by chunk ID ${chunkId}:`, error);
            throw error;
        }
    }

    /**
     * Delete all embeddings associated with the given object IDs.
     * This should be called within a transaction from the service layer.
     * Handles batching for large numbers of object IDs.
     * Does NOT affect vectors stored externally (e.g., in Chroma).
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
            
            // Delete embeddings that belong to chunks of these objects
            const stmt = this.db.prepare(`
                DELETE FROM embeddings 
                WHERE chunk_id IN (
                    SELECT id FROM chunks WHERE object_id IN (${placeholders})
                )
            `);

            try {
                const result = stmt.run(...batch);
                totalDeleted += result.changes;
                logger.debug(`[EmbeddingSqlModel] Deleted ${result.changes} embeddings for batch of ${batch.length} objects`);
            } catch (error) {
                logger.error('[EmbeddingSqlModel] Failed to delete embeddings by object IDs:', error);
                throw error;
            }
        }

        logger.info(`[EmbeddingSqlModel] Deleted ${totalDeleted} total embeddings for ${objectIds.length} objects`);
    }

    /**
     * Get the database instance for transaction management.
     * Used by services to coordinate transactions across models.
     */
    getDatabase(): Database.Database {
        return this.db;
    }
} 