-- Add goal fields to user_profiles table
ALTER TABLE user_profiles ADD COLUMN stated_user_goals_json TEXT;
ALTER TABLE user_profiles ADD COLUMN inferred_user_goals_json TEXT;

-- Remove the old synthesized_goals_json column since we're replacing it with inferred_user_goals_json
-- Note: In a production system, you might want to migrate data first
-- For now, we'll just drop the column if it exists (SQLite doesn't support DROP COLUMN directly)
-- So we'll need to recreate the table (this is safe in development)

-- Create temporary table with new schema
CREATE TABLE user_profiles_new (
    user_id TEXT PRIMARY KEY DEFAULT 'default_user',
    name TEXT,
    about_me TEXT,
    custom_instructions TEXT,
    stated_user_goals_json TEXT,  -- New: User-defined goals
    inferred_user_goals_json TEXT,  -- New: AI-inferred goals with probabilities
    synthesized_interests_json TEXT,
    synthesized_preferred_sources_json TEXT,
    synthesized_recent_intents_json TEXT,
    updated_at INTEGER NOT NULL
);

-- Copy existing data (excluding synthesized_goals_json)
INSERT INTO user_profiles_new (
    user_id, 
    name, 
    about_me, 
    custom_instructions,
    synthesized_interests_json,
    synthesized_preferred_sources_json,
    synthesized_recent_intents_json,
    updated_at
)
SELECT 
    user_id, 
    name, 
    about_me, 
    custom_instructions,
    synthesized_interests_json,
    synthesized_preferred_sources_json,
    synthesized_recent_intents_json,
    updated_at
FROM user_profiles;

-- Drop old table and rename new one
DROP TABLE user_profiles;
ALTER TABLE user_profiles_new RENAME TO user_profiles;

-- Ensure default_user exists after migration
INSERT INTO user_profiles (user_id, updated_at) 
VALUES ('default_user', strftime('%s', 'now') * 1000)
ON CONFLICT(user_id) DO NOTHING;