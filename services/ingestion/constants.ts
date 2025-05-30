// Unified status constants for ingestion jobs
export const INGESTION_STATUS = {
  QUEUED: 'queued',
  PROCESSING_SOURCE: 'processing_source',
  PARSING_CONTENT: 'parsing_content',
  AI_PROCESSING: 'ai_processing',
  PERSISTING_DATA: 'persisting_data',
  VECTORIZING: 'vectorizing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RETRY_PENDING: 'retry_pending',
  CANCELLED: 'cancelled'
} as const;

export type IngestionStatus = typeof INGESTION_STATUS[keyof typeof INGESTION_STATUS];

// Object status constants (for ObjectModel)
export const OBJECT_STATUS = {
  NEW: 'new',
  FETCHED: 'fetched',
  PARSED: 'parsed',
  CHUNKING: 'chunking',
  CHUNKED: 'chunked',
  CHUNKING_FAILED: 'chunking_failed',
  EMBEDDING: 'embedding',
  EMBEDDED: 'embedded',
  EMBEDDING_FAILED: 'embedding_failed',
  EMBEDDING_IN_PROGRESS: 'embedding_in_progress',
  ERROR: 'error',
  PDF_PROCESSED: 'pdf_processed',
  COMPLETE: 'complete'
} as const;

export type ObjectStatus = typeof OBJECT_STATUS[keyof typeof OBJECT_STATUS];

// Progress stage names (fine-grained steps within a status)
export const PROGRESS_STAGES = {
  // General stages
  INITIALIZING: 'initializing',
  PROCESSING: 'processing',
  FINALIZING: 'finalizing',
  ERROR: 'error',
  
  // Specific stages
  FETCHING: 'fetching',
  PARSING: 'parsing',
  CLEANING: 'cleaning',
  SUMMARIZING: 'summarizing',
  PERSISTING: 'persisting',
  VECTORIZING: 'vectorizing'
} as const;

export type ProgressStage = typeof PROGRESS_STAGES[keyof typeof PROGRESS_STAGES];

// Shared constants
export const MAX_ERROR_INFO_LENGTH = 1024;
export const WORKER_TIMEOUT_MS = 30000; // 30 seconds
export const DEFAULT_RETRY_DELAY = 5000; // 5 seconds
export const MAX_RETRY_ATTEMPTS = 3;

// Transient error patterns
export const TRANSIENT_ERROR_PATTERNS = [
  // Network errors
  'ECONNREFUSED',
  'ENOTFOUND', 
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  
  // HTTP status codes
  '429', // Rate limit
  '502', // Bad gateway
  '503', // Service unavailable
  '504', // Gateway timeout
  
  // Database errors
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'lock',
  'busy',
  
  // Generic patterns
  'timeout',
  'rate limit',
  'temporarily',
  'try again'
];

// Permanent error patterns
export const PERMANENT_ERROR_PATTERNS = [
  // Permission errors
  'EACCES',
  'EPERM',
  'permission denied',
  'access denied',
  
  // Storage errors
  'ENOSPC', // No space
  'EDQUOT', // Disk quota
  'disk full',
  'no space',
  
  // Client errors
  '400', // Bad request
  '401', // Unauthorized
  '403', // Forbidden
  '404', // Not found
  '410', // Gone
  
  // File errors
  'ENOENT', // File not found (when we expect it to exist)
  'invalid file',
  'corrupt',
  'malformed'
];