import { ipcMain } from 'electron';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';
import { logger } from '../../utils/logger';
import { SYNC_WINDOW_STACK_ORDER } from '../../shared/ipcChannels';

/**
 * Handles synchronization of WebContentsView stacking order to match window z-indices.
 * This ensures that native views (WebContentsViews) are displayed in the same order
 * as their corresponding React windows.
 */
export function registerSyncWindowStackOrderHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.handle(SYNC_WINDOW_STACK_ORDER, async (_event, orderedWindowIds: string[]) => {
    try {
      logger.debug('[syncWindowStackOrder] Received stack order update:', {
        windowCount: orderedWindowIds.length,
        windowIds: orderedWindowIds
      });
      
      // Validate input
      if (!Array.isArray(orderedWindowIds)) {
        throw new Error('orderedWindowIds must be an array of window IDs');
      }
      
      // Call the sync method on the service
      classicBrowserService.syncViewStackingOrder(orderedWindowIds);
      
      logger.debug('[syncWindowStackOrder] Successfully synced window stack order');
      
      return { success: true };
    } catch (error) {
      logger.error('[syncWindowStackOrder] Error syncing window stack order:', error);
      throw error;
    }
  });
}