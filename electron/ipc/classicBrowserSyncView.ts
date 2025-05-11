import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { BROWSER_BOUNDS } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';

const logger = {
  debug: (...args: any[]) => console.log('[IPCBrowserBounds]', ...args),
  error: (...args: any[]) => console.error('[IPCBrowserBounds]', ...args),
};

interface BrowserBoundsParams {
  windowId: string;
  bounds?: Electron.Rectangle;
  isVisible?: boolean;
}

export function registerBrowserBoundsHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.handle(BROWSER_BOUNDS, async (_event: IpcMainInvokeEvent, { windowId, bounds, isVisible }: BrowserBoundsParams): Promise<void> => {
    // logger.debug(`Handling ${BROWSER_BOUNDS} for windowId: ${windowId}, Bounds: ${JSON.stringify(bounds)}, Visible: ${isVisible}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId provided for SetBounds.');
      throw new Error('Invalid windowId. Must be a non-empty string.');
    }

    try {
      if (bounds) {
        if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number' || 
            typeof bounds.width !== 'number' || typeof bounds.height !== 'number' || 
            bounds.width < 0 || bounds.height < 0) {
          logger.error('Invalid bounds provided for SetBounds:', bounds);
          throw new Error('Invalid bounds for BrowserBounds.');
        }
        const intBounds: Electron.Rectangle = {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
        };
        classicBrowserService.setBounds(windowId, intBounds);
      }

      if (typeof isVisible === 'boolean') {
        classicBrowserService.setVisibility(windowId, isVisible);
      }
      
      // logger.debug(`BrowserBoundsHandler: call for ${windowId} processed.`);
    } catch (err: any) {
      logger.error(`Failed to set bounds/visibility for ClassicBrowser view for windowId ${windowId}:`, err);
      throw new Error(err.message || 'Failed to set bounds/visibility for ClassicBrowser view.');
    }
  });
} 