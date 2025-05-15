import { ipcMain, IpcMainEvent } from 'electron';
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
  ipcMain.on(CLASSIC_BROWSER_SET_VISIBILITY, (_event: IpcMainEvent, { windowId, isVisible }: ClassicBrowserSetVisibilityParams) => {
    // logger.debug(`Handling ${CLASSIC_BROWSER_SET_VISIBILITY} for windowId: ${windowId}, isVisible: ${isVisible}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId provided.');
      // throw new Error('Invalid windowId. Must be a non-empty string.');
      return;
    }
    if (typeof isVisible !== 'boolean') {
      logger.error('Invalid isVisible value provided.');
      // throw new Error('Invalid isVisible value. Must be a boolean.');
      return;
    }

    try {
      classicBrowserService.setVisibility(windowId, isVisible);
      // logger.debug(`Successfully set visibility for ${windowId} to ${isVisible}`);
    } catch (err: any) {
      logger.error(`Failed to set visibility for classic browser windowId ${windowId}:`, err);
      // throw new Error(err.message || 'Failed to set visibility for ClassicBrowser view.');
    }
  });
} 