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
const fs_1 = require("fs");
const path = __importStar(require("path"));
const OpenAiAgent_1 = require("./agents/OpenAiAgent");
// pdf-parse will be dynamically imported when needed to avoid test file loading
const logger_1 = require("../utils/logger");
const pdfSchemas_1 = require("../shared/schemas/pdfSchemas");
class PdfIngestionService {
    constructor(llmService) {
        this.progressCallback = null;
        this.llmService = llmService;
        this.openAiAgent = new OpenAiAgent_1.OpenAiAgent(llmService);
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
     * Extract text and generate AI summary without persistence
     * For use by PdfIngestionWorker which handles persistence
     */
    async extractTextAndGenerateAiSummary(filePath, objectId) {
        try {
            // Extract text
            const docs = await this.extractPdfText(filePath);
            const rawText = docs.map(doc => doc.pageContent).join('\n\n');
            if (!rawText || rawText.trim().length < 50) {
                throw new Error('TEXT_EXTRACTION_FAILED');
            }
            // Generate AI content using the standardized method
            const originalFileName = path.basename(filePath);
            const aiContent = await this.openAiAgent.generateObjectSummary(rawText, originalFileName, objectId);
            return {
                rawText,
                aiContent,
                pdfMetadata: docs[0]?.metadata || {}
            };
        }
        catch (error) {
            logger_1.logger.error('[PdfIngestionService] Failed to extract text and generate summary:', error);
            throw error;
        }
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
}
exports.PdfIngestionService = PdfIngestionService;
// Factory function
const createPdfIngestionService = (llmService) => {
    return new PdfIngestionService(llmService);
};
exports.createPdfIngestionService = createPdfIngestionService;
//# sourceMappingURL=PdfIngestionService.js.map