-- Create ingestion_jobs table for unified content processing pipeline
CREATE TABLE IF NOT EXISTS ingestion_jobs (
    -- Primary identification
    id TEXT PRIMARY KEY,  -- UUID
    job_type TEXT NOT NULL CHECK(job_type IN ('pdf', 'url', 'text_snippet')),
    source_identifier TEXT NOT NULL,  -- File path for PDFs, URL for web content
    original_file_name TEXT,  -- Original filename if applicable
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN (
        'queued',
        'processing_source',
        'parsing_content', 
        'ai_processing',
        'persisting_data',
        'vectorizing',
        'completed',
        'failed',
        'retry_pending',
        'cancelled'
    )),
    
    -- Processing metadata
    priority INTEGER NOT NULL DEFAULT 0,  -- Higher number = higher priority
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at INTEGER,  -- Unix timestamp
    next_attempt_at INTEGER,  -- Unix timestamp for scheduled retries
    
    -- Progress tracking for UI updates
    progress TEXT,  -- JSON: { stage: string, percent: number, message?: string }
    
    -- Error handling
    error_info TEXT,  -- Detailed error message for failures
    failed_stage TEXT,  -- Which stage failed (for targeted retries)
    
    -- Type-specific parameters
    job_specific_data TEXT,  -- JSON: PDF passwords, URL headers, parsing options, etc.
    
    -- Relationship to final object
    related_object_id TEXT,  -- Foreign key to objects.id once successfully created
    
    -- Timestamps
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    completed_at INTEGER,  -- When job finished (success or permanent failure)
    
    -- Indexes for efficient queries
    FOREIGN KEY (related_object_id) REFERENCES objects(id) ON DELETE SET NULL
);

-- Indexes for common query patterns
CREATE INDEX idx_ingestion_jobs_status ON ingestion_jobs(status);
CREATE INDEX idx_ingestion_jobs_job_type ON ingestion_jobs(job_type);
CREATE INDEX idx_ingestion_jobs_priority_status ON ingestion_jobs(priority DESC, status);
CREATE INDEX idx_ingestion_jobs_next_attempt ON ingestion_jobs(next_attempt_at) WHERE status = 'retry_pending';
CREATE INDEX idx_ingestion_jobs_created_at ON ingestion_jobs(created_at);
CREATE INDEX idx_ingestion_jobs_related_object ON ingestion_jobs(related_object_id);

-- Trigger to update the updated_at timestamp
CREATE TRIGGER update_ingestion_jobs_updated_at
AFTER UPDATE ON ingestion_jobs
BEGIN
    UPDATE ingestion_jobs SET updated_at = unixepoch() WHERE id = NEW.id;
END;