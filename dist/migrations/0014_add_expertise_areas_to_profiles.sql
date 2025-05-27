-- Add inferred expertise areas field to user_profiles table
-- Note: synthesized_preferred_sources_json already exists and can be used for preferred source types

-- SQLite doesn't support ALTER TABLE ADD COLUMN after table creation with constraints,
-- so we need to recreate the table

-- Create temporary table with new schema
CREATE TABLE user_profiles_new (
    user_id TEXT PRIMARY KEY DEFAULT 'default_user',
    name TEXT,
    about_me TEXT,
    custom_instructions TEXT,
    stated_user_goals_json TEXT,
    inferred_user_goals_json TEXT,
    synthesized_interests_json TEXT,
    synthesized_preferred_sources_json TEXT,  -- This will store preferred source types
    synthesized_recent_intents_json TEXT,
    inferred_expertise_areas_json TEXT,  -- New: AI-inferred areas of expertise
    preferred_source_types_json TEXT,    -- New: Explicit field for source types (e.g., "academic papers", "blogs")
    updated_at INTEGER NOT NULL
);

-- Copy existing data
INSERT INTO user_profiles_new (
    user_id, 
    name, 
    about_me, 
    custom_instructions,
    stated_user_goals_json,
    inferred_user_goals_json,
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
    stated_user_goals_json,
    inferred_user_goals_json,
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