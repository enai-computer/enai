import { IpcMain } from 'electron';
import { BROWSER_CONTEXT_MENU_REQUEST_SHOW } from '../../shared/ipcChannels';
import { BrowserContextMenuData } from '../../shared/types/contextMenu.types';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { ClassicBrowserTabTransferService } from '../../services/browser/ClassicBrowserTabTransferService';
import { logger } from '../../utils/logger';

export function registerBrowserContextMenuRequestShowHandler(
  ipcMain: IpcMain,
  classicBrowserService: ClassicBrowserService,
  tabTransferService?: ClassicBrowserTabTransferService
) {
  ipcMain.handle(BROWSER_CONTEXT_MENU_REQUEST_SHOW, async (event, data: BrowserContextMenuData) => {
    try {
      logger.info(`[browserContextMenuRequestShow] Received request - contextType: ${data.contextType}, windowId: ${data.windowId}`);
      
      // For tab context menus, fetch available notebooks
      if (data.contextType === 'tab') {
        logger.info(`[browserContextMenuRequestShow] Tab context menu detected, tabTransferService available: ${!!tabTransferService}`);
        
        if (tabTransferService) {
          try {
            logger.info(`[browserContextMenuRequestShow] Fetching available notebooks...`);
            const notebooks = await tabTransferService.getAvailableNotebooksWithTabGroups();
            data.availableNotebooks = notebooks;
            logger.info(`[browserContextMenuRequestShow] Populated ${notebooks.length} notebooks for tab context menu:`, 
              notebooks.map(n => ({ id: n.notebookId, title: n.notebookTitle, tabGroups: n.tabGroups.length })));
          } catch (error) {
            logger.error(`[browserContextMenuRequestShow] Failed to fetch notebooks for tab context menu:`, error);
            // Continue without notebooks data - the UI will handle this gracefully
          }
        } else {
          logger.warn(`[browserContextMenuRequestShow] TabTransferService not available - no Send to Notebook option will be shown`);
        }
      }
      
      logger.info(`[browserContextMenuRequestShow] Final data being sent to overlay:`, {
        contextType: data.contextType,
        hasTabContext: !!data.tabContext,
        availableNotebooks: data.availableNotebooks?.length || 0
      });
      
      // Use the existing showContextMenuOverlay method from the ClassicBrowserService
      const viewManager = classicBrowserService.getViewManager();
      await viewManager.showContextMenuOverlay(data.windowId, data);
      
      return { success: true };
    } catch (error) {
      logger.error(`[browserContextMenuRequestShow] Error showing context menu:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}