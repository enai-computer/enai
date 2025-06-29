import { IpcMain } from 'electron';
import { CLASSIC_BROWSER_CLOSE_TAB } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { logger } from '../../utils/logger';

export function registerClassicBrowserCloseTab(
  ipcMain: IpcMain,
  classicBrowserService: ClassicBrowserService
) {
  ipcMain.handle(CLASSIC_BROWSER_CLOSE_TAB, async (event, windowId: string, tabId: string) => {
    try {
      logger.debug(`[registerClassicBrowserCloseTab] Closing tab ${tabId} in window ${windowId}`);
      classicBrowserService.closeTab(windowId, tabId);
      return { success: true };
    } catch (error) {
      logger.error(`[registerClassicBrowserCloseTab] Error closing tab:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}