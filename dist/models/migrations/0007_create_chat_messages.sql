-- Migration File: 0007_create_chat_messages.sql
CREATE TABLE chat_messages (
    message_id TEXT PRIMARY KEY,    -- UUID v4
    session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')), -- Ensure role validity
    content TEXT NOT NULL,
    -- Store sources used for 'assistant' messages, token counts, etc.
    metadata TEXT NULL              -- Store as JSON string
);

-- Index for efficient history retrieval
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_timestamp ON chat_messages(timestamp); 