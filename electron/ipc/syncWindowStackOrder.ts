import { ipcMain } from 'electron';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { logger } from '../../utils/logger';
import { SYNC_WINDOW_STACK_ORDER } from '../../shared/ipcChannels';

/**
 * Handles synchronization of WebContentsView stacking order to match window z-indices.
 * This ensures that native views (WebContentsViews) are displayed in the same order
 * as their corresponding React windows.
 */
export function registerSyncWindowStackOrderHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.handle(SYNC_WINDOW_STACK_ORDER, async (_event, orderedWindows: Array<{ id: string; isFrozen: boolean; isMinimized: boolean }>) => {
    try {
      logger.debug('[syncWindowStackOrder] Received stack order update:', {
        windowCount: orderedWindows.length,
        windows: orderedWindows
      });
      
      // Validate input
      if (!Array.isArray(orderedWindows)) {
        throw new Error('orderedWindows must be an array of window state objects');
      }
      
      // Call the sync method on the service
      classicBrowserService.syncViewStackingOrder(orderedWindows);
      
      logger.debug('[syncWindowStackOrder] Successfully synced window stack order');
      
      return { success: true };
    } catch (error) {
      logger.error('[syncWindowStackOrder] Error syncing window stack order:', error);
      throw error;
    }
  });
}