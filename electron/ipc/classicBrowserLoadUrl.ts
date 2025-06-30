import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { CLASSIC_BROWSER_LOAD_URL } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';

const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserLoadUrl]', ...args),
  warn: (...args: any[]) => console.warn('[IPCClassicBrowserLoadUrl]', ...args),
  error: (...args: any[]) => console.error('[IPCClassicBrowserLoadUrl]', ...args),
};

// interface ClassicBrowserLoadUrlParams { // Obsolete for handler arguments
//   windowId: string;
//   url: string;
// }

export function registerClassicBrowserLoadUrlHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.handle(CLASSIC_BROWSER_LOAD_URL, async (
    _event: IpcMainInvokeEvent, 
    windowId: string, 
    url: string
  ): Promise<void> => {
    logger.debug(`Handling ${CLASSIC_BROWSER_LOAD_URL} for windowId: ${windowId}, URL: ${url}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId. Must be a non-empty string.');
      throw new Error('Invalid windowId. Must be a non-empty string.');
    }
    if (!url || typeof url !== 'string') {
      logger.error('Invalid URL. Must be a non-empty string.');
      throw new Error('Invalid URL. Must be a non-empty string.');
    }
    // Basic URL validation (very simple, can be enhanced)
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
        logger.error('Invalid URL scheme. Must be http, https, or about.');
        throw new Error('Invalid URL scheme. Must be http, https, or about.');
    }

    try {
      await classicBrowserService.loadUrl(windowId, url);
      // No explicit return needed for Promise<void> if successful
    } catch (err: any) {
      logger.error(`Error in ${CLASSIC_BROWSER_LOAD_URL} handler for ${windowId}:`, err.message || err);
      // Let the error propagate (it will be caught by the renderer's invoke call)
      throw err; 
    }
  });
}
