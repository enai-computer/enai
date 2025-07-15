import { IpcMain } from 'electron';
import { OVERLAY_READY, OVERLAY_MENU_CLOSED, BROWSER_CONTEXT_MENU_ACTION } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { ClassicBrowserViewManager } from '../../services/browser/ClassicBrowserViewManager';
import { logger } from '../../utils/logger';

export function registerOverlayHandlers(
  ipcMain: IpcMain,
  browserService: ClassicBrowserService,
  viewManager: ClassicBrowserViewManager
) {
  // Handle overlay ready notification (uses ipcMain.on for one-way communication)
  ipcMain.on(OVERLAY_READY, (event) => {
    logger.info('[OverlayHandlers] Overlay ready');
    // Notify the view manager that the overlay is ready
    viewManager.handleOverlayReady(event.sender);
  });

  // Handle overlay menu closed notification (uses ipcMain.on for one-way communication)
  ipcMain.on(OVERLAY_MENU_CLOSED, (event, data) => {
    logger.debug('[OverlayHandlers] Overlay menu closed');
    const windowId = data?.windowId;
    logger.debug('[OverlayHandlers] Received windowId:', windowId);
    
    if (windowId) {
      // Hide the overlay when menu is closed
      browserService.hideContextMenuOverlay(windowId);
    } else {
      logger.error('[OverlayHandlers] No windowId provided in menu closed event');
    }
  });

  // Handle browser context menu action execution
  ipcMain.handle(BROWSER_CONTEXT_MENU_ACTION, async (event, payload) => {
    try {
      // Handle nested structure from overlay
      const { action, data } = payload;
      const windowId = data?.windowId;
      
      logger.info('[OverlayHandlers] Executing context menu action:', { windowId, action, data });
      
      if (!windowId) {
        throw new Error('No windowId provided in context menu action');
      }
      
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