/** Job types for ingestion queue. */
export type JobType = 'pdf' | 'url' | 'text_snippet';

/** Status of an ingestion job. */
export type JobStatus = 
  | 'queued'
  | 'processing_source'
  | 'parsing_content'
  | 'ai_processing'
  | 'persisting_data'
  | 'vectorizing'
  | 'awaiting_chunking' // New status for handoff to ChunkingService
  | 'chunking_in_progress' // New status for active chunking
  | 'completed'
  | 'failed'
  | 'retry_pending'
  | 'cancelled';

/** Progress information for an ingestion job. */
export interface JobProgress {
  stage: string;
  percent: number;
  message?: string;
}

/** Job-specific data for different ingestion types. */
export interface JobSpecificData {
  // PDF specific
  pdfPassword?: string;
  fileSize?: number;
  sha256_hash?: string; // For PDF deduplication
  
  // URL specific
  headers?: Record<string, string>;
  userAgent?: string;
  
  // Common
  relatedObjectId?: string;
  notebookId?: string;
  objectId?: string; // Reuse existing object
  objectType?: string;
  title?: string;
  
  // Common options
  chunkingStrategy?: 'semantic' | 'summary_only' | 'fixed_size';
  maxRetries?: number;
  
  // WOM to LOM transition
  fromWom?: boolean; // Indicates this job is transitioning from WOM to LOM
}

/** Represents an ingestion job in the queue. */
export interface IngestionJob {
  id: string;
  jobType: JobType;
  sourceIdentifier: string;
  originalFileName?: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  progress?: JobProgress;
  errorInfo?: string;
  failedStage?: string;
  // Add new fields for chunking service coordination
  chunking_status?: 'pending' | 'in_progress' | 'completed' | 'failed' | null;
  chunking_error_info?: string | null;
  jobSpecificData?: JobSpecificData;
  relatedObjectId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/** Parameters for creating an ingestion job. */
export interface CreateIngestionJobParams {
  jobType: JobType;
  sourceIdentifier: string;
  originalFileName?: string;
  priority?: number;
  jobSpecificData?: JobSpecificData;
}

/** Parameters for updating an ingestion job. */
export interface UpdateIngestionJobParams {
  status?: JobStatus;
  attempts?: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  progress?: JobProgress;
  errorInfo?: string;
  failedStage?: string;
  relatedObjectId?: string;
  completedAt?: string;
  // Add chunking fields here as well
  chunking_status?: 'pending' | 'in_progress' | 'completed' | 'failed' | null;
  chunking_error_info?: string | null;
}

/** Error types for PDF ingestion. */
export enum PdfIngestionError {
  DUPLICATE_FILE = 'DUPLICATE_FILE',
  TEXT_EXTRACTION_FAILED = 'TEXT_EXTRACTION_FAILED',
  AI_PROCESSING_FAILED = 'AI_PROCESSING_FAILED',
  STORAGE_FAILED = 'STORAGE_FAILED',
  UNSUPPORTED_MIME_TYPE = 'UNSUPPORTED_MIME_TYPE',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  DATABASE_ERROR = 'DATABASE_ERROR',
}

/** Status of PDF ingestion progress. */
export type PdfIngestionStatus = 
  | 'queued'
  | 'starting_processing'
  | 'parsing_text'
  | 'generating_summary'
  | 'saving_metadata'
  | 'creating_embeddings'
  | 'complete'
  | 'duplicate'
  | 'error';

/** Progress event for PDF ingestion. */
export interface PdfIngestProgressPayload {
  fileName: string;
  filePath: string;
  status: PdfIngestionStatus;
  message?: string;
  objectId?: string;
  error?: string;
}

/** Result of a batch PDF ingestion. */
export interface PdfIngestBatchCompletePayload {
  successCount: number;
  failureCount: number;
  results: Array<{
    filePath: string;
    fileName: string;
    success: boolean;
    objectId?: string;
    error?: string;
    errorType?: PdfIngestionError;
  }>;
}

/** Result of processing a single PDF. */
export interface PdfIngestionResult {
  success: boolean;
  objectId?: string;
  status: PdfIngestionError | 'completed';
  error?: string;
}

/** Progress event for bookmarks import. */
export interface BookmarksProgressEvent {
  processed: number; 
  total: number; 
  stage: string; // e.g., 'parsing', 'fetching', 'embedding'
}

// --- IPC Payload Types ---

/** Payload for importing bookmarks from a file. */
export interface ImportBookmarksPayload {
  filePath: string;
}

/** Payload for requesting PDF ingestion. */
export interface PdfIngestRequestPayload {
  filePaths: string[];
}