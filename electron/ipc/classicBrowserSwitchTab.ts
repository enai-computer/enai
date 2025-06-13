import { IpcMain } from 'electron';
import { CLASSIC_BROWSER_SWITCH_TAB } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';
import { logger } from '../../utils/logger';

export function registerClassicBrowserSwitchTab(
  ipcMain: IpcMain,
  classicBrowserService: ClassicBrowserService
) {
  ipcMain.handle(CLASSIC_BROWSER_SWITCH_TAB, async (event, windowId: string, tabId: string) => {
    try {
      logger.debug(`[registerClassicBrowserSwitchTab] Switching to tab ${tabId} in window ${windowId}`);
      classicBrowserService.switchTab(windowId, tabId);
      return { success: true };
    } catch (error) {
      logger.error(`[registerClassicBrowserSwitchTab] Error switching tab:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}