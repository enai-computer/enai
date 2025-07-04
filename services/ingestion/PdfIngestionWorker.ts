import { logger } from '../../utils/logger';
import { IngestionJob, IngestionJobModel } from '../../models/IngestionJobModel';
import { ObjectModel } from '../../models/ObjectModel';
import { ChunkModel } from '../../models/ChunkModel';
import { EmbeddingModel } from '../../models/EmbeddingModel';
import { IVectorStoreModel } from '../../shared/types/vector.types';
import { PdfIngestionService, PdfProgressCallback } from './PdfIngestionService';
import { BaseIngestionWorker } from './BaseIngestionWorker';
import { INGESTION_STATUS, PROGRESS_STAGES, OBJECT_STATUS } from './constants';
import { getPdfJobData } from './types';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { JobStatus, ObjectPropositions } from '../../shared/types';
import type { BrowserWindow } from 'electron';

const EMBEDDING_MODEL_NAME = 'text-embedding-3-small';

export class PdfIngestionWorker extends BaseIngestionWorker {
  private pdfIngestionService: PdfIngestionService;
  protected objectModel: ObjectModel;
  private chunkModel: ChunkModel;
  private embeddingModel: EmbeddingModel;
  private vectorModel: IVectorStoreModel;
  private pdfStorageDir: string;
  private mainWindow?: BrowserWindow;

  constructor(
    pdfIngestionService: PdfIngestionService,
    objectModel: ObjectModel,
    chunkModel: ChunkModel,
    embeddingModel: EmbeddingModel,
    vectorModel: IVectorStoreModel,
    ingestionJobModel: IngestionJobModel,
    mainWindow?: BrowserWindow
  ) {
    super(ingestionJobModel, 'PdfIngestionWorker');
    this.pdfIngestionService = pdfIngestionService;
    this.objectModel = objectModel;
    this.chunkModel = chunkModel;
    this.embeddingModel = embeddingModel;
    this.vectorModel = vectorModel;
    this.mainWindow = mainWindow;
    
    // Set up PDF storage directory
    this.pdfStorageDir = path.join(app.getPath('userData'), 'pdfs');
    this.ensureStorageDir();
  }

