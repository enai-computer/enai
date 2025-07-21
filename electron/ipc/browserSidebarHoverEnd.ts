import { IpcMain, IpcMainInvokeEvent } from 'electron';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { BROWSER_SIDEBAR_HOVER_END } from '../../shared/ipcChannels';
import { logger } from '../../utils/logger';

/**
 * Registers the handler for sidebar hover end events.
 * This notifies the browser service that the sidebar is no longer being hovered.
 * 
 * @param ipcMain The IpcMain instance
 * @param classicBrowserService The ClassicBrowserService instance
 */
export function registerBrowserSidebarHoverEndHandler(
  ipcMain: IpcMain,
  classicBrowserService: ClassicBrowserService
) {
  ipcMain.handle(BROWSER_SIDEBAR_HOVER_END, async (event: IpcMainInvokeEvent) => {
    try {
      logger.debug('[BrowserSidebarHoverEnd] Sidebar hover ended');
      
      // Update the state and emit event
      classicBrowserService['deps'].stateService.setIsSidebarHovered(false);
      
      logger.debug('[BrowserSidebarHoverEnd] State updated successfully');
    } catch (error) {
      logger.error('[BrowserSidebarHoverEnd] Error handling sidebar hover end:', error);
      throw error;
    }
  });
}