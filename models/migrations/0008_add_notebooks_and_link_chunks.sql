-- Migration: Create notebooks table, add notebook_id to chunks, and set up triggers/foreign keys

-- 1. Create the 'notebooks' table
CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 2. Create a trigger to automatically update 'updated_at' on notebooks table updates
CREATE TRIGGER IF NOT EXISTS update_notebook_updated_at
AFTER UPDATE ON notebooks
FOR EACH ROW
BEGIN
    UPDATE notebooks
    SET updated_at = STRFTIME('%s', 'now') * 1000 -- Store as Unix epoch milliseconds
    WHERE id = OLD.id;
END;

-- 3. Add 'notebook_id' column to the 'chunks' table with a foreign key constraint
ALTER TABLE chunks ADD COLUMN notebook_id TEXT NULLABLE REFERENCES notebooks(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Create an index on chunks.notebook_id for better query performance when filtering by notebook.
CREATE INDEX IF NOT EXISTS idx_chunks_notebook_id ON chunks(notebook_id); 