import { IpcMain } from 'electron';
import { CLASSIC_BROWSER_CREATE_TAB } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';
import { logger } from '../../utils/logger';

export function registerClassicBrowserCreateTab(
  ipcMain: IpcMain,
  classicBrowserService: ClassicBrowserService
) {
  ipcMain.handle(CLASSIC_BROWSER_CREATE_TAB, async (event, windowId: string, url?: string) => {
    try {
      logger.debug(`[registerClassicBrowserCreateTab] Creating new tab for window ${windowId} with URL: ${url || 'about:blank'}`);
      const tabId = classicBrowserService.createTab(windowId, url);
      return { success: true, tabId };
    } catch (error) {
      logger.error(`[registerClassicBrowserCreateTab] Error creating tab:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}