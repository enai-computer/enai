import { IpcMain } from 'electron';
import { ACTIVITY_LOG_ADD } from '../../shared/ipcChannels';
import { ActivityLogService } from '../../services/ActivityLogService';
import { ActivityLogPayload } from '../../shared/types';
import { logger } from '../../utils/logger';

/**
 * Registers the IPC handler for logging user activities.
 */
export function registerActivityLogHandler(ipcMain: IpcMain, activityLogService: ActivityLogService) {
  ipcMain.handle(ACTIVITY_LOG_ADD, async (_event, payload: ActivityLogPayload) => {
    try {
      logger.debug("[ActivityLogHandler] Logging activity:", { 
        type: payload.activityType,
        userId: payload.userId 
      });
      
      await activityLogService.logActivity(payload);
      
      // No need to return anything for logging
      return { success: true };
    } catch (error) {
      logger.error("[ActivityLogHandler] Error logging activity:", error);
      // Don't throw for activity logging - we don't want to break the UI
      // Just log the error and continue
      // Type assertion or type checking for error.message
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  });
  
  logger.info("[ActivityLogHandler] Activity log handler registered.");
}