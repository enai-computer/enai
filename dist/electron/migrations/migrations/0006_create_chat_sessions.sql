-- Migration File: 0006_create_chat_sessions.sql
CREATE TABLE chat_sessions (
    session_id TEXT PRIMARY KEY,    -- UUID v4
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    title TEXT NULL                 -- Optional user-defined title
);

-- Trigger to update updated_at on modification (Using AFTER UPDATE with guard)
CREATE TRIGGER chat_sessions_touch
AFTER UPDATE ON chat_sessions
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at      -- Prevents recursion if updated_at was already set
BEGIN
  -- Issue a separate UPDATE statement to set the timestamp
  UPDATE chat_sessions
     SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE session_id = NEW.session_id;
END; 