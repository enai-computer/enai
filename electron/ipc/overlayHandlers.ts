import { IpcMain } from 'electron';
import { OVERLAY_READY, OVERLAY_MENU_CLOSED, BROWSER_CONTEXT_MENU_ACTION } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { logger } from '../../utils/logger';

export function registerOverlayHandlers(
  ipcMain: IpcMain,
  browserService: ClassicBrowserService
) {
  // Handle overlay ready notification (uses ipcMain.on for one-way communication)
  ipcMain.on(OVERLAY_READY, (event) => {
    logger.info('[OverlayHandlers] Overlay ready');
    // The overlay is ready, we can now show context menus
    // Note: windowId could be extracted from webContents if needed
  });

  // Handle overlay menu closed notification (uses ipcMain.on for one-way communication)
  ipcMain.on(OVERLAY_MENU_CLOSED, (event) => {
    logger.debug('[OverlayHandlers] Overlay menu closed');
    // Extract windowId from the webContents
    const webContents = event.sender;
    const windowId = webContents.getURL().split('/').pop(); // Extract from URL path
    if (windowId) {
      // Hide the overlay when menu is closed
      browserService.hideContextMenuOverlay(windowId);
    }
  });

  // Handle browser context menu action execution
  ipcMain.handle(BROWSER_CONTEXT_MENU_ACTION, async (event, { windowId, action, data }) => {
    try {
      logger.info('[OverlayHandlers] Executing context menu action:', { windowId, action, data });
      
      // Execute the action on the browser service
      await browserService.executeContextMenuAction(windowId, action, data);
      
      // Hide the overlay after action execution
      browserService.hideContextMenuOverlay(windowId);
      
      return { success: true };
    } catch (error) {
      logger.error('[OverlayHandlers] Error executing context menu action:', error);
      throw error;
    }
  });

  logger.info('[OverlayHandlers] Registered overlay handlers');
}