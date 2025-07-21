import { IpcMain, IpcMainInvokeEvent } from 'electron';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { BROWSER_SIDEBAR_HOVER_START } from '../../shared/ipcChannels';
import { logger } from '../../utils/logger';

/**
 * Registers the handler for sidebar hover start events.
 * This notifies the browser service that the sidebar is being hovered.
 * 
 * @param ipcMain The IpcMain instance
 * @param classicBrowserService The ClassicBrowserService instance
 */
export function registerBrowserSidebarHoverStartHandler(
  ipcMain: IpcMain,
  classicBrowserService: ClassicBrowserService
) {
  ipcMain.handle(BROWSER_SIDEBAR_HOVER_START, async (event: IpcMainInvokeEvent) => {
    try {
      logger.debug('[BrowserSidebarHoverStart] Sidebar hover started');
      
      // Update the state and emit event
      classicBrowserService['deps'].stateService.setIsSidebarHovered(true);
      
      logger.debug('[BrowserSidebarHoverStart] State updated successfully');
    } catch (error) {
      logger.error('[BrowserSidebarHoverStart] Error handling sidebar hover start:', error);
      throw error;
    }
  });
}