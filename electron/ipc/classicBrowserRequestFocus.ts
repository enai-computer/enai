import { ipcMain, IpcMainEvent } from 'electron';
import { CLASSIC_BROWSER_REQUEST_FOCUS } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { logger } from '../../utils/logger'; // Corrected logger path

export function registerClassicBrowserRequestFocusHandler(classicBrowserService: ClassicBrowserService) {
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
      const view = classicBrowserService.getView(windowId); // Assuming a method to get the view
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        view.webContents.focus();
        logger.debug(`[IPCClassicBrowserRequestFocus] Called webContents.focus() for windowId: ${windowId}`);
      } else {
        logger.warn(`[IPCClassicBrowserRequestFocus] No view or webContents found for windowId: ${windowId}`);
      }
    } catch (err: any) {
      logger.error(`[IPCClassicBrowserRequestFocus] Error:`, err.message || err);
    }
  });
} 