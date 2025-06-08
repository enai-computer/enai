import { IpcMain, IpcMainInvokeEvent } from 'electron';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';
import { BROWSER_UNFREEZE_VIEW } from '../../shared/ipcChannels';
import { logger } from '../../utils/logger';

/**
 * Registers the handler for unfreezing a browser view.
 * This shows the WebContentsView and removes any stored snapshot.
 * 
 * @param ipcMain The IpcMain instance
 * @param classicBrowserService The ClassicBrowserService instance
 */
export function registerUnfreezeBrowserViewHandler(
  ipcMain: IpcMain,
  classicBrowserService: ClassicBrowserService
) {
  ipcMain.handle(BROWSER_UNFREEZE_VIEW, async (event: IpcMainInvokeEvent, windowId: string) => {
    try {
      logger.debug(`[UnfreezeBrowserView] Unfreezing view for windowId: ${windowId}`);
      
      // Call the service method to show and focus the view
      await classicBrowserService.showAndFocusView(windowId);
      
      logger.debug(`[UnfreezeBrowserView] Successfully unfroze view for windowId: ${windowId}`);
      
      // Return void/undefined to indicate success
      return;
    } catch (error) {
      logger.error(`[UnfreezeBrowserView] Error unfreezing view for windowId ${windowId}:`, error);
      throw error;
    }
  });
}