-- Add columns to 'objects' table for PDF specific metadata
ALTER TABLE objects ADD COLUMN file_hash TEXT; -- SHA256 hash of the PDF file content
ALTER TABLE objects ADD COLUMN original_file_name TEXT; -- Original name of the uploaded file
ALTER TABLE objects ADD COLUMN file_size_bytes INTEGER; -- Size of the PDF file in bytes
ALTER TABLE objects ADD COLUMN file_mime_type TEXT; -- Detected MIME type (e.g., 'application/pdf')
ALTER TABLE objects ADD COLUMN internal_file_path TEXT; -- Path to our stored copy in user_data/pdfs
ALTER TABLE objects ADD COLUMN ai_generated_metadata TEXT; -- JSON blob for {title, summary, tags}

-- Create index for hash lookups (non-unique to allow manual override/versioning later)
CREATE INDEX IF NOT EXISTS idx_objects_file_hash ON objects(file_hash);