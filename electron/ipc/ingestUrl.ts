import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { INGEST_URL } from '../../shared/ipcChannels';
import { IngestionQueueService } from '../../services/ingestion/IngestionQueueService';
import { logger } from '../../utils/logger';

export function registerIngestUrlHandler(ingestionQueueService: IngestionQueueService) {
  ipcMain.handle(
    INGEST_URL,
    async (
      _event: IpcMainInvokeEvent,
      url: string,
      title?: string,
    ): Promise<{ jobId: string | null; alreadyExists: boolean }> => {
      logger.debug(`[IPC] Handling ${INGEST_URL} for URL: ${url}`);

      if (!url || typeof url !== 'string') {
        const errorMsg = 'Invalid URL provided. Must be a non-empty string.';
        logger.error(`[IPC][${INGEST_URL}] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      try {
        const result = await ingestionQueueService.createUrlIngestionJob(url, title);
        logger.info(`[IPC][${INGEST_URL}] Ingestion result for ${url}: jobId=${result.jobId}, alreadyExists=${result.alreadyExists}`);
        return result;
      } catch (err: any) {
        logger.error(`[IPC][${INGEST_URL}] Error calling IngestionQueueService:`, err);
        // Propagate the error to the renderer to be handled there
        throw err;
      }
    },
  );

  logger.info(`[IPC] Registered handler for ${INGEST_URL}`);
}