  /**
   * Ensure the PDF storage directory exists
   */
  private async ensureStorageDir(): Promise<void> {
    try {
      await fs.mkdir(this.pdfStorageDir, { recursive: true });
    } catch (error) {
      logger.error('[PdfIngestionWorker] Failed to create PDF storage directory:', error);
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

  async execute(job: IngestionJob): Promise<void> {
    const filePath = job.sourceIdentifier;
    const fileName = job.originalFileName || filePath.split('/').pop() || 'unknown.pdf';
    
    logger.info(`[${this.workerName}] Processing PDF job ${job.id}: ${fileName}`);
    
    let objectId: string | null = null;
    let internalFilePath: string | null = null;
    let fileHash: string;
    let fileSize: number;
    
    try {
      // Update job status to processing_source
      await this.ingestionJobModel.update(job.id, {
        status: INGESTION_STATUS.PROCESSING_SOURCE
      });
      
      await this.updateProgress(job.id, PROGRESS_STAGES.INITIALIZING, 0, 'Starting PDF processing');

      // Extract file size from jobSpecificData
      const jobData = getPdfJobData(job.jobSpecificData);
      fileSize = jobData.fileSize || 0;

      // Calculate file hash for deduplication
      fileHash = await this.calculateFileHash(filePath);
      
      // Check for duplicates
      const existingObject = await this.objectModel.findByFileHash(fileHash);
      if (existingObject) {
        if (existingObject.status === OBJECT_STATUS.EMBEDDING_FAILED || 
            existingObject.status === OBJECT_STATUS.ERROR || 
            existingObject.status === OBJECT_STATUS.EMBEDDING_IN_PROGRESS) {
          logger.info(`[${this.workerName}] Found failed PDF, allowing re-process: ${fileName}`);
          this.objectModel.deleteById(existingObject.id);
        } else {
          logger.info(`[${this.workerName}] Duplicate PDF detected: ${fileName}`);
          await this.ingestionJobModel.update(job.id, {
            status: 'completed' as JobStatus,
            relatedObjectId: existingObject.id
          });
          await this.updateProgress(job.id, PROGRESS_STAGES.FINALIZING, 100, 'File already processed');
          return;
        }
      }

      // Copy file to storage
      internalFilePath = path.join(this.pdfStorageDir, `${fileHash}.pdf`);
      await fs.copyFile(filePath, internalFilePath);

      // Step 1: Create object early to get UUID
      await this.updateProgress(job.id, PROGRESS_STAGES.PROCESSING, 10, 'Creating object record');
      
      const newObject = await this.objectModel.create({
        objectType: 'pdf',
        sourceUri: fileName,
        title: null, // Will be updated after AI generation
        status: OBJECT_STATUS.NEW,
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
      logger.info(`[${this.workerName}] Created object ${objectId} for PDF: ${fileName}`);

      // Update job with object ID
      await this.ingestionJobModel.update(job.id, {
        relatedObjectId: objectId
      });

      // Step 2: Extract text and generate AI content
      await this.updateProgress(job.id, PROGRESS_STAGES.PARSING, 30, 'Extracting text from PDF');
      
      await this.objectModel.update(objectId, {
        status: OBJECT_STATUS.FETCHED
      });

      // Set up progress callback for PDF service
      const progressCallback: PdfProgressCallback = (progress) => {
        const { stage, percent, message } = this.mapPdfProgressToJobProgress(progress, fileName);
        this.updateProgress(job.id, stage, percent, message);
      };
      
      this.pdfIngestionService.setProgressCallback(progressCallback);

      let rawText: string;
      let aiContent: any;
      let pdfMetadata: any;

      try {
        // Update job status to AI_PROCESSING before generating summary
        await this.ingestionJobModel.update(job.id, { status: INGESTION_STATUS.AI_PROCESSING });
        
        const result = await this.pdfIngestionService.extractTextAndGenerateAiSummary(
          internalFilePath,
          objectId
        );
        rawText = result.rawText;
        aiContent = result.aiContent;
        pdfMetadata = result.pdfMetadata;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.objectModel.update(objectId, {
          status: OBJECT_STATUS.ERROR,
          errorInfo: errorMessage
        });
        throw error;
      } finally {
        this.pdfIngestionService.setProgressCallback(null);
      }

      // Step 3: Update object with AI-generated content using helper method
      await this.updateProgress(job.id, PROGRESS_STAGES.PERSISTING, 60, 'Saving document metadata');
      
      // Use the consolidated helper method to update the existing object
      await this._createOrUpdateObjectWithContent({
        jobId: job.id,
        objectId: objectId, // PDF worker always has an objectId by this point
        objectType: 'pdf',
        sourceIdentifier: fileName,
        title: aiContent.title || fileName,
        cleanedText: rawText,
        parsedContent: {
          aiGenerated: aiContent,
          pdfMetadata: pdfMetadata
        },
        summaryData: {
          summary: aiContent.summary,
          propositions: aiContent.propositions,
          tags: aiContent.tags
        },
        pdfSpecificData: {
          fileHash: fileHash,
          originalFileName: fileName,
          fileSizeBytes: fileSize,
          fileMimeType: 'application/pdf',
          internalFilePath: internalFilePath!,
          aiGeneratedMetadata: aiContent
        }
      });

      // Step 5: Create a single chunk for the PDF
      // ChunkingService will handle the embedding through its processPdfObject method
      await this.updateProgress(job.id, PROGRESS_STAGES.PERSISTING, 70, 'Creating content chunk');
      
      try {
        // Create a single chunk for the entire PDF
        // This maintains compatibility with the existing embedding system
        const chunk = await this.chunkModel.addChunk({
          objectId: objectId,
          chunkIdx: 0, // Single chunk for PDFs
          content: aiContent.summary, // Use the summary as the chunk content
          summary: null, // The content IS the summary, avoid duplication
          tagsJson: null, // Tags are on the object level
          propositionsJson: null, // Propositions are on the object level
          tokenCount: null,
          notebookId: null,
        });

        logger.debug(`[${this.workerName}] Created chunk ${chunk.id} for PDF object ${objectId}`);

        // Update object status to indicate it's ready for embedding
        await this.objectModel.update(objectId, {
          status: OBJECT_STATUS.PARSED
        });

        logger.info(`[${this.workerName}] PDF object ${objectId} ready for embedding by ChunkingService`);
      } catch (error) {
        logger.error(`[${this.workerName}] Failed to create chunk for object ${objectId}:`, error);
        await this.objectModel.update(objectId, {
          status: OBJECT_STATUS.ERROR,
          errorInfo: error instanceof Error ? error.message : 'Chunk creation failed'
        });
        throw error;
      }

      await this.updateProgress(job.id, PROGRESS_STAGES.FINALIZING, 90, 'PDF processed, ready for embedding');
      logger.info(`[${this.workerName}] PDF job ${job.id} processed, object ${objectId} ready for chunking/embedding`);

    } catch (error: any) {
      // Clean up internal file if object creation failed
      if (internalFilePath && !objectId) {
        try {
          await fs.unlink(internalFilePath);
        } catch (unlinkError) {
          logger.warn(`[${this.workerName}] Failed to clean up copied file:`, unlinkError);
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

  private mapPdfProgressToJobProgress(
    progress: Partial<{ status?: string; error?: string; fileName?: string }>,
    defaultFileName: string
  ): { stage: string; percent: number; message: string } {
    let stage: string = PROGRESS_STAGES.PROCESSING;
    let percent = 0;
    let message = progress.fileName || defaultFileName;
    
    if (progress.status) {
      switch (progress.status) {
        case 'parsing_text':
          stage = PROGRESS_STAGES.PARSING;
          percent = 40;
          message = 'Extracting text from PDF';
          break;
        case 'generating_summary':
          stage = PROGRESS_STAGES.SUMMARIZING;
          percent = 50;
          message = 'Generating AI summary';
          break;
        case 'error':
          stage = PROGRESS_STAGES.ERROR;
          message = progress.error || 'Processing failed';
          break;
      }
    }
    
    return { stage, percent, message };
  }
}