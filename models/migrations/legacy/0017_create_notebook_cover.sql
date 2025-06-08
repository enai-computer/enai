-- Migration: Create NotebookCover for homepage conversations

-- First, migrate any existing sessions from the old agent-conversations notebook to the new NotebookCover
-- This needs to happen before we create the NotebookCover to avoid foreign key issues
UPDATE chat_sessions 
SET notebook_id = 'cover-default_user' 
WHERE notebook_id = 'agent-conversations';

-- Delete the old agent-conversations notebook if it exists
DELETE FROM notebooks WHERE id = 'agent-conversations';

-- Create a special notebook that acts as a NotebookCover for the default user
-- The ID follows a special naming convention "cover-{userId}" to differentiate from regular notebooks
INSERT INTO notebooks (id, title, description, object_id, created_at, updated_at)
SELECT 
    'cover-default_user',
    'Homepage Conversations',
    'This is a special notebook that stores all homepage chat conversations',
    'cover-default_user',  -- Using same ID as object_id for simplicity
    CAST(strftime('%s', 'now') AS INTEGER) * 1000,  -- Current timestamp in milliseconds
    CAST(strftime('%s', 'now') AS INTEGER) * 1000   -- Current timestamp in milliseconds
WHERE NOT EXISTS (SELECT 1 FROM notebooks WHERE id = 'cover-default_user');