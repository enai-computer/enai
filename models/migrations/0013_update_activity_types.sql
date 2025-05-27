-- Update the CHECK constraint on user_activities to include new activity types
-- SQLite doesn't support ALTER CONSTRAINT, so we need to recreate the table

-- Create temporary table with updated constraint
CREATE TABLE user_activities_new (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    activity_type TEXT NOT NULL,
    details_json TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT 'default_user',
    
    CHECK (activity_type IN (
        'notebook_visit',
        'notebook_created',
        'intent_selected',
        'chat_session_started',
        'search_performed',
        'object_ingested',
        'browser_navigation',
        'info_slice_selected',
        'stated_goal_added',
        'stated_goal_updated',
        'stated_goal_completed',
        'todo_created',
        'todo_updated',
        'todo_completed'
    ))
);

-- Copy existing data
INSERT INTO user_activities_new (id, timestamp, activity_type, details_json, user_id)
SELECT id, timestamp, activity_type, details_json, user_id
FROM user_activities;

-- Drop old table and rename new one
DROP TABLE user_activities;
ALTER TABLE user_activities_new RENAME TO user_activities;

-- Recreate indexes
CREATE INDEX idx_user_activities_timestamp ON user_activities(timestamp DESC);
CREATE INDEX idx_user_activities_user_id ON user_activities(user_id);
CREATE INDEX idx_user_activities_type ON user_activities(activity_type);
CREATE INDEX idx_user_activities_user_timestamp ON user_activities(user_id, timestamp DESC);