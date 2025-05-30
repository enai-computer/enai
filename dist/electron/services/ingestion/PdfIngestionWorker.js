"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PdfIngestionWorker = void 0;
const logger_1 = require("../../utils/logger");
const BaseIngestionWorker_1 = require("./BaseIngestionWorker");
const constants_1 = require("./constants");
const types_1 = require("./types");
class PdfIngestionWorker extends BaseIngestionWorker_1.BaseIngestionWorker {
    constructor(pdfIngestionService, ingestionJobModel, mainWindow) {
        super(ingestionJobModel, 'PdfIngestionWorker');
        this.pdfIngestionService = pdfIngestionService;
        this.mainWindow = mainWindow;
        // Set main window if provided
        // Progress will be handled via callback mechanism
    }
    async execute(job) {
        const filePath = job.sourceIdentifier;
        const fileName = job.originalFileName || filePath.split('/').pop() || 'unknown.pdf';
        logger_1.logger.info(`[${this.workerName}] Processing PDF job ${job.id}: ${fileName}`);
        try {
            // Update job status to processing_source
            await this.ingestionJobModel.update(job.id, {
                status: constants_1.INGESTION_STATUS.PROCESSING_SOURCE
            });
            await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.INITIALIZING, 0, 'Starting PDF processing');
            // Set up progress callback to intercept PDF service progress
            const progressCallback = (progress) => {
                // Map PDF service progress to standardized stages
                const { stage, percent, message } = this.mapPdfProgressToJobProgress(progress, fileName);
                // Use base class method for consistent progress updates
                this.updateProgress(job.id, stage, percent, message);
            };
            // Set the callback
            this.pdfIngestionService.setProgressCallback(progressCallback);
            // Extract file size from jobSpecificData with type safety
            const jobData = (0, types_1.getPdfJobData)(job.jobSpecificData);
            const fileSize = jobData.fileSize;
            // Call the existing PDF ingestion service
            const result = await this.pdfIngestionService.processPdf(filePath, fileName, fileSize);
            if (result.success) {
                // Mark job as completed
                await this.ingestionJobModel.markAsCompleted(job.id, result.objectId);
                logger_1.logger.info(`[${this.workerName}] Successfully completed job ${job.id}, object ${result.objectId}`);
            }
            else {
                // Use base class error handling
                await this.handleJobFailure(job, {
                    name: result.status || 'PDF_PROCESSING_FAILED',
                    message: result.error || 'PDF processing failed',
                    statusCode: this.mapPdfErrorToHttpStatus(result.status)
                }, {
                    fileName,
                    pdfStatus: result.status
                });
            }
        }
        catch (error) {
            // Use base class error handling for unexpected errors
            await this.handleJobFailure(job, error, {
                fileName,
                stage: 'unexpected'
            });
        }
        finally {
            // Clear the progress callback
            this.pdfIngestionService.setProgressCallback(null);
        }
    }
    mapPdfProgressToJobProgress(progress, defaultFileName) {
        let stage = constants_1.PROGRESS_STAGES.PROCESSING;
        let percent = 0;
        let message = progress.fileName || defaultFileName;
        if (progress.status) {
            switch (progress.status) {
                case 'starting_processing':
                    stage = constants_1.PROGRESS_STAGES.PROCESSING;
                    percent = 10;
                    message = 'Processing PDF file';
                    break;
                case 'parsing_text':
                    stage = constants_1.PROGRESS_STAGES.PARSING;
                    percent = 30;
                    message = 'Extracting text from PDF';
                    break;
                case 'generating_summary':
                    stage = constants_1.PROGRESS_STAGES.SUMMARIZING;
                    percent = 50;
                    message = 'Generating AI summary';
                    break;
                case 'saving_metadata':
                    stage = constants_1.PROGRESS_STAGES.PERSISTING;
                    percent = 70;
                    message = 'Saving metadata';
                    break;
                case 'creating_embeddings':
                    stage = constants_1.PROGRESS_STAGES.VECTORIZING;
                    percent = 85;
                    message = 'Creating embeddings';
                    break;
                case 'complete':
                    stage = constants_1.PROGRESS_STAGES.FINALIZING;
                    percent = 100;
                    message = 'Import completed';
                    break;
                case 'duplicate':
                    stage = constants_1.PROGRESS_STAGES.FINALIZING;
                    percent = 100;
                    message = 'File already processed';
                    break;
                case 'error':
                    stage = constants_1.PROGRESS_STAGES.ERROR;
                    message = progress.error || 'Processing failed';
                    break;
            }
        }
        return { stage, percent, message };
    }
    mapPdfErrorToHttpStatus(pdfErrorStatus) {
        // Map PDF-specific errors to HTTP-like status codes for error classification
        const errorMap = {
            'FILE_TOO_LARGE': 413, // Payload Too Large
            'UNSUPPORTED_MIME_TYPE': 415, // Unsupported Media Type
            'TEXT_EXTRACTION_FAILED': 422, // Unprocessable Entity
            'AI_PROCESSING_FAILED': 503, // Service Unavailable (possibly transient)
            'DATABASE_ERROR': 503, // Service Unavailable (possibly transient)
            'STORAGE_FAILED': 507, // Insufficient Storage
            'DUPLICATE_FILE': 409 // Conflict
        };
        return pdfErrorStatus ? errorMap[pdfErrorStatus] : undefined;
    }
}
exports.PdfIngestionWorker = PdfIngestionWorker;
//# sourceMappingURL=PdfIngestionWorker.js.map