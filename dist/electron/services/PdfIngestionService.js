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
exports.createPdfIngestionService = exports.PdfIngestionService = void 0;
const electron_1 = require("electron");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const messages_1 = require("@langchain/core/messages");
const output_parsers_1 = require("@langchain/core/output_parsers");
// pdf-parse will be dynamically imported when needed to avoid test file loading
const logger_1 = require("../utils/logger");
const ObjectModel_1 = require("../models/ObjectModel");
const ChunkModel_1 = require("../models/ChunkModel");
const EmbeddingModel_1 = require("../models/EmbeddingModel");
const db_1 = require("../models/db");
const aiSchemas_1 = require("../shared/schemas/aiSchemas");
const pdfSchemas_1 = require("../shared/schemas/pdfSchemas");
const constants_1 = require("../services/ingestion/constants");
// Constants
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const EMBEDDING_MODEL_NAME = 'text-embedding-3-small';
class PdfIngestionService {
    constructor(objectModel, chunkSqlModel, chromaVectorModel, embeddingSqlModel, llmService) {
        this.progressCallback = null;
        this.objectModel = objectModel;
        this.chunkSqlModel = chunkSqlModel;
        this.chromaVectorModel = chromaVectorModel;
        this.embeddingSqlModel = embeddingSqlModel;
        this.llmService = llmService;
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
            logger_1.logger.error('[PdfIngestionService] Failed to create PDF storage directory:', error);
            throw error;
        }
    }
    /**
     * Set a callback to receive progress updates
     * Used by the queue system to intercept progress
     */
    setProgressCallback(callback) {
        this.progressCallback = callback;
    }
    /**
     * Send progress update via callback
     */
    sendProgress(payload) {
        if (this.progressCallback) {
            this.progressCallback(payload);
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
    /**
     * Extract text from PDF using pdf-parse (Node.js native solution)
     * Note: In production, you might want to use pdf.js or similar
     */
    async extractPdfText(filePath) {
        try {
            // Read the PDF file
            const dataBuffer = await fs_1.promises.readFile(filePath);
            let data;
            // Skip workaround in test environment to avoid conflicts with mocks
            if (process.env.NODE_ENV === 'test') {
                const pdfParse = require('pdf-parse');
                data = await pdfParse(dataBuffer);
            }
            else {
                // Workaround for pdf-parse test file issue (production only)
                const originalReadFileSync = require('fs').readFileSync;
                require('fs').readFileSync = function (path, ...args) {
                    if (path.includes('test/data/05-versions-space.pdf')) {
                        return Buffer.from(''); // Return empty buffer for test file
                    }
                    return originalReadFileSync.apply(this, [path, ...args]);
                };
                try {
                    const pdfParse = require('pdf-parse');
                    data = await pdfParse(dataBuffer);
                }
                finally {
                    // Restore original fs.readFileSync
                    require('fs').readFileSync = originalReadFileSync;
                }
            }
            // Validate the extracted document
            const document = {
                pageContent: data.text || '',
                metadata: {
                    numpages: data.numpages,
                    info: data.info,
                    metadata: data.metadata,
                    version: data.version
                }
            };
            const validationResult = pdfSchemas_1.PdfDocumentSchema.safeParse(document);
            if (!validationResult.success) {
                logger_1.logger.warn('[PdfIngestionService] PDF document validation warning:', validationResult.error);
                // Continue with unvalidated data but log the issue
            }
            return [validationResult.success ? validationResult.data : document];
        }
        catch (error) {
            logger_1.logger.error('[PdfIngestionService] Failed to extract PDF text:', error);
            throw new Error('TEXT_EXTRACTION_FAILED');
        }
    }
    /**
     * Generate title, summary, and tags using LLM with validation
     */
    async generateAiContent(text) {
        const systemPrompt = `You are an expert document analyst. Based on the following text extracted from a PDF document, please perform the following tasks:
1. Generate a concise and informative title for the document.
2. Write a comprehensive summary of the document's key information and arguments (approximately 200-400 words).
3. Provide a list of 5-7 relevant keywords or tags as a JSON array of strings.
4. Extract key propositions (main claims, supporting details, and actionable items) as an array of objects with "type" (main/supporting/action) and "content" fields.

Return your response as a single JSON object with the keys: "title", "summary", "tags", and "propositions".`;
        try {
            const messages = [
                new messages_1.SystemMessage(systemPrompt),
                new messages_1.HumanMessage(`Document Text:\n${text.substring(0, 50000)}`) // Limit text length
            ];
            const response = await this.llmService.generateChatResponse(messages, {
                userId: 'system',
                taskType: 'summarization',
                priority: 'balanced_throughput'
            }, {
                temperature: 0.1,
                outputFormat: 'json_object',
                maxTokens: 2000
            });
            // Parse and validate the AI response
            const parsedContent = (0, aiSchemas_1.parseAiResponse)(response.content);
            if (!parsedContent) {
                // Fallback: try direct JSON parsing with validation
                logger_1.logger.warn('[PdfIngestionService] Failed to parse AI response with parseAiResponse, trying direct parse');
                const parser = new output_parsers_1.JsonOutputParser();
                const rawContent = await parser.parse(response.content);
                // Validate with schema
                const validationResult = aiSchemas_1.AiGeneratedContentSchema.safeParse(rawContent);
                if (!validationResult.success) {
                    logger_1.logger.error('[PdfIngestionService] AI response validation failed:', validationResult.error);
                    throw new Error('AI_RESPONSE_INVALID');
                }
                return validationResult.data;
            }
            return parsedContent;
        }
        catch (error) {
            logger_1.logger.error('[PdfIngestionService] Failed to generate AI content:', error);
            throw new Error('AI_PROCESSING_FAILED');
        }
    }
    /**
     * Main method to process a PDF file
     */
    async processPdf(originalFilePath, originalFileName, fileSize) {
        let fileHash = null;
        let internalFilePath = null;
        try {
            // Initial checks
            if (!fileSize) {
                const stats = await fs_1.promises.stat(originalFilePath);
                fileSize = stats.size;
            }
            if (fileSize > MAX_FILE_SIZE_BYTES) {
                this.sendProgress({
                    fileName: originalFileName,
                    filePath: originalFilePath,
                    status: 'error',
                    error: 'File too large'
                });
                return {
                    success: false,
                    status: 'FILE_TOO_LARGE',
                    error: `File size ${fileSize} bytes exceeds maximum ${MAX_FILE_SIZE_BYTES} bytes`
                };
            }
            // Check MIME type (basic check)
            if (!originalFileName.toLowerCase().endsWith('.pdf')) {
                this.sendProgress({
                    fileName: originalFileName,
                    filePath: originalFilePath,
                    status: 'error',
                    error: 'Not a PDF file'
                });
                return {
                    success: false,
                    status: 'UNSUPPORTED_MIME_TYPE',
                    error: 'File must be a PDF'
                };
            }
            // Send initial progress
            this.sendProgress({
                fileName: originalFileName,
                filePath: originalFilePath,
                status: 'starting_processing'
            });
            // Calculate file hash
            fileHash = await this.calculateFileHash(originalFilePath);
            // Check for duplicates
            const existingObject = await this.objectModel.findByFileHash(fileHash);
            if (existingObject) {
                // Allow re-processing if previous attempt failed
                if (existingObject.status === constants_1.OBJECT_STATUS.EMBEDDING_FAILED ||
                    existingObject.status === constants_1.OBJECT_STATUS.ERROR ||
                    existingObject.status === constants_1.OBJECT_STATUS.EMBEDDING_IN_PROGRESS) {
                    logger_1.logger.info(`[PdfIngestionService] Found failed PDF, allowing re-process: ${originalFileName}`);
                    // Delete the failed object and its chunks to start fresh
                    await this.objectModel.deleteObject(existingObject.id);
                }
                else {
                    logger_1.logger.info(`[PdfIngestionService] Duplicate PDF detected: ${originalFileName}`);
                    this.sendProgress({
                        fileName: originalFileName,
                        filePath: originalFilePath,
                        status: 'duplicate',
                        objectId: existingObject.id
                    });
                    return {
                        success: true,
                        objectId: existingObject.id,
                        status: 'DUPLICATE_FILE'
                    };
                }
            }
            // Copy file to storage
            internalFilePath = path.join(this.pdfStorageDir, `${fileHash}.pdf`);
            await fs_1.promises.copyFile(originalFilePath, internalFilePath);
            // Extract text
            this.sendProgress({
                fileName: originalFileName,
                filePath: originalFilePath,
                status: 'parsing_text'
            });
            const docs = await this.extractPdfText(internalFilePath);
            const rawText = docs.map(doc => doc.pageContent).join('\n\n');
            if (!rawText || rawText.trim().length < 50) {
                throw new Error('TEXT_EXTRACTION_FAILED');
            }
            // Generate AI content
            this.sendProgress({
                fileName: originalFileName,
                filePath: originalFilePath,
                status: 'generating_summary'
            });
            const aiResult = await this.generateAiContent(rawText);
            // Save to database
            this.sendProgress({
                fileName: originalFileName,
                filePath: originalFilePath,
                status: 'saving_metadata'
            });
            // Perform atomic database operations within a transaction
            logger_1.logger.info('[PdfIngestionService] Starting database transaction for PDF ingestion');
            let newObject;
            let chunkId;
            try {
                const db = (0, db_1.getDb)();
                // Use transaction with synchronous model methods
                const createPdfTransaction = db.transaction(() => {
                    logger_1.logger.debug('[PdfIngestionService] Transaction: Creating object via model');
                    // Convert propositions to ObjectPropositions format
                    const propositions = aiResult.propositions ? {
                        main: aiResult.propositions.filter(p => p.type === 'main').map(p => p.content),
                        supporting: aiResult.propositions.filter(p => p.type === 'supporting').map(p => p.content),
                        actions: aiResult.propositions.filter(p => p.type === 'action').map(p => p.content)
                    } : { main: [], supporting: [] };
                    // Use synchronous model method
                    const createdObject = this.objectModel.createSync({
                        objectType: 'pdf_document',
                        sourceUri: originalFileName,
                        title: aiResult.title || originalFileName,
                        status: constants_1.OBJECT_STATUS.PARSED,
                        rawContentRef: null,
                        parsedContentJson: JSON.stringify({
                            aiGenerated: aiResult,
                            pdfMetadata: docs[0]?.metadata || {}
                        }),
                        cleanedText: aiResult.summary,
                        errorInfo: null,
                        parsedAt: new Date(),
                        // PDF-specific fields
                        fileHash: fileHash,
                        originalFileName: originalFileName,
                        fileSizeBytes: fileSize,
                        fileMimeType: 'application/pdf',
                        internalFilePath: internalFilePath,
                        aiGeneratedMetadata: JSON.stringify(aiResult),
                        // Object-level summary fields
                        summary: aiResult.summary,
                        propositionsJson: JSON.stringify(propositions),
                        tagsJson: JSON.stringify(aiResult.tags),
                        summaryGeneratedAt: new Date(),
                    });
                    logger_1.logger.debug('[PdfIngestionService] Transaction: Creating chunk via model');
                    // Use synchronous model method
                    // For PDFs, the chunk content IS the summary, so we don't duplicate data
                    const createdChunk = this.chunkSqlModel.addChunkSync({
                        objectId: createdObject.id,
                        chunkIdx: 0,
                        content: aiResult.summary,
                        summary: null, // The content IS the summary, avoid duplication
                        tagsJson: null, // Tags are on the object level
                        propositionsJson: null, // Propositions are on the object level
                        tokenCount: null,
                        notebookId: null,
                    });
                    return { object: createdObject, chunkId: createdChunk.id };
                });
                // Execute transaction and get results
                const transactionResult = createPdfTransaction();
                newObject = transactionResult.object;
                chunkId = transactionResult.chunkId;
                logger_1.logger.info(`[PdfIngestionService] Transaction completed successfully. Object ID: ${newObject.id}, Chunk ID: ${chunkId}`);
            }
            catch (transactionError) {
                logger_1.logger.error('[PdfIngestionService] Database transaction failed:', transactionError);
                throw new Error('DATABASE_ERROR');
            }
            // ChunkingService will handle embedding from here
            logger_1.logger.info(`[PdfIngestionService] Successfully processed PDF. Object ${newObject.id} ready for embedding by ChunkingService`);
            // Send completion
            this.sendProgress({
                fileName: originalFileName,
                filePath: originalFilePath,
                status: 'complete',
                objectId: newObject.id
            });
            return {
                success: true,
                objectId: newObject.id,
                status: 'completed'
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger_1.logger.error(`[PdfIngestionService] Failed to process PDF ${originalFileName}:`, error);
            // Clean up copied file if it exists
            if (internalFilePath) {
                try {
                    await fs_1.promises.unlink(internalFilePath);
                }
                catch (unlinkError) {
                    logger_1.logger.warn('[PdfIngestionService] Failed to clean up copied file:', unlinkError);
                }
            }
            this.sendProgress({
                fileName: originalFileName,
                filePath: originalFilePath,
                status: 'error',
                error: errorMessage
            });
            // Map error messages to error types
            let errorType = 'STORAGE_FAILED';
            if (errorMessage === 'TEXT_EXTRACTION_FAILED') {
                errorType = 'TEXT_EXTRACTION_FAILED';
            }
            else if (errorMessage === 'AI_PROCESSING_FAILED') {
                errorType = 'AI_PROCESSING_FAILED';
            }
            else if (errorMessage === 'DATABASE_ERROR') {
                errorType = 'DATABASE_ERROR';
            }
            return {
                success: false,
                status: errorType,
                error: errorMessage
            };
        }
    }
}
exports.PdfIngestionService = PdfIngestionService;
// Factory function
const createPdfIngestionService = (db, chromaVectorModel, llmService) => {
    // Manually instantiate models needed by PdfIngestionService constructor
    const objectModel = new ObjectModel_1.ObjectModel(db);
    const chunkSqlModel = new ChunkModel_1.ChunkSqlModel(db);
    const embeddingSqlModel = new EmbeddingModel_1.EmbeddingSqlModel(db);
    return new PdfIngestionService(objectModel, chunkSqlModel, chromaVectorModel, embeddingSqlModel, llmService);
};
exports.createPdfIngestionService = createPdfIngestionService;
//# sourceMappingURL=PdfIngestionService.js.map