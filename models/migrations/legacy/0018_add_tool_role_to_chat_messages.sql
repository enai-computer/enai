-- Migration: Add 'tool' role to chat_messages role constraint
-- This allows storing tool responses in the conversation history

-- SQLite doesn't support ALTER TABLE to modify CHECK constraints directly
-- We need to recreate the table with the updated constraint

-- 1. Create new table with updated constraint
CREATE TABLE chat_messages_new (
    message_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    metadata TEXT NULL
);

-- 2. Copy data from old table
INSERT INTO chat_messages_new SELECT * FROM chat_messages;

-- 3. Drop old table
DROP TABLE chat_messages;

-- 4. Rename new table
ALTER TABLE chat_messages_new RENAME TO chat_messages;

-- 5. Recreate indices
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_timestamp ON chat_messages(timestamp);