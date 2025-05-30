"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMANENT_ERROR_PATTERNS = exports.TRANSIENT_ERROR_PATTERNS = exports.MAX_RETRY_ATTEMPTS = exports.DEFAULT_RETRY_DELAY = exports.WORKER_TIMEOUT_MS = exports.MAX_ERROR_INFO_LENGTH = exports.PROGRESS_STAGES = exports.OBJECT_STATUS = exports.INGESTION_STATUS = void 0;
// Unified status constants for ingestion jobs
exports.INGESTION_STATUS = {
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
};
// Object status constants (for ObjectModel)
exports.OBJECT_STATUS = {
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
};
// Progress stage names (fine-grained steps within a status)
exports.PROGRESS_STAGES = {
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
};
// Shared constants
exports.MAX_ERROR_INFO_LENGTH = 1024;
exports.WORKER_TIMEOUT_MS = 30000; // 30 seconds
exports.DEFAULT_RETRY_DELAY = 5000; // 5 seconds
exports.MAX_RETRY_ATTEMPTS = 3;
// Transient error patterns
exports.TRANSIENT_ERROR_PATTERNS = [
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
exports.PERMANENT_ERROR_PATTERNS = [
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
//# sourceMappingURL=constants.js.map