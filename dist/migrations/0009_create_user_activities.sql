-- Create user_activities table for tracking user interactions
CREATE TABLE IF NOT EXISTS user_activities (
    id TEXT PRIMARY KEY,  -- UUID v4
    timestamp INTEGER NOT NULL,  -- Unix epoch milliseconds
    activity_type TEXT NOT NULL,  -- Type of activity (enum in code)
    details_json TEXT NOT NULL,  -- JSON string with activity-specific data
    user_id TEXT NOT NULL DEFAULT 'default_user',  -- For future multi-user support
    
    -- Add index for timestamp-based queries
    CHECK (activity_type IN (
        'notebook_visit',
        'notebook_created',
        'intent_selected',
        'chat_session_started',
        'search_performed',
        'object_ingested',
        'browser_navigation',
        'info_slice_selected'
    ))
);

-- Create indexes for common query patterns
CREATE INDEX idx_user_activities_timestamp ON user_activities(timestamp DESC);
CREATE INDEX idx_user_activities_user_id ON user_activities(user_id);
CREATE INDEX idx_user_activities_type ON user_activities(activity_type);
CREATE INDEX idx_user_activities_user_timestamp ON user_activities(user_id, timestamp DESC);