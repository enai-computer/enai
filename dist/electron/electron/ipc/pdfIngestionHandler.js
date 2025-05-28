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
function registerPdfIngestionHandler(ipcMain, pdfIngestionService, mainWindow) {
    // Handle PDF ingestion requests
    ipcMain.handle(ipcChannels_1.PDF_INGEST_REQUEST, async (event, payload) => {
        const { filePaths } = payload;
        if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
            logger_1.logger.error('[PdfIngestionHandler] Invalid file paths provided');
            throw new Error('Invalid file paths provided');
        }
        logger_1.logger.info(`[PdfIngestionHandler] Starting batch PDF ingestion for ${filePaths.length} files`);
        isIngestionCancelled = false;
        const results = [];
        let successCount = 0;
        let failureCount = 0;
        // Process each PDF
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
                logger_1.logger.debug(`[PdfIngestionHandler] Processing PDF: ${fileName} (${fileSize} bytes)`);
                // Process the PDF
                const result = await pdfIngestionService.processPdf(filePath, fileName, fileSize);
                if (result.success) {
                    successCount++;
                    results.push({
                        filePath,
                        fileName,
                        success: true,
                        objectId: result.objectId,
                        errorType: result.status === 'DUPLICATE_FILE' ? result.status : undefined
                    });
                }
                else {
                    failureCount++;
                    results.push({
                        filePath,
                        fileName,
                        success: false,
                        error: result.error,
                        errorType: result.status
                    });
                }
            }
            catch (error) {
                failureCount++;
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger_1.logger.error(`[PdfIngestionHandler] Failed to process ${filePath}:`, error);
                results.push({
                    filePath,
                    fileName: path.basename(filePath),
                    success: false,
                    error: errorMessage,
                    errorType: 'STORAGE_FAILED'
                });
                // Send error progress update
                mainWindow.webContents.send(ipcChannels_1.PDF_INGEST_PROGRESS, {
                    fileName: path.basename(filePath),
                    filePath,
                    status: 'error',
                    error: errorMessage
                });
            }
        }
        // Send batch complete event
        const batchResult = {
            successCount,
            failureCount,
            results
        };
        mainWindow.webContents.send(ipcChannels_1.PDF_INGEST_BATCH_COMPLETE, batchResult);
        logger_1.logger.info(`[PdfIngestionHandler] Batch complete: ${successCount} success, ${failureCount} failed`);
        return batchResult;
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