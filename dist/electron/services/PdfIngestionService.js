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
const openai_1 = require("@langchain/openai");
const messages_1 = require("@langchain/core/messages");
const output_parsers_1 = require("@langchain/core/output_parsers");
const documents_1 = require("@langchain/core/documents");
// pdf-parse will be dynamically imported when needed to avoid test file loading
const logger_1 = require("../utils/logger");
const ipcChannels_1 = require("../shared/ipcChannels");
const ObjectModel_1 = require("../models/ObjectModel");
const ChunkModel_1 = require("../models/ChunkModel");
const EmbeddingModel_1 = require("../models/EmbeddingModel");
// Constants
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const EMBEDDING_MODEL_NAME = 'text-embedding-3-small';
const LLM_MODEL_NAME = process.env.OPENAI_MODEL_NAME || 'gpt-4o-mini';
const LLM_TIMEOUT_MS = 60_000; // 60 seconds for AI processing
class PdfIngestionService {
    constructor(objectModel, chunkSqlModel, chromaVectorModel, embeddingSqlModel, mainWindow) {
        this.mainWindow = null;
        this.objectModel = objectModel;
        this.chunkSqlModel = chunkSqlModel;
        this.chromaVectorModel = chromaVectorModel;
        this.embeddingSqlModel = embeddingSqlModel;
        this.mainWindow = mainWindow || null;
        // Initialize LLM
        this.llm = new openai_1.ChatOpenAI({
            modelName: LLM_MODEL_NAME,
            temperature: 0.1,
            timeout: LLM_TIMEOUT_MS,
            apiKey: process.env.OPENAI_API_KEY,
        });
        // Set up PDF storage directory
        this.pdfStorageDir = path.join(electron_1.app.getPath('userData'), 'pdfs');
        this.ensureStorageDir();
    }
    /**
     * Set the main window for sending progress updates
     */
    setMainWindow(window) {
        this.mainWindow = window;
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
     * Send progress update to renderer
     */
    sendProgress(payload) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(ipcChannels_1.PDF_INGEST_PROGRESS, payload);
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
            // Workaround for pdf-parse test file issue
            // Create a dummy fs module that returns empty for the test file
            const originalReadFileSync = require('fs').readFileSync;
            require('fs').readFileSync = function (path, ...args) {
                if (path.includes('test/data/05-versions-space.pdf')) {
                    return Buffer.from(''); // Return empty buffer for test file
                }
                return originalReadFileSync.apply(this, [path, ...args]);
            };
            let data;
            try {
                const pdfParse = require('pdf-parse');
                data = await pdfParse(dataBuffer);
            }
            finally {
                // Restore original fs.readFileSync
                require('fs').readFileSync = originalReadFileSync;
            }
            return [{
                    pageContent: data.text,
                    metadata: {
                        pages: data.numpages,
                        info: data.info,
                        metadata: data.metadata,
                    }
                }];
        }
        catch (error) {
            logger_1.logger.error('[PdfIngestionService] Failed to extract PDF text:', error);
            throw new Error('TEXT_EXTRACTION_FAILED');
        }
    }
    /**
     * Generate title, summary, and tags using LLM
     */
    async generateAiContent(text) {
        const systemPrompt = `You are an expert document analyst. Based on the following text extracted from a PDF document, please perform the following tasks:
1. Generate a concise and informative title for the document.
2. Write a comprehensive summary of the document's key information and arguments (approximately 200-400 words).
3. Provide a list of 5-7 relevant keywords or tags as a JSON array of strings.

Return your response as a single JSON object with the keys: "title", "summary", and "tags".`;
        try {
            const messages = [
                new messages_1.SystemMessage(systemPrompt),
                new messages_1.HumanMessage(`Document Text:\n${text.substring(0, 50000)}`) // Limit text length
            ];
            const parser = new output_parsers_1.JsonOutputParser();
            const response = await this.llm.invoke(messages);
            const content = await parser.parse(response.content);
            return content;
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
                if (existingObject.status === 'embedding_failed' ||
                    existingObject.status === 'error' ||
                    existingObject.status === 'embedding_in_progress') {
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
            const newObject = await this.objectModel.create({
                objectType: 'pdf_document',
                title: aiResult.title || originalFileName,
                sourceUri: originalFileName,
                status: 'embedding_in_progress',
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
            });
            // Create embedding
            this.sendProgress({
                fileName: originalFileName,
                filePath: originalFilePath,
                status: 'creating_embeddings'
            });
            // Create a single chunk for the summary
            const chunk = await this.chunkSqlModel.addChunk({
                objectId: newObject.id,
                chunkIdx: 0,
                content: aiResult.summary,
                summary: null, // The content IS the summary
                tagsJson: JSON.stringify(aiResult.tags),
                propositionsJson: null,
            });
            // Add to vector store
            let vectorId;
            try {
                // Ensure all metadata values are primitive types (string, number, boolean)
                const metadata = {
                    sqlChunkId: chunk.id.toString(), // Convert number to string
                    objectId: newObject.id, // string
                    chunkIdx: 0, // number
                    documentType: 'pdf_ai_summary', // string
                    title: String(newObject.title || '').substring(0, 500), // Ensure string and limit length
                    tags: aiResult.tags.join(', '), // Convert array to comma-separated string
                    originalFileName: String(originalFileName || '').substring(0, 255), // Ensure string and limit length
                    fileHash: String(fileHash || '') // Ensure string
                };
                // Debug: Log what we're sending to ChromaDB
                logger_1.logger.debug('[PdfIngestionService] Sending to ChromaDB:', {
                    contentLength: aiResult.summary.length,
                    metadata: metadata
                });
                const vectorIds = await this.chromaVectorModel.addDocuments([
                    new documents_1.Document({
                        pageContent: aiResult.summary,
                        metadata: metadata
                    })
                ]);
                vectorId = vectorIds[0];
            }
            catch (chromaError) {
                logger_1.logger.error('[PdfIngestionService] Failed to add to ChromaDB:', chromaError);
                // Update status to indicate embedding failed but PDF was processed
                await this.objectModel.updateStatus(newObject.id, 'embedding_failed');
                // Still return success since PDF was processed and saved
                return {
                    success: true,
                    objectId: newObject.id,
                    status: 'completed'
                };
            }
            // Link embedding
            await this.embeddingSqlModel.addEmbeddingRecord({
                chunkId: chunk.id,
                model: EMBEDDING_MODEL_NAME,
                vectorId: vectorId,
            });
            // Update status to pdf_processed to indicate successful PDF processing
            await this.objectModel.updateStatus(newObject.id, 'pdf_processed');
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
const createPdfIngestionService = (db, chromaVectorModel, mainWindow) => {
    // Manually instantiate models needed by PdfIngestionService constructor
    const objectModel = new ObjectModel_1.ObjectModel(db);
    const chunkSqlModel = new ChunkModel_1.ChunkSqlModel(db);
    const embeddingSqlModel = new EmbeddingModel_1.EmbeddingSqlModel(db);
    return new PdfIngestionService(objectModel, chunkSqlModel, chromaVectorModel, embeddingSqlModel, mainWindow);
};
exports.createPdfIngestionService = createPdfIngestionService;
//# sourceMappingURL=PdfIngestionService.js.map