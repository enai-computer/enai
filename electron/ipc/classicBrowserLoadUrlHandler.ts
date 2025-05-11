import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { CLASSIC_BROWSER_LOAD_URL } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';

const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserLoadUrl]', ...args),
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
      logger.error('Invalid URL provided.');
      throw new Error('Invalid URL. Must be a non-empty string.');
    }
    // Basic URL validation (does not guarantee it's a fully valid or accessible URL)
    try {
      new URL(url); // Attempt to parse to catch grossly malformed URLs
    } catch (parseError) {
      logger.error('Malformed URL provided:', url, parseError);
      throw new Error('Malformed URL provided.');
    }

    try {
      await classicBrowserService.loadUrl(windowId, url);
      // No explicit return value needed for Promise<void>
      // Success means the loadUrl method in the service initiated the loading.
      // Actual page load success/failure is handled by events.
      logger.debug(`ClassicBrowserLoadUrlHandler: loadUrl call for ${windowId} completed.`);
    } catch (err: any) {
      logger.error(`Failed to load URL in ClassicBrowser for windowId ${windowId}:`, err);
      throw new Error(err.message || 'Failed to load URL in ClassicBrowser view.');
    }
  });
} 