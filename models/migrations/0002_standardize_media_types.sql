-- Migration to standardize media types across the system
-- Migrates from: 'bookmark', 'web_page', 'pdf_document', 'notebook'
-- To: 'webpage', 'pdf', 'notebook', 'note', 'tab_group', 'image'

-- First, update existing object types in the current table to new standardized names
UPDATE objects SET object_type = 'webpage' WHERE object_type IN ('web_page', 'bookmark');
UPDATE objects SET object_type = 'pdf' WHERE object_type = 'pdf_document';

-- Note: 'notebook' stays as is
-- New types 'note', 'tab_group', 'image' will be used for future objects

-- Since SQLite doesn't support adding CHECK constraints to existing tables,
-- we'll create a new table with the constraint, migrate data, and rename

-- Create new objects table with proper constraints
CREATE TABLE objects_new (
    id TEXT PRIMARY KEY,
    object_type TEXT NOT NULL CHECK(object_type IN ('webpage', 'pdf', 'notebook', 'note', 'tab_group', 'image')),
    source_uri TEXT UNIQUE,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    
    -- Content fields
    raw_content_ref TEXT,
    parsed_content_json TEXT,
    cleaned_text TEXT,
    
    -- Error tracking
    error_info TEXT,
    
    -- Timestamps
    parsed_at TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    
    -- PDF-specific fields
    file_hash TEXT,
    original_file_name TEXT,
    file_size_bytes INTEGER,
    file_mime_type TEXT,
    internal_file_path TEXT,
    
    -- AI-generated fields
    summary TEXT,
    propositions_json TEXT,
    tags_json TEXT,
    ai_generated_metadata TEXT,
    summary_generated_at TEXT
);

-- Copy all data from old table to new (data has already been updated)
INSERT INTO objects_new SELECT * FROM objects;

-- Drop the old table
DROP TABLE objects;

-- Rename new table to objects
ALTER TABLE objects_new RENAME TO objects;

-- Recreate all indexes
CREATE INDEX idx_objects_source_uri ON objects(source_uri);
CREATE INDEX idx_objects_status ON objects(status);
CREATE INDEX idx_objects_object_type ON objects(object_type);
CREATE INDEX idx_objects_file_hash ON objects(file_hash);
CREATE INDEX idx_objects_summary_generated_at ON objects(summary_generated_at);

-- Recreate the trigger
CREATE TRIGGER objects_updated_at 
AFTER UPDATE ON objects 
FOR EACH ROW
BEGIN
    UPDATE objects SET updated_at = strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now') WHERE id = OLD.id;
END;