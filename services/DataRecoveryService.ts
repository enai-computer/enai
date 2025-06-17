import { BaseService } from './base/BaseService';
import { ObjectModel } from '../models/ObjectModel';
import { ChunkSqlModel } from '../models/ChunkModel';
import { EmbeddingSqlModel } from '../models/EmbeddingModel';
import { IngestionJobModel } from '../models/IngestionJobModel';
import type { IVectorStoreModel } from '../models/ChromaVectorModel';
import type Database from 'better-sqlite3';
import { JeffersObject, ObjectStatus } from '../shared/types';

interface DataRecoveryServiceDeps {
  db: Database.Database;
  objectModel: ObjectModel;
  chunkSqlModel: ChunkSqlModel;
  embeddingSqlModel: EmbeddingSqlModel;
  ingestionJobModel: IngestionJobModel;
  vectorStore: IVectorStoreModel;
}

/**
 * Service responsible for detecting and recovering orphaned data
 * resulting from failed transactions or incomplete operations.
 */
export class DataRecoveryService extends BaseService<DataRecoveryServiceDeps> {
  constructor(deps: DataRecoveryServiceDeps) {
    super('DataRecoveryService', deps);
  }

  /**
   * Run a full data integrity check and recovery process
   */
  async performRecovery(): Promise<{
    orphanedChunks: number;
    orphanedEmbeddings: number;
    incompleteObjects: number;
    stuckJobs: number;
  }> {
    return this.execute('performRecovery', async () => {
      const results = {
        orphanedChunks: 0,
        orphanedEmbeddings: 0,
        incompleteObjects: 0,
        stuckJobs: 0,
      };

      // 1. Find and clean orphaned chunks (chunks without embeddings)
      results.orphanedChunks = await this.cleanOrphanedChunks();

      // 2. Find and clean orphaned embeddings (embeddings without valid chunks)
      results.orphanedEmbeddings = await this.cleanOrphanedEmbeddings();

      // 3. Find and fix incomplete objects (parsed but not embedded)
      results.incompleteObjects = await this.recoverIncompleteObjects();

      // 4. Find and reset stuck jobs
      results.stuckJobs = await this.resetStuckJobs();

      this.logInfo(`Recovery complete: ${JSON.stringify(results)}`);
      return results;
    });
  }

  /**
   * Find chunks that don't have corresponding embeddings
   * These are chunks that were created but the embedding process failed
   */
  private async cleanOrphanedChunks(): Promise<number> {
    const orphanedChunks = await this.deps.chunkSqlModel.listUnembedded(1000);
    
    if (orphanedChunks.length === 0) {
      this.logDebug('No orphaned chunks found');
      return 0;
    }

    this.logWarn(`Found ${orphanedChunks.length} orphaned chunks`);

    // Group by object ID to check object status
    const chunksByObject = new Map<string, typeof orphanedChunks>();
    for (const chunk of orphanedChunks) {
      if (!chunksByObject.has(chunk.objectId)) {
        chunksByObject.set(chunk.objectId, []);
      }
      chunksByObject.get(chunk.objectId)!.push(chunk);
    }

    let cleanedCount = 0;
    
    // Check each object's status
    for (const [objectId, chunks] of chunksByObject) {
      const object = await this.deps.objectModel.getById(objectId);
      
      if (!object) {
        // Object doesn't exist, delete orphaned chunks
        this.logWarn(`Deleting ${chunks.length} chunks for non-existent object ${objectId}`);
        const chunkIds = chunks.map(c => c.id);
        this.deps.chunkSqlModel.deleteByIds(chunkIds);
        cleanedCount += chunks.length;
      } else if (object.status === 'error' || object.status === 'embedding_failed') {
        // Object failed, clean up partial chunks
        this.logWarn(`Deleting ${chunks.length} chunks for failed object ${objectId}`);
        const chunkIds = chunks.map(c => c.id);
        this.deps.chunkSqlModel.deleteByIds(chunkIds);
        cleanedCount += chunks.length;
      } else if (object.status === 'embedded') {
        // Object claims to be embedded but chunks aren't - mark object for re-processing
        this.logWarn(`Object ${objectId} marked as embedded but has ${chunks.length} unembedded chunks`);
        await this.deps.objectModel.updateStatus(objectId, 'parsed');
      }
    }

    return cleanedCount;
  }

  /**
   * Find embeddings that reference non-existent chunks
   */
  private async cleanOrphanedEmbeddings(): Promise<number> {
    // This requires a custom query to find embeddings with invalid chunk_ids
    const stmt = this.deps.db.prepare(`
      SELECT e.* 
      FROM embeddings e
      LEFT JOIN chunks c ON e.chunk_id = c.id
      WHERE c.id IS NULL
      LIMIT 1000
    `);
    
    const orphanedEmbeddings = stmt.all();
    
    if (orphanedEmbeddings.length === 0) {
      this.logDebug('No orphaned embeddings found');
      return 0;
    }

    this.logWarn(`Found ${orphanedEmbeddings.length} orphaned embeddings`);

    // Delete orphaned embeddings and their vectors
    const vectorIds: string[] = [];
    const embeddingIds: number[] = [];
    
    for (const embedding of orphanedEmbeddings) {
      vectorIds.push(embedding.vector_id);
      embeddingIds.push(embedding.id);
    }

    // Delete from vector store (best effort)
    try {
      await this.deps.vectorStore.deleteDocumentsByIds(vectorIds);
      this.logInfo(`Deleted ${vectorIds.length} orphaned vectors from vector store`);
    } catch (error) {
      this.logError('Failed to delete orphaned vectors from vector store:', error);
    }

    // Delete from embeddings table
    if (embeddingIds.length > 0) {
      const placeholders = embeddingIds.map(() => '?').join(', ');
      const deleteStmt = this.deps.db.prepare(`DELETE FROM embeddings WHERE id IN (${placeholders})`);
      deleteStmt.run(...embeddingIds);
    }

    return orphanedEmbeddings.length;
  }

