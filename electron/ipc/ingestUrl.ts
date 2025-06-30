import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import { INGEST_URL } from '../../shared/ipcChannels';
import { IngestionQueueService } from '../../services/ingestion/IngestionQueueService';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { TabState } from '../../shared/types/window.types';
import { logger } from '../../utils/logger';

export function registerIngestUrlHandler(
  ingestionQueueService: IngestionQueueService,
  classicBrowserService?: ClassicBrowserService
) {
  ipcMain.handle(
    INGEST_URL,
    async (
      event: IpcMainInvokeEvent,
      url: string,
      title?: string,
      windowId?: string, // Optional windowId parameter for Classic Browser tabs
    ): Promise<{ jobId: string | null; alreadyExists: boolean }> => {
      logger.debug(`[IPC] Handling ${INGEST_URL} for URL: ${url}`);

      if (!url || typeof url !== 'string') {
        const errorMsg = 'Invalid URL provided. Must be a non-empty string.';
        logger.error(`[IPC][${INGEST_URL}] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      try {
        // First, update any tabs with this URL to show bookmarking status
        if (classicBrowserService && windowId) {
          // Find tabs with this URL and update their status
          const browserState = classicBrowserService.getBrowserState(windowId);
          if (browserState) {
            const tabsWithUrl = browserState.tabs.filter((tab: TabState) => tab.url === url);
            for (const tab of tabsWithUrl) {
              classicBrowserService.updateTabBookmarkStatus(windowId, tab.id, 'bookmarking');
            }
          }
        }

        const result = await ingestionQueueService.createUrlIngestionJob(url, title);
        logger.info(`[IPC][${INGEST_URL}] Ingestion result for ${url}: jobId=${result.jobId}, alreadyExists=${result.alreadyExists}`);
        
        // Update tab status based on result
        if (classicBrowserService && windowId && result.jobId) {
          const browserState = classicBrowserService.getBrowserState(windowId);
          if (browserState) {
            const tabsWithUrl = browserState.tabs.filter((tab: TabState) => tab.url === url);
            for (const tab of tabsWithUrl) {
              classicBrowserService.updateTabBookmarkStatus(
                windowId, 
                tab.id, 
                'processing',
                result.jobId
              );
            }
          }
        }
        
        return result;
      } catch (err: any) {
        logger.error(`[IPC][${INGEST_URL}] Error calling IngestionQueueService:`, err);
        
        // Update tab status to error
        if (classicBrowserService && windowId) {
          const browserState = classicBrowserService.getBrowserState(windowId);
          if (browserState) {
            const tabsWithUrl = browserState.tabs.filter((tab: TabState) => tab.url === url);
            for (const tab of tabsWithUrl) {
              classicBrowserService.updateTabBookmarkStatus(
                windowId, 
                tab.id, 
                'error',
                undefined,
                err.message
              );
            }
          }
        }
        
        // Propagate the error to the renderer to be handled there
        throw err;
      }
    },
  );

  logger.info(`[IPC] Registered handler for ${INGEST_URL}`);
}