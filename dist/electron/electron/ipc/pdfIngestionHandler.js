"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPdfIngestionHandler = registerPdfIngestionHandler;
const path = __importStar(require("path"));
const fs_1 = require("fs");
const logger_1 = require("../../utils/logger");
const ipcChannels_1 = require("../../shared/ipcChannels");
// Track ongoing ingestion for cancellation
let isIngestionCancelled = false;
/**
 * Registers IPC handlers for PDF ingestion operations.
 */
function registerPdfIngestionHandler(ipcMain, pdfIngestionService, mainWindow, ingestionQueueService) {
    // Handle PDF ingestion requests
    ipcMain.handle(ipcChannels_1.PDF_INGEST_REQUEST, async (event, payload) => {
        const { filePaths } = payload;
        if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
            logger_1.logger.error('[PdfIngestionHandler] Invalid file paths provided');
            throw new Error('Invalid file paths provided');
        }
        logger_1.logger.info(`[PdfIngestionHandler] Starting batch PDF ingestion for ${filePaths.length} files`);
        isIngestionCancelled = false;
        // Use new queue system if available
        // Use queue system for batch processing
        logger_1.logger.info('[PdfIngestionHandler] Using new ingestion queue system');
        const jobIds = [];
        // Queue all PDFs
        for (const filePath of filePaths) {
            if (isIngestionCancelled) {
                logger_1.logger.info('[PdfIngestionHandler] Batch ingestion cancelled by user');
                break;
            }
            try {
                // Validate file exists
                const stats = await fs_1.promises.stat(filePath);
                if (!stats.isFile()) {
                    throw new Error('Path is not a file');
                }
                const fileName = path.basename(filePath);
                const fileSize = stats.size;
                logger_1.logger.debug(`[PdfIngestionHandler] Queueing PDF: ${fileName} (${fileSize} bytes)`);
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
                mainWindow.webContents.send(ipcChannels_1.PDF_INGEST_PROGRESS, {
                    fileName,
                    filePath,
                    status: 'queued',
                    jobId: job.id
                });
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger_1.logger.error(`[PdfIngestionHandler] Failed to queue ${filePath}:`, error);
                // Send error progress update
                mainWindow.webContents.send(ipcChannels_1.PDF_INGEST_PROGRESS, {
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
        const results = [];
        // Create a map to track job ID to file info
        const jobToFileMap = new Map();
        jobIds.forEach((jobId, index) => {
            jobToFileMap.set(jobId, {
                filePath: filePaths[index],
                fileName: path.basename(filePaths[index])
            });
        });
        // Also listen for job progress events to forward as PDF progress
        const handleJobProgress = (job) => {
            const fileInfo = jobToFileMap.get(job.id);
            if (fileInfo && job.progress) {
                // Map queue progress to PDF progress format
                let status = 'starting_processing';
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
                mainWindow.webContents.send(ipcChannels_1.PDF_INGEST_PROGRESS, {
                    fileName: fileInfo.fileName,
                    filePath: fileInfo.filePath,
                    status,
                    jobId: job.id
                });
            }
        };
        // Set up timeout to clean up listeners after 10 minutes
        const LISTENER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
        let listenerTimeoutId = null;
        const cleanupListeners = () => {
            if (listenerTimeoutId) {
                clearTimeout(listenerTimeoutId);
                listenerTimeoutId = null;
            }
            ingestionQueueService.off('job:progress', handleJobProgress);
            ingestionQueueService.off('job:completed', handleJobComplete);
            ingestionQueueService.off('job:failed', handleJobFailed);
            logger_1.logger.debug('[PdfIngestionHandler] Cleaned up job listeners');
        };
        // Listen for job completion events
        const handleJobComplete = (job) => {
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
                    const batchResult = {
                        successCount: results.filter(r => r.success).length,
                        failureCount: results.filter(r => !r.success).length,
                        results
                    };
                    mainWindow.webContents.send(ipcChannels_1.PDF_INGEST_BATCH_COMPLETE, batchResult);
                    // Clean up listeners and timeout
                    cleanupListeners();
                }
            }
        };
        const handleJobFailed = (job) => {
            const fileInfo = jobToFileMap.get(job.id);
            if (fileInfo) {
                completedCount++;
                results.push({
                    filePath: fileInfo.filePath,
                    fileName: fileInfo.fileName,
                    success: false,
                    error: job.errorInfo || 'Processing failed',
                    errorType: 'STORAGE_FAILED'
                });
                // Check if all jobs are complete
                if (completedCount === totalJobs) {
                    // Send batch complete event
                    const batchResult = {
                        successCount: results.filter(r => r.success).length,
                        failureCount: results.filter(r => !r.success).length,
                        results
                    };
                    mainWindow.webContents.send(ipcChannels_1.PDF_INGEST_BATCH_COMPLETE, batchResult);
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
            logger_1.logger.warn(`[PdfIngestionHandler] Listener timeout reached (${LISTENER_TIMEOUT_MS}ms), cleaning up`);
            // Send batch complete with current results
            const batchResult = {
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
                            errorType: 'STORAGE_FAILED'
                        };
                    })
                ]
            };
            mainWindow.webContents.send(ipcChannels_1.PDF_INGEST_BATCH_COMPLETE, batchResult);
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
    ipcMain.handle(ipcChannels_1.PDF_INGEST_CANCEL, async (event) => {
        logger_1.logger.info('[PdfIngestionHandler] Received cancellation request');
        isIngestionCancelled = true;
        return { success: true };
    });
    logger_1.logger.info('[PdfIngestionHandler] PDF ingestion handlers registered');
}
//# sourceMappingURL=pdfIngestionHandler.js.map