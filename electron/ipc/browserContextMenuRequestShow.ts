import { IpcMain } from 'electron';
import { BROWSER_CONTEXT_MENU_REQUEST_SHOW } from '../../shared/ipcChannels';
import { BrowserContextMenuData } from '../../shared/types/contextMenu.types';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { logger } from '../../utils/logger';

export function registerBrowserContextMenuRequestShowHandler(
  ipcMain: IpcMain,
  classicBrowserService: ClassicBrowserService
) {
  ipcMain.handle(BROWSER_CONTEXT_MENU_REQUEST_SHOW, async (event, data: BrowserContextMenuData) => {
    try {
      logger.debug(`[registerBrowserContextMenuRequestShowHandler] Showing context menu for window ${data.windowId} at (${data.x}, ${data.y})`);
      
      // Use the existing showContextMenuOverlay method from the ClassicBrowserService
      const viewManager = classicBrowserService.getViewManager();
      await viewManager.showContextMenuOverlay(data.windowId, data);
      
      return { success: true };
    } catch (error) {
      logger.error(`[registerBrowserContextMenuRequestShowHandler] Error showing context menu:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}