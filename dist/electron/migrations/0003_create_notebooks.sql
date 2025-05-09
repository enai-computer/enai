-- Migration: Create notebooks table and its trigger

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