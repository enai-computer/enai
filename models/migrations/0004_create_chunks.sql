-- Migration File: 0004_create_chunks.sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- Changed to AUTOINCREMENT for clarity
  object_id TEXT NOT NULL,         -- FK -> objects(id) (UUID)
  chunk_idx INTEGER NOT NULL,      -- 0-based order in document
  content TEXT NOT NULL,           -- Renamed from 'text'. Raw chunk string/data.
  summary TEXT,                    -- Optional LLM summary
  tags_json TEXT,                  -- JSON array of strings
  propositions_json TEXT,          -- JSON array of proposition objects
  token_count INTEGER,             -- Changed to nullable, may not be known immediately
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(object_id, chunk_idx),
  FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE
);
CREATE INDEX idx_chunks_object_id ON chunks(object_id); 