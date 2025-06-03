import { IpcMain, IpcMainInvokeEvent } from 'electron';
import { OBJECT_GET_BY_ID } from '../../shared/ipcChannels';
import { ObjectModel } from '../../models/ObjectModel';
import { JeffersObject } from '../../shared/types';
import { logger } from '../../utils/logger';

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
}