  /**
   * Find objects that are marked as 'parsed' but should be 'embedded'
   */
  private async recoverIncompleteObjects(): Promise<number> {
    // Find objects that have been parsed for more than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const stmt = this.deps.db.prepare(`
      SELECT * FROM objects 
      WHERE status = 'parsed' 
      AND parsed_at < ?
      LIMIT 100
    `);
    
    const incompleteObjects = stmt.all(oneHourAgo.toISOString()) as JeffersObject[];
    
    if (incompleteObjects.length === 0) {
      this.logDebug('No incomplete objects found');
      return 0;
    }

    this.logWarn(`Found ${incompleteObjects.length} incomplete objects`);

    let recoveredCount = 0;

    for (const obj of incompleteObjects) {
      // Check if object has chunks
      const chunks = await this.deps.chunkSqlModel.listByObjectId(obj.id);
      
      if (chunks.length === 0) {
        // No chunks, mark for re-processing
        this.logInfo(`Object ${obj.id} has no chunks, resetting to initial status`);
        await this.deps.objectModel.updateStatus(obj.id, 'initial' as ObjectStatus);
        recoveredCount++;
      } else {
        // Has chunks, check if they're embedded
        const unembeddedCount = chunks.filter(chunk => {
          const embedding = this.deps.embeddingSqlModel.findByChunkId(chunk.id);
          return !embedding;
        }).length;
        
        if (unembeddedCount === 0) {
          // All chunks are embedded, mark object as embedded
          this.logInfo(`Object ${obj.id} has all chunks embedded, updating status`);
          await this.deps.objectModel.updateStatus(obj.id, 'embedded');
          recoveredCount++;
        } else {
          this.logInfo(`Object ${obj.id} has ${unembeddedCount}/${chunks.length} unembedded chunks`);
          // Leave as parsed for ChunkingService to process
        }
      }
    }

    return recoveredCount;
  }

  /**
   * Find and reset jobs that have been stuck in processing states
   */
  private async resetStuckJobs(): Promise<number> {
    // Find jobs stuck in processing states for more than 30 minutes
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    
    const stmt = this.deps.db.prepare(`
      SELECT * FROM ingestion_jobs 
      WHERE status IN ('processing', 'vectorizing', 'parsing', 'cleaning', 'summarizing')
      AND updatedAt < ?
      LIMIT 100
    `);
    
    const stuckJobs = stmt.all(thirtyMinutesAgo);
    
    if (stuckJobs.length === 0) {
      this.logDebug('No stuck jobs found');
      return 0;
    }

    this.logWarn(`Found ${stuckJobs.length} stuck jobs`);

    // Reset stuck jobs for retry
    for (const job of stuckJobs) {
      await this.deps.ingestionJobModel.markAsRetryable(
        job.id,
        'Job was stuck in processing state for over 30 minutes',
        job.status,
        5000 // 5 second delay before retry
      );
    }

    return stuckJobs.length;
  }

  /**
   * Check data integrity without making changes
   */
  async checkIntegrity(): Promise<{
    orphanedChunks: number;
    orphanedEmbeddings: number;
    incompleteObjects: number;
    stuckJobs: number;
    inconsistentObjectChunkCounts: number;
  }> {
    return this.execute('checkIntegrity', async () => {
      const orphanedChunks = await this.deps.chunkSqlModel.listUnembedded(10000);
      
      const orphanedEmbeddingsStmt = this.deps.db.prepare(`
        SELECT COUNT(*) as count
        FROM embeddings e
        LEFT JOIN chunks c ON e.chunk_id = c.id
        WHERE c.id IS NULL
      `);
      const orphanedEmbeddingsCount = (orphanedEmbeddingsStmt.get() as any).count;

      const incompleteObjectsStmt = this.deps.db.prepare(`
        SELECT COUNT(*) as count
        FROM objects 
        WHERE status = 'parsed' 
        AND parsed_at < datetime('now', '-1 hour')
      `);
      const incompleteObjectsCount = (incompleteObjectsStmt.get() as any).count;

      const stuckJobsStmt = this.deps.db.prepare(`
        SELECT COUNT(*) as count
        FROM ingestion_jobs 
        WHERE status IN ('processing', 'vectorizing', 'parsing', 'cleaning', 'summarizing')
        AND updatedAt < ?
      `);
      const stuckJobsCount = (stuckJobsStmt.get(Date.now() - 30 * 60 * 1000) as any).count;

      // Check for objects with mismatched chunk counts
      const inconsistentStmt = this.deps.db.prepare(`
        SELECT COUNT(DISTINCT o.id) as count
        FROM objects o
        JOIN chunks c ON c.object_id = o.id
        LEFT JOIN embeddings e ON e.chunk_id = c.id
        WHERE o.status = 'embedded'
        GROUP BY o.id
        HAVING COUNT(c.id) != COUNT(e.id)
      `);
      const inconsistentCount = (inconsistentStmt.get() as any)?.count || 0;

      return {
        orphanedChunks: orphanedChunks.length,
        orphanedEmbeddings: orphanedEmbeddingsCount,
        incompleteObjects: incompleteObjectsCount,
        stuckJobs: stuckJobsCount,
        inconsistentObjectChunkCounts: inconsistentCount,
      };
    });
  }
}