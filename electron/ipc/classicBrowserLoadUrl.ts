import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { CLASSIC_BROWSER_LOAD_URL } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';

const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserLoadUrl]', ...args),
  warn: (...args: any[]) => console.warn('[IPCClassicBrowserLoadUrl]', ...args),
  error: (...args: any[]) => console.error('[IPCClassicBrowserLoadUrl]', ...args),
};

interface ClassicBrowserLoadUrlParams {
  windowId: string;
  url: string;
}

export function registerClassicBrowserLoadUrlHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.handle(CLASSIC_BROWSER_LOAD_URL, async (_event: IpcMainInvokeEvent, { windowId, url }: ClassicBrowserLoadUrlParams): Promise<void> => {
    logger.debug(`Handling ${CLASSIC_BROWSER_LOAD_URL} for windowId: ${windowId}, URL: ${url}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId provided.');
      throw new Error('Invalid windowId. Must be a non-empty string.');
    }

    if (!url || typeof url !== 'string') {
      logger.error(`Invalid URL provided: ${url}`);
      throw new Error('Invalid URL. Must be a non-empty string.');
    }

    // Basic URL validation (very simple, can be expanded)
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        logger.warn(`URL "${url}" does not start with http:// or https://. Attempting to load anyway.`);
        // Depending on strictness, you might throw an error here or let the service attempt it.
        // For now, we allow it, and the BrowserView will likely handle it or fail.
    }

    try {
      await classicBrowserService.loadUrl(windowId, url);
      logger.debug(`ClassicBrowserLoadUrlHandler: loadUrl call for ${windowId} with URL ${url} completed.`);
    } catch (err: any) {
      logger.error(`Failed to load URL in ClassicBrowser for windowId ${windowId}, URL ${url}:`, err);
      throw new Error(err.message || 'Failed to load URL in ClassicBrowser view.');
    }
  });
}
