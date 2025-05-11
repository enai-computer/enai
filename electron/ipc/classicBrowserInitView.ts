import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { CLASSIC_BROWSER_CREATE } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';

// Optional: Define a logger utility or use console
const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserCreate]', ...args),
  warn: (...args: any[]) => console.warn('[IPCClassicBrowserCreate]', ...args),
  error: (...args: any[]) => console.error('[IPCClassicBrowserCreate]', ...args),
};

interface ClassicBrowserCreateParams {
  windowId: string;
  bounds: Electron.Rectangle;
  initialUrl?: string;
}

export function registerClassicBrowserCreateHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.handle(CLASSIC_BROWSER_CREATE, async (_event: IpcMainInvokeEvent, { windowId, bounds, initialUrl }: ClassicBrowserCreateParams) => {
    logger.debug(`Handling ${CLASSIC_BROWSER_CREATE} for windowId: ${windowId} with bounds: ${JSON.stringify(bounds)}, initialUrl: ${initialUrl}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId provided.');
      throw new Error('Invalid windowId for ClassicBrowserCreate. Must be a non-empty string.');
    }

    if (!bounds || 
        typeof bounds.x !== 'number' || 
        typeof bounds.y !== 'number' || 
        typeof bounds.width !== 'number' || 
        typeof bounds.height !== 'number' || 
        bounds.width <= 0 || bounds.height <= 0) {
      logger.error('Invalid bounds provided.');
      throw new Error('Invalid bounds for ClassicBrowserCreate. Must be a valid Rectangle with positive width/height.');
    }
    
    if (initialUrl && typeof initialUrl !== 'string') {
        logger.error('Invalid initialUrl provided. Must be a string if present.');
        throw new Error('Invalid initialUrl. Must be a string if provided.');
    }

    try {
      // The service method is not async and doesn't return a promise for creation itself.
      // URL loading within it might be async.
      classicBrowserService.createBrowserView(windowId, bounds, initialUrl);
      // The initial URL loading is kicked off by createBrowserView if initialUrl is present.
      // The success of loadURL is handled by events from BrowserView published by the service.
      logger.debug(`Successfully initiated ClassicBrowser view creation for ${windowId}`);
      return { success: true };
    } catch (err: any) {
      logger.error(`Failed to create ClassicBrowser view for windowId ${windowId}:`, err);
      // Propagate a sanitized error or the original error if it's safe
      throw new Error(err.message || 'Failed to create ClassicBrowser view.');
    }
  });
} 