-- Create user_profiles table for storing explicit and synthesized user data
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY DEFAULT 'default_user',  -- Support for future multi-user
    name TEXT,  -- User's display name
    about_me TEXT,  -- User's self-description
    custom_instructions TEXT,  -- Custom instructions for AI
    synthesized_goals_json TEXT,  -- JSON array of AI-inferred goals
    synthesized_interests_json TEXT,  -- JSON array of AI-inferred interests
    synthesized_preferred_sources_json TEXT,  -- JSON array of AI-inferred preferred sources
    synthesized_recent_intents_json TEXT,  -- JSON array of AI-inferred recent intents
    updated_at INTEGER NOT NULL  -- Unix epoch milliseconds
);

-- Insert default user profile
INSERT INTO user_profiles (user_id, updated_at) 
VALUES ('default_user', strftime('%s', 'now') * 1000)
ON CONFLICT(user_id) DO NOTHING;