import { IpcMain } from 'electron';
import { UpdateService } from '../../services/UpdateService';
import { logger } from '../../utils/logger';
import {
  UPDATE_CHECK_FOR_UPDATES,
  UPDATE_DOWNLOAD,
  UPDATE_INSTALL,
  UPDATE_GET_STATUS
} from '../../shared/ipcChannels';

export function registerUpdateHandlers(
  ipcMain: IpcMain,
  updateService: UpdateService
): void {
  // Check for updates
  ipcMain.handle(UPDATE_CHECK_FOR_UPDATES, async () => {
    try {
      logger.debug('[UpdateHandler] Checking for updates...');
      const status = await updateService.checkForUpdates();
      return status;
    } catch (error) {
      logger.error('[UpdateHandler] Error checking for updates:', error);
      throw error;
    }
  });

  // Download update
  ipcMain.handle(UPDATE_DOWNLOAD, async () => {
    try {
      logger.debug('[UpdateHandler] Downloading update...');
      const result = await updateService.downloadUpdate();
      return result;
    } catch (error) {
      logger.error('[UpdateHandler] Error downloading update:', error);
      throw error;
    }
  });

  // Install update
  ipcMain.handle(UPDATE_INSTALL, async () => {
    try {
      logger.debug('[UpdateHandler] Installing update...');
      const result = await updateService.installUpdate();
      return result;
    } catch (error) {
      logger.error('[UpdateHandler] Error installing update:', error);
      throw error;
    }
  });

  // Get current status
  ipcMain.handle(UPDATE_GET_STATUS, async () => {
    try {
      logger.debug('[UpdateHandler] Getting update status...');
      const status = await updateService.getStatus();
      return status;
    } catch (error) {
      logger.error('[UpdateHandler] Error getting update status:', error);
      throw error;
    }
  });
}