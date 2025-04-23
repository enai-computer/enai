-- Migration File: 0005_create_embeddings.sql
CREATE TABLE embeddings (
  id INTEGER PRIMARY KEY,          -- Surrogate key
  chunk_id INTEGER NOT NULL,       -- FK -> chunks(id)
  model TEXT NOT NULL,             -- e.g., 'text-embedding-3-small'
  vector_id TEXT NOT NULL UNIQUE,  -- Chroma vector ID (<object_id>_<chunk_idx>_<model>)
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);
CREATE INDEX idx_embeddings_chunk ON embeddings(chunk_id); 