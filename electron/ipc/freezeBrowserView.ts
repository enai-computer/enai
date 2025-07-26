import { IpcMain, IpcMainInvokeEvent } from 'electron';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { BROWSER_FREEZE_VIEW } from '../../shared/ipcChannels';
import { logger } from '../../utils/logger';

/**
 * Registers the handler for freezing a browser view.
 * This captures a snapshot of the current page and hides the WebContentsView.
 * 
 * @param ipcMain The IpcMain instance
 * @param classicBrowserService The ClassicBrowserService instance
 */
export function registerFreezeBrowserViewHandler(
  ipcMain: IpcMain,
  classicBrowserService: ClassicBrowserService
) {
  ipcMain.handle(BROWSER_FREEZE_VIEW, async (event: IpcMainInvokeEvent, windowId: string) => {
    try {
      logger.debug(`[FreezeBrowserView] Freezing view for windowId: ${windowId}`);
      
      // Call the service method to capture the view
      const snapshotResult = await classicBrowserService.captureSnapshot(windowId);
      
      if (snapshotResult) {
        logger.debug(`[FreezeBrowserView] Successfully froze view for windowId: ${windowId}`);
        return snapshotResult;
      } else {
        logger.warn(`[FreezeBrowserView] Failed to capture snapshot for windowId: ${windowId}`);
        return null;
      }
    } catch (error) {
      logger.error(`[FreezeBrowserView] Error freezing view for windowId ${windowId}:`, error);
      throw error;
    }
  });
}