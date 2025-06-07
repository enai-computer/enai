import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { NOTEBOOK_COMPOSE } from '../../shared/ipcChannels';
import { NotebookCompositionService } from '../../services/NotebookCompositionService';
import { logger } from '../../utils/logger';

export function registerComposeNotebookHandler(
  ipcMain: Electron.IpcMain,
  notebookCompositionService: NotebookCompositionService
) {
  ipcMain.handle(NOTEBOOK_COMPOSE, async (event: IpcMainInvokeEvent, params: { title: string; description?: string | null; sourceObjectIds?: string[] }) => {
    try {
      logger.debug('[ComposeNotebookHandler] Called with:', params);
      
      // Validate input
      if (!params.title || typeof params.title !== 'string') {
        throw new Error('Title is required and must be a string');
      }
      
      // sourceObjectIds is now optional - default to empty array
      if (params.sourceObjectIds && !Array.isArray(params.sourceObjectIds)) {
        throw new Error('sourceObjectIds must be an array if provided');
      }
      
      // Call the service
      const result = await notebookCompositionService.compose(params);
      
      logger.debug('[ComposeNotebookHandler] Composition successful:', result);
      return result;
      
    } catch (error) {
      logger.error('[ComposeNotebookHandler] Error:', error);
      throw error;
    }
  });
  
  logger.info('[ComposeNotebookHandler] Handler registered');
}