import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { CLASSIC_BROWSER_SET_BOUNDS } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';

const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserSetBounds]', ...args),
  error: (...args: any[]) => console.error('[IPCClassicBrowserSetBounds]', ...args),
};

interface ClassicBrowserSetBoundsParams {
  windowId: string;
  bounds: Electron.Rectangle;
}

export function registerClassicBrowserSetBoundsHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.handle(CLASSIC_BROWSER_SET_BOUNDS, async (_event: IpcMainInvokeEvent, { windowId, bounds }: ClassicBrowserSetBoundsParams): Promise<void> => {
    // logger.debug(`Handling ${CLASSIC_BROWSER_SET_BOUNDS} for windowId: ${windowId}, bounds: ${JSON.stringify(bounds)}`); // Can be too noisy

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId provided.');
      throw new Error('Invalid windowId. Must be a non-empty string.');
    }
    if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number' || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
      logger.error('Invalid bounds provided.', bounds);
      throw new Error('Invalid bounds object. Must include x, y, width, height as numbers.');
    }

    try {
      classicBrowserService.setBounds(windowId, bounds);
      // logger.debug(`Successfully set bounds for ${windowId}`);
    } catch (err: any) {
      logger.error(`Failed to set bounds for classic browser windowId ${windowId}:`, err);
      throw new Error(err.message || 'Failed to set bounds for ClassicBrowser view.');
    }
  });
} 