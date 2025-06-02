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
exports.PdfIngestionWorker = void 0;
const logger_1 = require("../../utils/logger");
const BaseIngestionWorker_1 = require("./BaseIngestionWorker");
const constants_1 = require("./constants");
const types_1 = require("./types");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const electron_1 = require("electron");
const EMBEDDING_MODEL_NAME = 'text-embedding-3-small';
class PdfIngestionWorker extends BaseIngestionWorker_1.BaseIngestionWorker {
    constructor(pdfIngestionService, objectModel, chunkSqlModel, embeddingSqlModel, chromaVectorModel, llmService, ingestionJobModel, mainWindow) {
        super(ingestionJobModel, 'PdfIngestionWorker');
        this.pdfIngestionService = pdfIngestionService;
        this.objectModel = objectModel;
        this.chunkSqlModel = chunkSqlModel;
        this.embeddingSqlModel = embeddingSqlModel;
        this.chromaVectorModel = chromaVectorModel;
        this.llmService = llmService;
        this.mainWindow = mainWindow;
        // Set up PDF storage directory
        this.pdfStorageDir = path.join(electron_1.app.getPath('userData'), 'pdfs');
        this.ensureStorageDir();
    }
    /**
     * Ensure the PDF storage directory exists
     */
    async ensureStorageDir() {
        try {
            await fs_1.promises.mkdir(this.pdfStorageDir, { recursive: true });
        }
        catch (error) {
            logger_1.logger.error('[PdfIngestionWorker] Failed to create PDF storage directory:', error);
        }
    }
    /**
     * Calculate SHA256 hash of a file
     */
    async calculateFileHash(filePath) {
        const fileBuffer = await fs_1.promises.readFile(filePath);
        const hash = (0, crypto_1.createHash)('sha256');
        hash.update(fileBuffer);
        return hash.digest('hex');
    }
    async execute(job) {
        const filePath = job.sourceIdentifier;
        const fileName = job.originalFileName || filePath.split('/').pop() || 'unknown.pdf';
        logger_1.logger.info(`[${this.workerName}] Processing PDF job ${job.id}: ${fileName}`);
        let objectId = null;
        let internalFilePath = null;
        try {
            // Update job status to processing_source
            await this.ingestionJobModel.update(job.id, {
                status: constants_1.INGESTION_STATUS.PROCESSING_SOURCE
            });
            await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.INITIALIZING, 0, 'Starting PDF processing');
            // Extract file size from jobSpecificData
            const jobData = (0, types_1.getPdfJobData)(job.jobSpecificData);
            const fileSize = jobData.fileSize;
            // Calculate file hash for deduplication
            const fileHash = await this.calculateFileHash(filePath);
            // Check for duplicates
            const existingObject = await this.objectModel.findByFileHash(fileHash);
            if (existingObject) {
                if (existingObject.status === constants_1.OBJECT_STATUS.EMBEDDING_FAILED ||
                    existingObject.status === constants_1.OBJECT_STATUS.ERROR ||
                    existingObject.status === constants_1.OBJECT_STATUS.EMBEDDING_IN_PROGRESS) {
                    logger_1.logger.info(`[${this.workerName}] Found failed PDF, allowing re-process: ${fileName}`);
                    await this.objectModel.deleteObject(existingObject.id);
                }
                else {
                    logger_1.logger.info(`[${this.workerName}] Duplicate PDF detected: ${fileName}`);
                    await this.ingestionJobModel.update(job.id, {
                        status: 'completed',
                        relatedObjectId: existingObject.id
                    });
                    await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.FINALIZING, 100, 'File already processed');
                    return;
                }
            }
            // Copy file to storage
            internalFilePath = path.join(this.pdfStorageDir, `${fileHash}.pdf`);
            await fs_1.promises.copyFile(filePath, internalFilePath);
            // Step 1: Create object early to get UUID
            await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.PROCESSING, 10, 'Creating object record');
            const newObject = await this.objectModel.create({
                objectType: 'pdf_document',
                sourceUri: fileName,
                title: null, // Will be updated after AI generation
                status: constants_1.OBJECT_STATUS.NEW,
                rawContentRef: null,
                parsedContentJson: null,
                cleanedText: null,
                errorInfo: null,
                parsedAt: undefined,
                // PDF-specific fields
                fileHash: fileHash,
                originalFileName: fileName,
                fileSizeBytes: fileSize,
                fileMimeType: 'application/pdf',
                internalFilePath: internalFilePath,
                aiGeneratedMetadata: null,
                // Object-level summary fields
                summary: null,
                propositionsJson: null,
                tagsJson: null,
                summaryGeneratedAt: null,
            });
            objectId = newObject.id;
            logger_1.logger.info(`[${this.workerName}] Created object ${objectId} for PDF: ${fileName}`);
            // Update job with object ID
            await this.ingestionJobModel.update(job.id, {
                relatedObjectId: objectId
            });
            // Step 2: Extract text and generate AI content
            await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.PARSING, 30, 'Extracting text from PDF');
            await this.objectModel.update(objectId, {
                status: constants_1.OBJECT_STATUS.FETCHED
            });
            // Set up progress callback for PDF service
            const progressCallback = (progress) => {
                const { stage, percent, message } = this.mapPdfProgressToJobProgress(progress, fileName);
                this.updateProgress(job.id, stage, percent, message);
            };
            this.pdfIngestionService.setProgressCallback(progressCallback);
            let rawText;
            let aiContent;
            let pdfMetadata;
            try {
                const result = await this.pdfIngestionService.extractTextAndGenerateAiSummary(internalFilePath, objectId);
                rawText = result.rawText;
                aiContent = result.aiContent;
                pdfMetadata = result.pdfMetadata;
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                await this.objectModel.update(objectId, {
                    status: constants_1.OBJECT_STATUS.ERROR,
                    errorInfo: errorMessage
                });
                throw error;
            }
            finally {
                this.pdfIngestionService.setProgressCallback(null);
            }
            // Step 3: Transform propositions using shared utility
            await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.PERSISTING, 60, 'Saving document metadata');
            const transformedPropositions = BaseIngestionWorker_1.BaseIngestionWorker.transformPropositions(aiContent.propositions);
            // Step 4: Update object with AI-generated content
            await this.objectModel.update(objectId, {
                title: aiContent.title || fileName,
                status: constants_1.OBJECT_STATUS.PARSED,
                parsedContentJson: JSON.stringify({
                    aiGenerated: aiContent,
                    pdfMetadata: pdfMetadata
                }),
                cleanedText: rawText, // Store the full extracted text
                parsedAt: new Date(),
                errorInfo: null,
                aiGeneratedMetadata: JSON.stringify(aiContent),
                // Object-level summary fields
                summary: aiContent.summary,
                propositionsJson: JSON.stringify(transformedPropositions),
                tagsJson: JSON.stringify(aiContent.tags),
                summaryGeneratedAt: new Date(),
            });
            logger_1.logger.info(`[${this.workerName}] Updated object ${objectId} with AI content`);
            // Step 5: Create a single chunk for the PDF
            // ChunkingService will handle the embedding through its processPdfObject method
            await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.PERSISTING, 70, 'Creating content chunk');
            try {
                // Create a single chunk for the entire PDF
                // This maintains compatibility with the existing embedding system
                const chunk = await this.chunkSqlModel.addChunk({
                    objectId: objectId,
                    chunkIdx: 0, // Single chunk for PDFs
                    content: aiContent.summary, // Use the summary as the chunk content
                    summary: null, // The content IS the summary, avoid duplication
                    tagsJson: null, // Tags are on the object level
                    propositionsJson: null, // Propositions are on the object level
                    tokenCount: null,
                    notebookId: null,
                });
                logger_1.logger.debug(`[${this.workerName}] Created chunk ${chunk.id} for PDF object ${objectId}`);
                // Update object status to indicate it's ready for embedding
                await this.objectModel.update(objectId, {
                    status: constants_1.OBJECT_STATUS.PARSED
                });
                logger_1.logger.info(`[${this.workerName}] PDF object ${objectId} ready for embedding by ChunkingService`);
            }
            catch (error) {
                logger_1.logger.error(`[${this.workerName}] Failed to create chunk for object ${objectId}:`, error);
                await this.objectModel.update(objectId, {
                    status: constants_1.OBJECT_STATUS.ERROR,
                    errorInfo: error instanceof Error ? error.message : 'Chunk creation failed'
                });
                throw error;
            }
            // Mark job as vectorizing so ChunkingService can process it
            await this.ingestionJobModel.update(job.id, {
                status: 'vectorizing',
                chunking_status: 'pending'
            });
            await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.FINALIZING, 90, 'PDF processed, ready for embedding');
            logger_1.logger.info(`[${this.workerName}] PDF job ${job.id} processed, object ${objectId} ready for chunking/embedding`);
        }
        catch (error) {
            // Clean up internal file if object creation failed
            if (internalFilePath && !objectId) {
                try {
                    await fs_1.promises.unlink(internalFilePath);
                }
                catch (unlinkError) {
                    logger_1.logger.warn(`[${this.workerName}] Failed to clean up copied file:`, unlinkError);
                }
            }
            // Use base class error handling
            await this.handleJobFailure(job, error, {
                fileName,
                objectId,
                stage: job.status
            });
        }
    }
    mapPdfProgressToJobProgress(progress, defaultFileName) {
        let stage = constants_1.PROGRESS_STAGES.PROCESSING;
        let percent = 0;
        let message = progress.fileName || defaultFileName;
        if (progress.status) {
            switch (progress.status) {
                case 'parsing_text':
                    stage = constants_1.PROGRESS_STAGES.PARSING;
                    percent = 40;
                    message = 'Extracting text from PDF';
                    break;
                case 'generating_summary':
                    stage = constants_1.PROGRESS_STAGES.SUMMARIZING;
                    percent = 50;
                    message = 'Generating AI summary';
                    break;
                case 'error':
                    stage = constants_1.PROGRESS_STAGES.ERROR;
                    message = progress.error || 'Processing failed';
                    break;
            }
        }
        return { stage, percent, message };
    }
}
exports.PdfIngestionWorker = PdfIngestionWorker;
//# sourceMappingURL=PdfIngestionWorker.js.map