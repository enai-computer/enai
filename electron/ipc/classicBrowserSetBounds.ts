import { ipcMain, IpcMainEvent } from 'electron';
import { CLASSIC_BROWSER_SET_BOUNDS } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';

const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserSetBounds]', ...args),
  error: (...args: any[]) => console.error('[IPCClassicBrowserSetBounds]', ...args),
};

// interface ClassicBrowserSetBoundsParams { // Obsolete for handler arguments
//   windowId: string;
//   bounds: Electron.Rectangle;
// }

export function registerClassicBrowserSetBoundsHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.on(CLASSIC_BROWSER_SET_BOUNDS, (
    _event: IpcMainEvent, 
    windowId: string, 
    bounds: Electron.Rectangle
  ) => {
    // logger.debug(`Handling ${CLASSIC_BROWSER_SET_BOUNDS} for windowId: ${windowId}, bounds: ${JSON.stringify(bounds)}`); // Can be too noisy

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId provided.');
      return; // For ipcMain.on, just return on error, don't throw unless it implies main process crash
    }
    if (!bounds || typeof bounds !== 'object' || typeof bounds.x !== 'number' || typeof bounds.y !== 'number' || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
      logger.error('Invalid bounds provided.');
      return;
    }

    try {
      classicBrowserService.setBounds(windowId, bounds);
    } catch (err: any) {
      logger.error(`Error in ${CLASSIC_BROWSER_SET_BOUNDS} handler:`, err.message || err);
    }
  });
} 