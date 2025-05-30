-- Migration: Rename key_topics_json to tags_json for consistency
-- Purpose: Standardize naming convention to use "tags" throughout the codebase
-- Date: 2025-05-30

-- SQLite doesn't support ALTER TABLE RENAME COLUMN in older versions,
-- so we need to recreate the table. However, since this is a new column
-- with minimal data, we can use a simpler approach.

-- First, add the new column
ALTER TABLE objects ADD COLUMN tags_json TEXT;

-- Copy data from key_topics_json to tags_json
UPDATE objects SET tags_json = key_topics_json WHERE key_topics_json IS NOT NULL;

-- Create index on the new column (drop the old one first if it exists)
DROP INDEX IF EXISTS idx_objects_summary_generated_at;
CREATE INDEX idx_objects_summary_generated_at ON objects(summary_generated_at);

-- Note: In production, we would drop key_topics_json after confirming migration success
-- For now, we'll keep both columns to ensure backwards compatibility during transition