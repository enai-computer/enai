import { app } from 'electron';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { Document } from "@langchain/core/documents";
// pdf-parse will be dynamically imported when needed to avoid test file loading
import { logger } from '../utils/logger';
import { PDF_INGEST_PROGRESS } from '../shared/ipcChannels';
import { ObjectModel } from '../models/ObjectModel';
import { ChunkSqlModel } from '../models/ChunkModel';
import { EmbeddingSqlModel } from '../models/EmbeddingModel';
import { ChromaVectorModel } from '../models/ChromaVectorModel';
import type { 
  PdfIngestionError, 
  PdfIngestionResult, 
  PdfIngestionStatus,
  PdfIngestProgressPayload,
  JeffersObject
} from '../shared/types';
import type { BrowserWindow } from 'electron';
import type { Database } from 'better-sqlite3';

// Constants
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const EMBEDDING_MODEL_NAME = 'text-embedding-3-small';
const LLM_MODEL_NAME = process.env.OPENAI_MODEL_NAME || 'gpt-4o-mini';
const LLM_TIMEOUT_MS = 60_000; // 60 seconds for AI processing

// AI output schema
interface AiGeneratedContent {
  title: string;
  summary: string;
  tags: string[];
}

// PDF loader type - will be implemented with appropriate library
interface PdfDocument {
  pageContent: string;
  metadata?: Record<string, any>;
}

export class PdfIngestionService {
  private objectModel: ObjectModel;
  private chunkSqlModel: ChunkSqlModel;
  private embeddingSqlModel: EmbeddingSqlModel;
  private chromaVectorModel: ChromaVectorModel;
  private llm: ChatOpenAI;
  private pdfStorageDir: string;
  private mainWindow: BrowserWindow | null = null;

  constructor(
    objectModel: ObjectModel,
    chunkSqlModel: ChunkSqlModel,
    chromaVectorModel: ChromaVectorModel,
    embeddingSqlModel: EmbeddingSqlModel,
    mainWindow?: BrowserWindow
  ) {
    this.objectModel = objectModel;
    this.chunkSqlModel = chunkSqlModel;
    this.chromaVectorModel = chromaVectorModel;
    this.embeddingSqlModel = embeddingSqlModel;
    this.mainWindow = mainWindow || null;
    
    // Initialize LLM
    this.llm = new ChatOpenAI({
      modelName: LLM_MODEL_NAME,
      temperature: 0.1,
      timeout: LLM_TIMEOUT_MS,
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    // Set up PDF storage directory
    this.pdfStorageDir = path.join(app.getPath('userData'), 'pdfs');
    this.ensureStorageDir();
  }

  /**
   * Set the main window for sending progress updates
   */
  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  /**
   * Ensure the PDF storage directory exists
   */
  private async ensureStorageDir(): Promise<void> {
    try {
      await fs.mkdir(this.pdfStorageDir, { recursive: true });
    } catch (error) {
      logger.error('[PdfIngestionService] Failed to create PDF storage directory:', error);
      throw error;
    }
  }

  /**
   * Send progress update to renderer
   */
  private sendProgress(payload: Partial<PdfIngestProgressPayload>): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(PDF_INGEST_PROGRESS, payload);
    }
  }

  /**
   * Calculate SHA256 hash of a file
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath);
    const hash = createHash('sha256');
    hash.update(fileBuffer);
    return hash.digest('hex');
  }

  /**
   * Extract text from PDF using pdf-parse (Node.js native solution)
   * Note: In production, you might want to use pdf.js or similar
   */
  private async extractPdfText(filePath: string): Promise<PdfDocument[]> {
    try {
      // Read the PDF file
      const dataBuffer = await fs.readFile(filePath);
      
      // Workaround for pdf-parse test file issue
      // Create a dummy fs module that returns empty for the test file
      const originalReadFileSync = require('fs').readFileSync;
      require('fs').readFileSync = function(path: string, ...args: any[]) {
        if (path.includes('test/data/05-versions-space.pdf')) {
          return Buffer.from(''); // Return empty buffer for test file
        }
        return originalReadFileSync.apply(this, [path, ...args]);
      };
      
      let data;
      try {
        const pdfParse = require('pdf-parse');
        data = await pdfParse(dataBuffer);
      } finally {
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
    } catch (error) {
      logger.error('[PdfIngestionService] Failed to extract PDF text:', error);
      throw new Error('TEXT_EXTRACTION_FAILED');
    }
  }

  /**
   * Generate title, summary, and tags using LLM
   */
  private async generateAiContent(text: string): Promise<AiGeneratedContent> {
    const systemPrompt = `You are an expert document analyst. Based on the following text extracted from a PDF document, please perform the following tasks:
1. Generate a concise and informative title for the document.
2. Write a comprehensive summary of the document's key information and arguments (approximately 200-400 words).
3. Provide a list of 5-7 relevant keywords or tags as a JSON array of strings.

Return your response as a single JSON object with the keys: "title", "summary", and "tags".`;

    try {
      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(`Document Text:\n${text.substring(0, 50000)}`) // Limit text length
      ];

      const parser = new JsonOutputParser<AiGeneratedContent>();
      const response = await this.llm.invoke(messages);
      const content = await parser.parse(response.content as string);
      
      return content;
    } catch (error) {
      logger.error('[PdfIngestionService] Failed to generate AI content:', error);
      throw new Error('AI_PROCESSING_FAILED');
    }
  }

