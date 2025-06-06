import { ipcMain, shell } from 'electron';
import { OPEN_EXTERNAL_URL } from '../../shared/ipcChannels';
import { logger } from '../../utils/logger';

export function registerOpenExternalUrlHandler() {
  ipcMain.handle(OPEN_EXTERNAL_URL, async (_event, url: string) => {
    try {
      // Basic validation
      if (!url || typeof url !== 'string') {
        logger.error(`[IPC Handler][${OPEN_EXTERNAL_URL}] Invalid URL received:`, url);
        throw new Error('Invalid URL provided');
      }

      // Validate URL format
      try {
        new URL(url);
      } catch (error) {
        logger.error(`[IPC Handler][${OPEN_EXTERNAL_URL}] Invalid URL format:`, url);
        throw new Error('Invalid URL format');
      }

      logger.info(`[IPC Handler][${OPEN_EXTERNAL_URL}] Opening external URL: ${url}`);
      
      // Open URL in default browser
      await shell.openExternal(url);
      
      logger.info(`[IPC Handler][${OPEN_EXTERNAL_URL}] Successfully opened URL: ${url}`);
      return true;
    } catch (error) {
      logger.error(`[IPC Handler Error][${OPEN_EXTERNAL_URL}] Failed to open URL:`, error);
      throw error;
    }
  });

  logger.info(`[IPC Handler] Registered handler for ${OPEN_EXTERNAL_URL}`);
}