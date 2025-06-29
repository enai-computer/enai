import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { CLASSIC_BROWSER_DESTROY } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';

const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserDestroy]', ...args),
  error: (...args: any[]) => console.error('[IPCClassicBrowserDestroy]', ...args),
};

export function registerClassicBrowserDestroyHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.handle(CLASSIC_BROWSER_DESTROY, async (
    _event: IpcMainInvokeEvent, 
    windowId: string
  ): Promise<void> => {
    logger.debug(`Handling ${CLASSIC_BROWSER_DESTROY} for windowId: ${windowId}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId. Must be a non-empty string.');
      throw new Error('Invalid windowId. Must be a non-empty string.');
    }

    try {
      await classicBrowserService.destroyBrowserView(windowId);
    } catch (err: any) {
      logger.error(`Error in ${CLASSIC_BROWSER_DESTROY} handler for ${windowId}:`, err.message || err);
      throw err;
    }
  });
} 