  /**
   * Main method to process a PDF file
   */
  async processPdf(
    originalFilePath: string, 
    originalFileName: string,
    fileSize?: number
  ): Promise<PdfIngestionResult> {
    let fileHash: string | null = null;
    let internalFilePath: string | null = null;

    try {
      // Initial checks
      if (!fileSize) {
        const stats = await fs.stat(originalFilePath);
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
          status: 'FILE_TOO_LARGE' as PdfIngestionError,
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
          status: 'UNSUPPORTED_MIME_TYPE' as PdfIngestionError,
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
          logger.info(`[PdfIngestionService] Found failed PDF, allowing re-process: ${originalFileName}`);
          // Delete the failed object and its chunks to start fresh
          await this.objectModel.deleteObject(existingObject.id);
        } else {
          logger.info(`[PdfIngestionService] Duplicate PDF detected: ${originalFileName}`);
          this.sendProgress({
            fileName: originalFileName,
            filePath: originalFilePath,
            status: 'duplicate',
            objectId: existingObject.id
          });
          return { 
            success: true, 
            objectId: existingObject.id,
            status: 'DUPLICATE_FILE' as PdfIngestionError
          };
        }
      }

      // Copy file to storage
      internalFilePath = path.join(this.pdfStorageDir, `${fileHash}.pdf`);
      await fs.copyFile(originalFilePath, internalFilePath);

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
      let vectorId: string;
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
        logger.debug('[PdfIngestionService] Sending to ChromaDB:', {
          contentLength: aiResult.summary.length,
          metadata: metadata
        });
        
        const vectorIds = await this.chromaVectorModel.addDocuments([
          new Document({
            pageContent: aiResult.summary,
            metadata: metadata
          })
        ]);
        vectorId = vectorIds[0];
      } catch (chromaError) {
        logger.error('[PdfIngestionService] Failed to add to ChromaDB:', chromaError);
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

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[PdfIngestionService] Failed to process PDF ${originalFileName}:`, error);
      
      // Clean up copied file if it exists
      if (internalFilePath) {
        try {
          await fs.unlink(internalFilePath);
        } catch (unlinkError) {
          logger.warn('[PdfIngestionService] Failed to clean up copied file:', unlinkError);
        }
      }

      this.sendProgress({
        fileName: originalFileName,
        filePath: originalFilePath,
        status: 'error',
        error: errorMessage
      });

      // Map error messages to error types
      let errorType: PdfIngestionError = 'STORAGE_FAILED' as PdfIngestionError;
      if (errorMessage === 'TEXT_EXTRACTION_FAILED') {
        errorType = 'TEXT_EXTRACTION_FAILED' as PdfIngestionError;
      } else if (errorMessage === 'AI_PROCESSING_FAILED') {
        errorType = 'AI_PROCESSING_FAILED' as PdfIngestionError;
      }

      return { 
        success: false, 
        status: errorType,
        error: errorMessage
      };
    }
  }
}

// Factory function
export const createPdfIngestionService = (
  db: Database,
  chromaVectorModel: ChromaVectorModel,
  mainWindow?: BrowserWindow
): PdfIngestionService => {
  // Manually instantiate models needed by PdfIngestionService constructor
  const objectModel = new ObjectModel(db);
  const chunkSqlModel = new ChunkSqlModel(db);
  const embeddingSqlModel = new EmbeddingSqlModel(db);
  
  return new PdfIngestionService(
    objectModel, 
    chunkSqlModel, 
    chromaVectorModel, 
    embeddingSqlModel, 
    mainWindow
  );
};