-- Migration: Add object_id to notebooks table

-- 1. Add the object_id column, allowing NULL initially for existing rows
ALTER TABLE notebooks ADD COLUMN object_id TEXT;

-- 2. Attempt to populate object_id for existing notebooks
-- This assumes JeffersObject.source_uri is 'jeffers://notebook/{notebook_id}'
-- and that JeffersObject.object_type is 'notebook'.
UPDATE notebooks
SET object_id = (
    SELECT o.id
    FROM objects o
    WHERE o.source_uri = 'jeffers://notebook/' || notebooks.id 
      AND o.object_type = 'notebook'
    LIMIT 1
)
WHERE EXISTS (
    SELECT 1
    FROM objects o
    WHERE o.source_uri = 'jeffers://notebook/' || notebooks.id
      AND o.object_type = 'notebook'
);

-- Optional: Add an index for faster lookups if object_id will be queried frequently
CREATE INDEX IF NOT EXISTS idx_notebooks_object_id ON notebooks(object_id);

-- Note on NOT NULL and Foreign Key:
-- Making object_id NOT NULL and/or adding a FOREIGN KEY constraint (REFERENCES objects(id))
-- in SQLite for a table with existing data typically requires a table rebuild process.
-- This migration adds the column and attempts to populate it.
-- The application layer (NotebookService, NotebookModel) is now structured to always
-- populate object_id for new notebooks, and the NotebookRecord type expects it.
-- If existing notebooks have a NULL object_id after this migration, they might represent
-- data inconsistencies that need to be addressed separately or handled gracefully by the application
-- if a NotebookRecord is loaded with a null objectId despite the type definition. 