-- Migration File: 0003_create_objects.sql
CREATE TABLE objects (
  id TEXT PRIMARY KEY,             -- UUID v4 (Object ID)
  object_type TEXT NOT NULL,       -- e.g., 'bookmark', 'note'
  source_uri TEXT UNIQUE,          -- Original URL or unique source identifier
  title TEXT,
  status TEXT NOT NULL DEFAULT 'new', -- 'new', 'fetched', 'parsed', 'chunking', 'embedding_queued', 'embedded', 'error'
  raw_content_ref TEXT,            -- Optional: Ref to raw content storage
  parsed_content_json TEXT NULL,   -- Store ReadabilityParsed result as JSON
  error_info TEXT NULL,            -- Store fetch/parse error details
  parsed_at TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Trigger to update updated_at on modification
CREATE TRIGGER objects_updated_at AFTER UPDATE ON objects FOR EACH ROW
BEGIN
  UPDATE objects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = OLD.id;
END;

-- Indexes matching table/column names
CREATE INDEX idx_objects_source_uri ON objects(source_uri);
CREATE INDEX idx_objects_status ON objects(status);
CREATE INDEX idx_objects_object_type ON objects(object_type); 