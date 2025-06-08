-- Add chunking_status and chunking_error_info to ingestion_jobs table
ALTER TABLE ingestion_jobs ADD COLUMN chunking_status TEXT;
ALTER TABLE ingestion_jobs ADD COLUMN chunking_error_info TEXT;

-- Update existing jobs that are 'completed' but might not have gone through the new chunking status flow.
-- We assume if an ingestion job is 'completed' and has a related_object_id,
-- its chunking was implicitly successful.
-- For those where related_object_id is null, or status isn't 'completed', chunking_status remains NULL.
UPDATE ingestion_jobs
SET chunking_status = 'completed'
WHERE status = 'completed' AND related_object_id IS NOT NULL; 