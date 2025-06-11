import { IpcMain, IpcMainInvokeEvent } from 'electron';
import { OBJECT_GET_BY_ID, OBJECT_DELETE } from '../../shared/ipcChannels';
import { ObjectModel } from '../../models/ObjectModel';
import { ObjectService } from '../../services/ObjectService';
import { JeffersObject, DeleteResult } from '../../shared/types';
import { logger } from '../../utils/logger';
import { Database } from 'better-sqlite3';

export function registerObjectHandlers(ipcMain: IpcMain, objectModel: ObjectModel) {
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
      
      // Get the database instance from the object model
      const db = (objectModel as any).db as Database;
      
      // Create ObjectService instance for this operation
      const objectService = new ObjectService(db);
      
      // Perform deletion
      const result = await objectService.deleteObjects(objectIds);
      
      logger.info(`[ObjectHandlers] Deletion complete. Successful: ${result.successful.length}, Failed: ${result.failed.length}`);
      
      return result;
    } catch (error) {
      logger.error('[ObjectHandlers] Error deleting objects:', error);
      throw error;
    }
  });
}