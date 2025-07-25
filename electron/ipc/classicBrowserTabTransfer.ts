import { IpcMain, IpcMainInvokeEvent } from 'electron';
import { CLASSIC_BROWSER_TAB_TRANSFER, CLASSIC_BROWSER_GET_AVAILABLE_NOTEBOOKS } from '../../shared/ipcChannels';
import { ClassicBrowserTabTransferService } from '../../services/browser/ClassicBrowserTabTransferService';
import { logger } from '../../utils/logger';

export function registerClassicBrowserTabTransferHandlers(
  ipcMain: IpcMain,
  tabTransferService: ClassicBrowserTabTransferService
) {
  // Handle tab transfer request
  ipcMain.handle(CLASSIC_BROWSER_TAB_TRANSFER, async (
    event: IpcMainInvokeEvent, 
    params: {
      sourceTabId: string;
      sourceWindowId: string;
      targetNotebookId: string;
      targetTabGroupId?: string;
    }
  ) => {
    try {
      logger.debug('[classicBrowserTabTransfer] Transfer tab request:', params);
      
      await tabTransferService.transferTabToNotebook(params);
      
      logger.info(`[classicBrowserTabTransfer] Successfully transferred tab ${params.sourceTabId} to notebook ${params.targetNotebookId}`);
      return { success: true };
    } catch (error) {
      logger.error('[classicBrowserTabTransfer] Error transferring tab:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      };
    }
  });

  // Handle request for available notebooks with tab groups
  ipcMain.handle(CLASSIC_BROWSER_GET_AVAILABLE_NOTEBOOKS, async (event: IpcMainInvokeEvent) => {
    try {
      logger.debug('[classicBrowserGetAvailableNotebooks] Getting available notebooks');
      
      const notebooks = await tabTransferService.getAvailableNotebooksWithTabGroups();
      
      logger.debug(`[classicBrowserGetAvailableNotebooks] Found ${notebooks.length} notebooks`);
      return { success: true, data: notebooks };
    } catch (error) {
      logger.error('[classicBrowserGetAvailableNotebooks] Error getting notebooks:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      };
    }
  });
}