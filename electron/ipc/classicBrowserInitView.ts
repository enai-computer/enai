import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { CLASSIC_BROWSER_CREATE } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';
import { ClassicBrowserPayload } from '../../shared/types';

// Optional: Define a logger utility or use console
const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserCreate]', ...args),
  warn: (...args: any[]) => console.warn('[IPCClassicBrowserCreate]', ...args),
  error: (...args: any[]) => console.error('[IPCClassicBrowserCreate]', ...args),
};

// interface ClassicBrowserCreateParams { // This interface is now obsolete for the handler arguments
//   windowId: string;
//   bounds: Electron.Rectangle;
//   initialUrl?: string;
// }

export function registerClassicBrowserCreateHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.handle(CLASSIC_BROWSER_CREATE, async (
    _event: IpcMainInvokeEvent, 
    windowId: string, 
    bounds: Electron.Rectangle, 
    payload: ClassicBrowserPayload
  ) => {
    logger.debug(`Handling ${CLASSIC_BROWSER_CREATE} for windowId: ${windowId} with bounds: ${JSON.stringify(bounds)}, payload tabs: ${payload?.tabs?.length || 0}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId for ClassicBrowserCreate. Must be a non-empty string.');
      throw new Error('Invalid windowId for ClassicBrowserCreate. Must be a non-empty string.');
    }
    // Add more validation for bounds and payload if necessary
    if (!bounds || typeof bounds !== 'object' || typeof bounds.x !== 'number' || typeof bounds.y !== 'number' || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
      logger.error('Invalid bounds provided for ClassicBrowserCreate.');
      throw new Error('Invalid bounds provided for ClassicBrowserCreate.');
    }
    if (!payload || typeof payload !== 'object') {
      logger.error('Invalid payload provided for ClassicBrowserCreate.');
      throw new Error('Invalid payload provided for ClassicBrowserCreate.');
    }

    try {
      classicBrowserService.createBrowserView(windowId, bounds, payload);
      return { success: true };
    } catch (err: any) {
      logger.error(`Error in ${CLASSIC_BROWSER_CREATE} handler:`, err.message || err);
      throw new Error(err.message || `Failed to create classic browser view for ${windowId}`);
    }
  });
} 