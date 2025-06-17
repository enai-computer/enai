import { IpcMain, IpcMainInvokeEvent } from 'electron';
import { OBJECT_GET_BY_ID, OBJECT_DELETE } from '../../shared/ipcChannels';
import { ObjectModel } from '../../models/ObjectModel';
import { ObjectService } from '../../services/ObjectService';
import { JeffersObject, DeleteResult } from '../../shared/types';
import { logger } from '../../utils/logger';
import type { Database } from 'better-sqlite3';

export function registerObjectHandlers(ipcMain: IpcMain, objectModel: ObjectModel, objectService?: ObjectService) {
  // Get object by ID
  ipcMain.handle(OBJECT_GET_BY_ID, async (
    event: IpcMainInvokeEvent,
    objectId: string
  ): Promise<JeffersObject | null> => {
    try {
      logger.info(`[ObjectHandlers] Getting object by ID: ${objectId}`);
      const object = await objectModel.getById(objectId);
      
      if (!object) {
        logger.warn(`[ObjectHandlers] Object not found: ${objectId}`);
        return null;
      }
      
      logger.info(`[ObjectHandlers] Found object: ${object.title} (type: ${object.objectType})`);
      return object;
    } catch (error) {
      logger.error('[ObjectHandlers] Error getting object:', error);
      throw error;
    }
  });

  // Delete objects by IDs
  ipcMain.handle(OBJECT_DELETE, async (
    event: IpcMainInvokeEvent,
    objectIds: string[]
  ): Promise<DeleteResult> => {
    try {
      logger.info(`[ObjectHandlers] Deleting ${objectIds.length} objects`);
      
      if (objectService) {
        // Use provided service
        const result = await objectService.deleteObjects(objectIds);
        logger.info(`[ObjectHandlers] Deletion complete. Successful: ${result.successful.length}, Failed: ${result.failed.length}`);
        return result;
      } else {
        // Fallback to direct model operations
        logger.warn('[ObjectHandlers] ObjectService not available from registry, creating instance');
        const db = (objectModel as any).db as Database;
        const objectService = new ObjectService({
          db,
          objectModel,
          chunkModel: new (await import('../../models/ChunkModel')).ChunkSqlModel(db),
          embeddingModel: new (await import('../../models/EmbeddingModel')).EmbeddingSqlModel(db),
          chromaVectorModel: new (await import('../../models/ChromaVectorModel')).ChromaVectorModel()
        });
        
        // Perform deletion
        const result = await objectService.deleteObjects(objectIds);
        
        logger.info(`[ObjectHandlers] Deletion complete (fallback). Successful: ${result.successful.length}, Failed: ${result.failed.length}`);
        
        return result;
      }
    } catch (error) {
      logger.error('[ObjectHandlers] Error deleting objects:', error);
      throw error;
    }
  });
}