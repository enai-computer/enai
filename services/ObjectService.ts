import { Database } from 'better-sqlite3';
import { ObjectModel } from '../models/ObjectModel';
import { ChunkSqlModel } from '../models/ChunkModel';
import { EmbeddingSqlModel } from '../models/EmbeddingModel';
import { IVectorStoreModel } from '../models/LanceVectorModel';
import { DeleteResult } from '../shared/types';
import { logger } from '../utils/logger';
import { BaseService } from './base/BaseService';

interface ObjectServiceDeps {
  db: Database;
  objectModel: ObjectModel;
  chunkModel: ChunkSqlModel;
  embeddingModel: EmbeddingSqlModel;
  vectorModel: IVectorStoreModel;
}

export class ObjectService extends BaseService<ObjectServiceDeps> {
  constructor(deps: ObjectServiceDeps) {
    super('ObjectService', deps);
  }

  /**
   * Delete objects and all their associated data (chunks, embeddings, vectors).
   * Follows the principle of SQLite as source of truth - deletes from SQLite first,
   * then attempts to clean up vectors from the vector store.
   */
  async deleteObjects(objectIds: string[]): Promise<DeleteResult> {
    return this.execute('deleteObjects', async () => {
    if (objectIds.length === 0) {
      return {
        successful: [],
        failed: [],
        notFound: [],
      };
    }

    // Deduplicate input IDs to avoid processing the same ID multiple times
    const uniqueIds = [...new Set(objectIds)];
    
    logger.info(`[ObjectService] Starting deletion of ${uniqueIds.length} unique objects (${objectIds.length} total requested)`);

    const result: DeleteResult = {
      successful: [],
      failed: [],
      notFound: [],
      orphanedChunkIds: [],
    };

    // Batch processing to handle large numbers of IDs
    const BATCH_SIZE = 500;
    
    for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
      const batch = uniqueIds.slice(i, i + BATCH_SIZE);
      const batchResult = await this.deleteBatch(batch);
      
      // Merge batch results
      result.successful.push(...batchResult.successful);
      result.failed.push(...batchResult.failed);
      result.notFound.push(...batchResult.notFound);
      result.orphanedChunkIds?.push(...(batchResult.orphanedChunkIds || []));
      
      // Keep the last error if any
      if (batchResult.vectorError) {
        result.vectorError = batchResult.vectorError;
      }
      if (batchResult.sqliteError) {
        result.sqliteError = batchResult.sqliteError;
      }
    }

      logger.info(`[ObjectService] Deletion complete. Successful: ${result.successful.length}, Failed: ${result.failed.length}, Not found: ${result.notFound.length}`);
      
      if (result.orphanedChunkIds && result.orphanedChunkIds.length > 0) {
        logger.warn(`[ObjectService] ${result.orphanedChunkIds.length} chunks remain orphaned in vector store`);
      }

      return result;
    });
  }

  private async deleteBatch(objectIds: string[]): Promise<DeleteResult> {
    const result: DeleteResult = {
      successful: [],
      failed: [],
      notFound: [],
      orphanedChunkIds: [],
    };

    // Step 1: Fetch chunk IDs before deletion (for vector store cleanup)
    let chunkIds: string[] = [];
    try {
      chunkIds = await this.deps.chunkModel.getChunkIdsByObjectIds(objectIds);
      logger.debug(`[ObjectService] Found ${chunkIds.length} chunks to delete for ${objectIds.length} objects`);
    } catch (error) {
      logger.error('[ObjectService] Failed to fetch chunk IDs:', error);
      // Continue anyway - we can still delete from SQLite
    }

    // Step 2: Delete from SQLite (transactional)
    try {
      const deleteTransaction = this.deps.db.transaction(() => {
        // Order matters: delete from tables with foreign keys first
        this.deps.embeddingModel.deleteByObjectIds(objectIds);
        this.deps.chunkModel.deleteByObjectIds(objectIds);
        
        // Delete the objects themselves and track results
        for (const id of objectIds) {
          try {
            const stmt = this.deps.db.prepare('DELETE FROM objects WHERE id = ?');
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

    // Step 3: Delete from vector store (only if SQLite succeeded and we have chunks)
    if (chunkIds.length > 0 && result.successful.length > 0) {
      try {
        await this.deps.vectorModel.deleteDocumentsByIds(chunkIds);
        logger.info(`[ObjectService] Successfully deleted ${chunkIds.length} vectors from vector store`);
      } catch (error) {
        logger.error('[ObjectService] Vector store deletion failed:', error);
        result.vectorError = error as Error;
        result.orphanedChunkIds = chunkIds;
        // This is non-fatal - data is already gone from SQLite
      }
    }

    return result;
  }

  /**
   * Delete an object by its source URI.
   * This is a convenience method that looks up the object by URI and then deletes it.
   * @param sourceUri - The source URI of the object to delete
   * @returns A DeleteResult indicating success/failure
   */
  async deleteObjectBySourceUri(sourceUri: string): Promise<DeleteResult> {
    return this.execute('deleteObjectBySourceUri', async () => {
      // First, look up the object by its source URI
      const object = await this.deps.objectModel.getBySourceUri(sourceUri);
      
      if (!object) {
        // No object found with this URI
        return {
          successful: [],
          failed: [],
          notFound: [sourceUri], // Use sourceUri since we don't have an ID
        };
      }
      
      // Delete the object using its ID
      return this.deleteObjects([object.id]);
    });
  }

  /**
   * Get the database instance (for testing or direct access).
   */
  getDatabase(): Database {
    return this.deps.db;
  }
}