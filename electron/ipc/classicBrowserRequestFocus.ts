import { ipcMain, IpcMainEvent } from 'electron';
import { CLASSIC_BROWSER_REQUEST_FOCUS } from '../../shared/ipcChannels';
import { ClassicBrowserViewManager } from '../../services/browser/ClassicBrowserViewManager';
import { ClassicBrowserStateService } from '../../services/browser/ClassicBrowserStateService';
import { logger } from '../../utils/logger'; // Corrected logger path

export function registerClassicBrowserRequestFocusHandler(viewManager: ClassicBrowserViewManager, stateService: ClassicBrowserStateService) {
  ipcMain.on(CLASSIC_BROWSER_REQUEST_FOCUS, (
    _event: IpcMainEvent, 
    windowId: string
  ) => {
    logger.debug(`[IPCClassicBrowserRequestFocus] Received request to focus windowId: ${windowId}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('[IPCClassicBrowserRequestFocus] Invalid windowId provided.');
      return;
    }

    try {
      const activeTabId = stateService.getState(windowId)?.activeTabId;
      if (activeTabId) {
        const view = viewManager.getView(activeTabId);
        if (view && view.webContents && !view.webContents.isDestroyed()) {
          view.webContents.focus();
          logger.debug(`[IPCClassicBrowserRequestFocus] Called webContents.focus() for windowId: ${windowId}`);
        } else {
          logger.warn(`[IPCClassicBrowserRequestFocus] No view or webContents found for windowId: ${windowId}`);
        }
      }
    } catch (err: any) {
      logger.error(`[IPCClassicBrowserRequestFocus] Error:`, err.message || err);
    }
  });
} 