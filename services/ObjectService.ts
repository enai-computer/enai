import { Database } from 'better-sqlite3';
import { ObjectModel } from '../models/ObjectModel';
import { ChunkSqlModel } from '../models/ChunkModel';
import { EmbeddingSqlModel } from '../models/EmbeddingModel';
import { ChromaVectorModel } from '../models/ChromaVectorModel';
import { DeleteResult } from '../shared/types';
import { logger } from '../utils/logger';

export class ObjectService {
  private objectModel: ObjectModel;
  private chunkModel: ChunkSqlModel;
  private embeddingModel: EmbeddingSqlModel;
  private chromaVectorModel: ChromaVectorModel;
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.objectModel = new ObjectModel(db);
    this.chunkModel = new ChunkSqlModel(db);
    this.embeddingModel = new EmbeddingSqlModel(db);
    this.chromaVectorModel = new ChromaVectorModel();
    logger.info('[ObjectService] Initialized.');
  }

  /**
   * Delete objects and all their associated data (chunks, embeddings, vectors).
   * Follows the principle of SQLite as source of truth - deletes from SQLite first,
   * then attempts to clean up vectors from ChromaDB.
   */
  async deleteObjects(objectIds: string[]): Promise<DeleteResult> {
    if (objectIds.length === 0) {
      return {
        successful: [],
        failed: [],
        notFound: [],
      };
    }

    logger.info(`[ObjectService] Starting deletion of ${objectIds.length} objects`);

    const result: DeleteResult = {
      successful: [],
      failed: [],
      notFound: [],
      orphanedChunkIds: [],
    };

    // Batch processing to handle large numbers of IDs
    const BATCH_SIZE = 500;
    
    for (let i = 0; i < objectIds.length; i += BATCH_SIZE) {
      const batch = objectIds.slice(i, i + BATCH_SIZE);
      const batchResult = await this.deleteBatch(batch);
      
      // Merge batch results
      result.successful.push(...batchResult.successful);
      result.failed.push(...batchResult.failed);
      result.notFound.push(...batchResult.notFound);
      result.orphanedChunkIds?.push(...(batchResult.orphanedChunkIds || []));
      
      // Keep the last error if any
      if (batchResult.chromaDbError) {
        result.chromaDbError = batchResult.chromaDbError;
      }
      if (batchResult.sqliteError) {
        result.sqliteError = batchResult.sqliteError;
      }
    }

    logger.info(`[ObjectService] Deletion complete. Successful: ${result.successful.length}, Failed: ${result.failed.length}, Not found: ${result.notFound.length}`);
    
    if (result.orphanedChunkIds && result.orphanedChunkIds.length > 0) {
      logger.warn(`[ObjectService] ${result.orphanedChunkIds.length} chunks remain orphaned in ChromaDB`);
    }

    return result;
  }

  private async deleteBatch(objectIds: string[]): Promise<DeleteResult> {
    const result: DeleteResult = {
      successful: [],
      failed: [],
      notFound: [],
      orphanedChunkIds: [],
    };

    // Step 1: Fetch chunk IDs before deletion (for ChromaDB cleanup)
    let chunkIds: string[] = [];
    try {
      chunkIds = await this.chunkModel.getChunkIdsByObjectIds(objectIds);
      logger.debug(`[ObjectService] Found ${chunkIds.length} chunks to delete for ${objectIds.length} objects`);
    } catch (error) {
      logger.error('[ObjectService] Failed to fetch chunk IDs:', error);
      // Continue anyway - we can still delete from SQLite
    }

    // Step 2: Delete from SQLite (transactional)
    try {
      const deleteTransaction = this.db.transaction(() => {
        // Order matters: delete from tables with foreign keys first
        this.embeddingModel.deleteByObjectIds(objectIds);
        this.chunkModel.deleteByObjectIds(objectIds);
        
        // Delete the objects themselves and track results
        for (const id of objectIds) {
          try {
            const stmt = this.db.prepare('DELETE FROM objects WHERE id = ?');
            const info = stmt.run(id);
            if (info.changes > 0) {
              result.successful.push(id);
            } else {
              result.notFound.push(id);
            }
          } catch (error) {
            logger.error(`[ObjectService] Failed to delete object ${id}:`, error);
            throw error; // Re-throw to rollback transaction
          }
        }
      });

      deleteTransaction();
      logger.info(`[ObjectService] Successfully deleted ${result.successful.length} objects from SQLite, ${result.notFound.length} not found`);

    } catch (error) {
      logger.error('[ObjectService] SQLite deletion failed:', error);
      result.sqliteError = error as Error;
      result.failed = objectIds; // All IDs failed if transaction failed
      result.successful = []; // Clear any successful ones since transaction rolled back
      result.notFound = []; // Clear not found since transaction rolled back
      // Don't proceed to ChromaDB if SQLite failed
      return result;
    }

    // Step 3: Delete from ChromaDB (only if SQLite succeeded and we have chunks)
    if (chunkIds.length > 0 && result.successful.length > 0) {
      try {
        await this.chromaVectorModel.deleteDocumentsByIds(chunkIds);
        logger.info(`[ObjectService] Successfully deleted ${chunkIds.length} vectors from ChromaDB`);
      } catch (error) {
        logger.error('[ObjectService] ChromaDB deletion failed:', error);
        result.chromaDbError = error as Error;
        result.orphanedChunkIds = chunkIds;
        // This is non-fatal - data is already gone from SQLite
      }
    }

    return result;
  }

  /**
   * Get the database instance (for testing or direct access).
   */
  getDatabase(): Database {
    return this.db;
  }
}