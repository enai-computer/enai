import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { CLASSIC_BROWSER_DESTROY } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';

const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserDestroy]', ...args),
  error: (...args: any[]) => console.error('[IPCClassicBrowserDestroy]', ...args),
};

interface ClassicBrowserDestroyParams {
  windowId: string;
}

export function registerClassicBrowserDestroyHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.handle(CLASSIC_BROWSER_DESTROY, async (_event: IpcMainInvokeEvent, { windowId }: ClassicBrowserDestroyParams): Promise<void> => {
    logger.debug(`Handling ${CLASSIC_BROWSER_DESTROY} for windowId: ${windowId}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId provided for DestroyView.');
      throw new Error('Invalid windowId. Must be a non-empty string.');
    }

    try {
      classicBrowserService.destroyBrowserView(windowId);
      logger.debug(`ClassicBrowserDestroyHandler: destroy call for ${windowId} completed.`);
    } catch (err: any) {
      logger.error(`Failed to destroy ClassicBrowser view for windowId ${windowId}:`, err);
      throw new Error(err.message || 'Failed to destroy ClassicBrowser view.');
    }
  });
} 