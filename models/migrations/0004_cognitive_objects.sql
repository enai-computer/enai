-- Migration: Add cognitive fields to objects table
-- This migration implements the cognitive objects model as outlined in issue #81
-- It adds biography tracking and relationship management capabilities to objects

-- Add cognitive fields to objects table
ALTER TABLE objects ADD COLUMN object_bio TEXT;
ALTER TABLE objects ADD COLUMN object_relationships TEXT;

-- Create junction table for notebook-object associations
-- This provides efficient queries for notebook membership while avoiding circular dependencies
CREATE TABLE notebook_objects (
  notebook_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  added_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
  PRIMARY KEY (notebook_id, object_id),
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
  FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE
);

-- Create index for efficient lookups by object
CREATE INDEX idx_notebook_objects_object ON notebook_objects(object_id);

-- Backfill object_bio from existing timestamps
-- Initialize with creation and last update events
-- Note: timestamps are already stored as ISO strings in the database
UPDATE objects 
SET object_bio = json_object(
  'createdAt', created_at,
  'events', json_array(
    json_object(
      'when', created_at, 
      'what', 'created'
    ),
    json_object(
      'when', updated_at, 
      'what', 'updated'
    )
  )
) 
WHERE object_bio IS NULL;

-- Backfill object_relationships from child_object_ids
-- Convert existing parent-child relationships to the new format
UPDATE objects
SET object_relationships = (
  SELECT json_object(
    'related', json_group_array(
      json_object(
        'to', child.value,
        'nature', 'child',
        'strength', 1.0,
        'formed', objects.created_at,
        'topicAffinity', 1.0
      )
    )
  )
  FROM json_each(objects.child_object_ids) AS child
)
WHERE child_object_ids IS NOT NULL 
  AND json_array_length(json(child_object_ids)) > 0
  AND object_relationships IS NULL;

-- Set default empty relationships for objects without any
UPDATE objects
SET object_relationships = json_object('related', json_array())
WHERE object_relationships IS NULL;

-- Backfill notebook_objects from existing notebook.object_id relationships
-- This preserves existing notebook-object associations
-- Note: notebooks.created_at is already stored as ISO string
INSERT INTO notebook_objects (notebook_id, object_id, added_at)
SELECT 
  id AS notebook_id, 
  object_id,
  created_at AS added_at
FROM notebooks 
WHERE object_id IS NOT NULL
  AND object_id != ''
ON CONFLICT (notebook_id, object_id) DO NOTHING;

