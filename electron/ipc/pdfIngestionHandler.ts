import { IpcMain, BrowserWindow } from 'electron';
import * as path from 'path';
import { promises as fs } from 'fs';
import { logger } from '../../utils/logger';
import { PdfIngestionService } from '../../services/PdfIngestionService';
import type { 
  PdfIngestionError,
  PdfIngestBatchCompletePayload,
  PdfIngestionResult
} from '../../shared/types';
import { 
  PDF_INGEST_REQUEST, 
  PDF_INGEST_PROGRESS,
  PDF_INGEST_BATCH_COMPLETE,
  PDF_INGEST_CANCEL 
} from '../../shared/ipcChannels';

interface PdfIngestRequestPayload {
  filePaths: string[];
}

// Track ongoing ingestion for cancellation
let isIngestionCancelled = false;

/**
 * Registers IPC handlers for PDF ingestion operations.
 */
export function registerPdfIngestionHandler(
  ipcMain: IpcMain,
  pdfIngestionService: PdfIngestionService,
  mainWindow: BrowserWindow
) {
  // Handle PDF ingestion requests
  ipcMain.handle(PDF_INGEST_REQUEST, async (event, payload: PdfIngestRequestPayload) => {
    const { filePaths } = payload;
    
    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      logger.error('[PdfIngestionHandler] Invalid file paths provided');
      throw new Error('Invalid file paths provided');
    }

    logger.info(`[PdfIngestionHandler] Starting batch PDF ingestion for ${filePaths.length} files`);
    isIngestionCancelled = false;

    const results: Array<{
      filePath: string;
      fileName: string;
      success: boolean;
      objectId?: string;
      error?: string;
      errorType?: PdfIngestionError;
    }> = [];

    let successCount = 0;
    let failureCount = 0;

    // Process each PDF
    for (const filePath of filePaths) {
      if (isIngestionCancelled) {
        logger.info('[PdfIngestionHandler] Batch ingestion cancelled by user');
        break;
      }

      try {
        // Validate file exists
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) {
          throw new Error('Path is not a file');
        }

        const fileName = path.basename(filePath);
        const fileSize = stats.size;

        logger.debug(`[PdfIngestionHandler] Processing PDF: ${fileName} (${fileSize} bytes)`);

        // Process the PDF
        const result: PdfIngestionResult = await pdfIngestionService.processPdf(
          filePath,
          fileName,
          fileSize
        );

        if (result.success) {
          successCount++;
          results.push({
            filePath,
            fileName,
            success: true,
            objectId: result.objectId,
            errorType: result.status === 'DUPLICATE_FILE' ? result.status as PdfIngestionError : undefined
          });
        } else {
          failureCount++;
          results.push({
            filePath,
            fileName,
            success: false,
            error: result.error,
            errorType: result.status as PdfIngestionError
          });
        }

      } catch (error) {
        failureCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[PdfIngestionHandler] Failed to process ${filePath}:`, error);
        
        results.push({
          filePath,
          fileName: path.basename(filePath),
          success: false,
          error: errorMessage,
          errorType: 'STORAGE_FAILED' as PdfIngestionError
        });

        // Send error progress update
        mainWindow.webContents.send(PDF_INGEST_PROGRESS, {
          fileName: path.basename(filePath),
          filePath,
          status: 'error',
          error: errorMessage
        });
      }
    }

    // Send batch complete event
    const batchResult: PdfIngestBatchCompletePayload = {
      successCount,
      failureCount,
      results
    };

    mainWindow.webContents.send(PDF_INGEST_BATCH_COMPLETE, batchResult);
    logger.info(`[PdfIngestionHandler] Batch complete: ${successCount} success, ${failureCount} failed`);

    return batchResult;
  });

  // Handle cancellation requests
  ipcMain.handle(PDF_INGEST_CANCEL, async (event) => {
    logger.info('[PdfIngestionHandler] Received cancellation request');
    isIngestionCancelled = true;
    return { success: true };
  });

  logger.info('[PdfIngestionHandler] PDF ingestion handlers registered');
}