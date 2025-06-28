-- Add temporal tracking and composite object support
ALTER TABLE objects ADD COLUMN last_accessed_at DATETIME;
ALTER TABLE objects ADD COLUMN child_object_ids TEXT DEFAULT NULL; -- JSON array

-- Set a default value for existing rows
UPDATE objects SET last_accessed_at = CURRENT_TIMESTAMP WHERE last_accessed_at IS NULL;

-- Create indexes for performance
CREATE INDEX idx_objects_last_accessed ON objects(last_accessed_at);
CREATE INDEX idx_objects_type_accessed ON objects(object_type, last_accessed_at);