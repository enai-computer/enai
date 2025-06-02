import { IpcMain, BrowserWindow } from 'electron';
import * as path from 'path';
import { promises as fs } from 'fs';
import { logger } from '../../utils/logger';
import { PdfIngestionService } from '../../services/ingestion/PdfIngestionService';
import { IngestionQueueService } from '../../services/ingestion/IngestionQueueService';
import type { 
  PdfIngestionError,
  PdfIngestionStatus,
  PdfIngestBatchCompletePayload,
  PdfIngestionResult,
  PdfIngestRequestPayload
} from '../../shared/types';
import { 
  PDF_INGEST_REQUEST, 
  PDF_INGEST_PROGRESS,
  PDF_INGEST_BATCH_COMPLETE,
  PDF_INGEST_CANCEL 
} from '../../shared/ipcChannels';

// Track ongoing ingestion for cancellation
let isIngestionCancelled = false;

/**
 * Registers IPC handlers for PDF ingestion operations.
 */
export function registerPdfIngestionHandler(
  ipcMain: IpcMain,
  pdfIngestionService: PdfIngestionService,
  mainWindow: BrowserWindow,
  ingestionQueueService: IngestionQueueService
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

    // Use new queue system if available
    // Use queue system for batch processing
      logger.info('[PdfIngestionHandler] Using new ingestion queue system');
      
      const jobIds: string[] = [];
      
      // Queue all PDFs
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

          logger.debug(`[PdfIngestionHandler] Queueing PDF: ${fileName} (${fileSize} bytes)`);

          // Add to queue
          const job = await ingestionQueueService.addJob('pdf', filePath, {
            originalFileName: fileName,
            priority: 0,
            jobSpecificData: {
              fileSize: fileSize
            }
          });
          
          jobIds.push(job.id);
          
          // Send queued status
          mainWindow.webContents.send(PDF_INGEST_PROGRESS, {
            fileName,
            filePath,
            status: 'queued',
            jobId: job.id
          });

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error(`[PdfIngestionHandler] Failed to queue ${filePath}:`, error);
          
          // Send error progress update
          mainWindow.webContents.send(PDF_INGEST_PROGRESS, {
            fileName: path.basename(filePath),
            filePath,
            status: 'error',
            error: errorMessage
          });
        }
      }

      // Track completion of queued jobs
      let completedCount = 0;
      const totalJobs = jobIds.length;
      const results: Array<{
        filePath: string;
        fileName: string;
        success: boolean;
        objectId?: string;
        error?: string;
        errorType?: PdfIngestionError;
      }> = [];
      
      // Create a map to track job ID to file info
      const jobToFileMap = new Map<string, { filePath: string; fileName: string }>();
      jobIds.forEach((jobId, index) => {
        jobToFileMap.set(jobId, {
          filePath: filePaths[index],
          fileName: path.basename(filePaths[index])
        });
      });
      
      // Also listen for job progress events to forward as PDF progress
      const handleJobProgress = (job: any) => {
        const fileInfo = jobToFileMap.get(job.id);
        if (fileInfo && job.progress) {
          // Map queue progress to PDF progress format
          let status: PdfIngestionStatus = 'starting_processing';
          
          // Map stage to status
          switch (job.progress.stage) {
            case 'parsing':
              status = 'parsing_text';
              break;
            case 'ai_processing':
              status = 'generating_summary';
              break;
            case 'persisting':
            case 'saving':
              status = 'saving_metadata';
              break;
            case 'chunking':
            case 'vectorizing':
              status = 'creating_embeddings';
              break;
            case 'finalizing':
              status = 'complete';
              break;
            case 'error':
              status = 'error';
              break;
            default:
              status = 'starting_processing';
              break;
          }
          
          // Send PDF progress update
          mainWindow.webContents.send(PDF_INGEST_PROGRESS, {
            fileName: fileInfo.fileName,
            filePath: fileInfo.filePath,
            status,
            jobId: job.id
          });
        }
      };
      
      // Set up timeout to clean up listeners after 10 minutes
      const LISTENER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
      let listenerTimeoutId: NodeJS.Timeout | null = null;
      
      const cleanupListeners = () => {
        if (listenerTimeoutId) {
          clearTimeout(listenerTimeoutId);
          listenerTimeoutId = null;
        }
        ingestionQueueService.off('job:progress', handleJobProgress);
        ingestionQueueService.off('job:completed', handleJobComplete);
        ingestionQueueService.off('job:failed', handleJobFailed);
        logger.debug('[PdfIngestionHandler] Cleaned up job listeners');
      };
      
      // Listen for job completion events
      const handleJobComplete = (job: any) => {
        const fileInfo = jobToFileMap.get(job.id);
        if (fileInfo) {
          completedCount++;
          
          results.push({
            filePath: fileInfo.filePath,
            fileName: fileInfo.fileName,
            success: true,
            objectId: job.relatedObjectId
          });
          
          // Check if all jobs are complete
          if (completedCount === totalJobs) {
            // Send batch complete event
            const batchResult: PdfIngestBatchCompletePayload = {
              successCount: results.filter(r => r.success).length,
              failureCount: results.filter(r => !r.success).length,
              results
            };
            
            mainWindow.webContents.send(PDF_INGEST_BATCH_COMPLETE, batchResult);
            
            // Clean up listeners and timeout
            cleanupListeners();
          }
        }
      };
      
      const handleJobFailed = (job: any) => {
        const fileInfo = jobToFileMap.get(job.id);
        if (fileInfo) {
          completedCount++;
          
          results.push({
            filePath: fileInfo.filePath,
            fileName: fileInfo.fileName,
            success: false,
            error: job.errorInfo || 'Processing failed',
            errorType: 'STORAGE_FAILED' as PdfIngestionError
          });
          
          // Check if all jobs are complete
          if (completedCount === totalJobs) {
            // Send batch complete event
            const batchResult: PdfIngestBatchCompletePayload = {
              successCount: results.filter(r => r.success).length,
              failureCount: results.filter(r => !r.success).length,
              results
            };
            
            mainWindow.webContents.send(PDF_INGEST_BATCH_COMPLETE, batchResult);
            
            // Clean up listeners and timeout
            cleanupListeners();
          }
        }
      };
      
      // Set up listeners
      ingestionQueueService.on('job:progress', handleJobProgress);
      ingestionQueueService.on('job:completed', handleJobComplete);
      ingestionQueueService.on('job:failed', handleJobFailed);
      
      // Start the timeout
      listenerTimeoutId = setTimeout(() => {
        logger.warn(`[PdfIngestionHandler] Listener timeout reached (${LISTENER_TIMEOUT_MS}ms), cleaning up`);
        
        // Send batch complete with current results
        const batchResult: PdfIngestBatchCompletePayload = {
          successCount: results.filter(r => r.success).length,
          failureCount: results.filter(r => !r.success).length + (totalJobs - completedCount), // Count timeouts as failures
          results: [
            ...results,
            // Add timeout failures for incomplete jobs
            ...jobIds
              .filter(jobId => !results.some(r => jobToFileMap.get(jobId)?.filePath === r.filePath))
              .map(jobId => {
                const fileInfo = jobToFileMap.get(jobId);
                return {
                  filePath: fileInfo?.filePath || '',
                  fileName: fileInfo?.fileName || '',
                  success: false,
                  error: 'Processing timed out',
                  errorType: 'STORAGE_FAILED' as PdfIngestionError
                };
              })
          ]
        };
        
        mainWindow.webContents.send(PDF_INGEST_BATCH_COMPLETE, batchResult);
        cleanupListeners();
      }, LISTENER_TIMEOUT_MS);
      
      // Return immediate response
      return {
        queued: true,
        jobIds,
        message: `Queued ${jobIds.length} PDF files for processing`
      };
  });

  // Handle cancellation requests
  ipcMain.handle(PDF_INGEST_CANCEL, async (event) => {
    logger.info('[PdfIngestionHandler] Received cancellation request');
    isIngestionCancelled = true;
    return { success: true };
  });

  logger.info('[PdfIngestionHandler] PDF ingestion handlers registered');
}