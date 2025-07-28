import { ipcMain, IpcMainEvent } from 'electron';
import { WINDOW_LIFECYCLE_STATE_CHANGED } from '../../shared/ipcChannels';
import { WindowLifecycleService } from '../../services/browser/WindowLifecycleService';
import { logger } from '../../utils/logger';
import type { WindowMeta } from '../../shared/types/window.types';

export function registerWindowLifecycleHandler(windowLifecycleService: WindowLifecycleService) {
  ipcMain.on(WINDOW_LIFECYCLE_STATE_CHANGED, (
    _event: IpcMainEvent, 
    windows: WindowMeta[]
  ) => {
    try {
      logger.debug(`[WindowLifecycleHandler] Received window state changes for ${windows.length} windows`);
      windowLifecycleService.processWindowStateChanges(windows);
    } catch (error) {
      logger.error('[WindowLifecycleHandler] Error processing window state changes:', error);
    }
  });
}