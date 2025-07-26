import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { CLASSIC_BROWSER_GET_STATE } from '../../shared/ipcChannels';
import { ClassicBrowserStateService } from '../../services/browser/ClassicBrowserStateService';
import { logger } from '../../utils/logger';

export function registerClassicBrowserGetStateHandler(stateService: ClassicBrowserStateService) {
  ipcMain.handle(CLASSIC_BROWSER_GET_STATE, async (
    _event: IpcMainInvokeEvent,
    windowId: string
  ) => {
    logger.debug(`[ClassicBrowserGetState] Getting state for windowId: ${windowId}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('[ClassicBrowserGetState] Invalid windowId. Must be a non-empty string.');
      throw new Error('Invalid windowId. Must be a non-empty string.');
    }

    try {
      const state = stateService.getState(windowId);
      if (!state) {
        logger.warn(`[ClassicBrowserGetState] No state found for windowId: ${windowId}`);
        return null;
      }
      
      logger.debug(`[ClassicBrowserGetState] Found state for windowId: ${windowId}`);
      return state;
    } catch (err: any) {
      logger.error(`[ClassicBrowserGetState] Error:`, err.message || err);
      throw new Error(err.message || `Failed to get browser state for ${windowId}`);
    }
  });
}