import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { CLASSIC_BROWSER_SET_VISIBILITY } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';

const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserSetVisibility]', ...args),
  error: (...args: any[]) => console.error('[IPCClassicBrowserSetVisibility]', ...args),
};

interface ClassicBrowserSetVisibilityParams {
  windowId: string;
  isVisible: boolean;
}

export function registerClassicBrowserSetVisibilityHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.handle(CLASSIC_BROWSER_SET_VISIBILITY, async (_event: IpcMainInvokeEvent, { windowId, isVisible }: ClassicBrowserSetVisibilityParams): Promise<void> => {
    // logger.debug(`Handling ${CLASSIC_BROWSER_SET_VISIBILITY} for windowId: ${windowId}, isVisible: ${isVisible}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId provided.');
      throw new Error('Invalid windowId. Must be a non-empty string.');
    }
    if (typeof isVisible !== 'boolean') {
      logger.error('Invalid isVisible value provided.');
      throw new Error('Invalid isVisible value. Must be a boolean.');
    }

    try {
      classicBrowserService.setVisibility(windowId, isVisible);
      // logger.debug(`Successfully set visibility for ${windowId} to ${isVisible}`);
    } catch (err: any) {
      logger.error(`Failed to set visibility for classic browser windowId ${windowId}:`, err);
      throw new Error(err.message || 'Failed to set visibility for ClassicBrowser view.');
    }
  });
} 