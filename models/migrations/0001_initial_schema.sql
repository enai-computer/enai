-- Jeffers Initial Schema
-- This is a consolidated migration that represents the complete database schema
-- Created from migrations 0001-0023 (with 0016 missing)
-- Consolidation date: 2025-01-06

-- Core object storage for all content types (bookmarks, PDFs, etc.)
CREATE TABLE objects (
    id TEXT PRIMARY KEY,                              -- UUID v4
    object_type TEXT NOT NULL,                        -- 'bookmark', 'note', 'pdf_document', etc.
    source_uri TEXT UNIQUE,                          -- Original URL or unique identifier
    title TEXT,
    status TEXT NOT NULL DEFAULT 'new',              -- 'new', 'fetched', 'parsed', 'chunking', 'embedding_queued', 'embedded', 'error'
    
    -- Content fields
    raw_content_ref TEXT,                            -- Reference to raw content storage
    parsed_content_json TEXT,                        -- ReadabilityParsed result as JSON
    cleaned_text TEXT,                               -- Cleaned text content
    
    -- Error tracking
    error_info TEXT,                                 -- Error details if status = 'error'
    
    -- Timestamps
    parsed_at TEXT,                                  -- ISO 8601 timestamp
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    
    -- PDF-specific fields
    file_hash TEXT,                                  -- SHA256 hash for deduplication
    original_file_name TEXT,
    file_size_bytes INTEGER,
    file_mime_type TEXT,
    internal_file_path TEXT,                         -- Path to stored file copy
    
    -- AI-generated fields
    summary TEXT,
    propositions_json TEXT,                          -- JSON array of key claims/facts
    tags_json TEXT,                                  -- JSON array of tags/topics
    ai_generated_metadata TEXT,                      -- Legacy JSON blob for backwards compatibility
    summary_generated_at TEXT                        -- ISO 8601 timestamp
);

-- Indexes for objects
CREATE INDEX idx_objects_source_uri ON objects(source_uri);
CREATE INDEX idx_objects_status ON objects(status);
CREATE INDEX idx_objects_object_type ON objects(object_type);
CREATE INDEX idx_objects_file_hash ON objects(file_hash);
CREATE INDEX idx_objects_summary_generated_at ON objects(summary_generated_at);

-- Auto-update trigger for objects
CREATE TRIGGER objects_updated_at 
AFTER UPDATE ON objects 
FOR EACH ROW
BEGIN
    UPDATE objects SET updated_at = strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now') WHERE id = OLD.id;
END;

-- Notebooks are containers for organizing content and conversations
CREATE TABLE notebooks (
    id TEXT PRIMARY KEY NOT NULL,                    -- UUID v4
    title TEXT NOT NULL,
    description TEXT,
    object_id TEXT,                                  -- Optional link to source object
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE SET NULL
);

-- Index for notebooks
CREATE INDEX idx_notebooks_object_id ON notebooks(object_id);

-- Auto-update trigger for notebooks
CREATE TRIGGER update_notebook_updated_at
AFTER UPDATE ON notebooks
FOR EACH ROW
BEGIN
    UPDATE notebooks
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')
    WHERE id = OLD.id;
END;

-- Notes within notebooks
CREATE TABLE notes (
    id TEXT PRIMARY KEY,                             -- UUID v4
    notebook_id TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',               -- 'text', 'markdown', etc.
    metadata TEXT,                                   -- JSON field for extensibility
    position INTEGER NOT NULL,                       -- Order within notebook
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
);

-- Indexes for notes
CREATE INDEX idx_notes_notebook_id ON notes(notebook_id);
CREATE INDEX idx_notes_position ON notes(notebook_id, position);

-- Chat sessions belong to notebooks
CREATE TABLE chat_sessions (
    session_id TEXT PRIMARY KEY,                     -- UUID v4
    notebook_id TEXT NOT NULL,
    title TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
);

-- Index for chat sessions
CREATE INDEX idx_chat_sessions_notebook_id ON chat_sessions(notebook_id);

-- Auto-update trigger for chat sessions
CREATE TRIGGER chat_sessions_touch
AFTER UPDATE ON chat_sessions
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE chat_sessions
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')
    WHERE session_id = NEW.session_id;
END;

-- Chat messages within sessions
CREATE TABLE chat_messages (
    message_id TEXT PRIMARY KEY,                     -- UUID v4
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    metadata TEXT,                                   -- JSON string for tool calls, etc.
    FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
);

-- Indexes for chat messages
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_timestamp ON chat_messages(timestamp);

-- Content chunks for vector search
CREATE TABLE chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id TEXT NOT NULL,
    notebook_id TEXT,                                -- Optional association with notebook
    chunk_idx INTEGER NOT NULL,                      -- 0-based order within object
    content TEXT NOT NULL,
    summary TEXT,
    tags_json TEXT,                                  -- JSON array
    propositions_json TEXT,                          -- JSON array
    token_count INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    UNIQUE(object_id, chunk_idx),
    FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
);

-- Indexes for chunks
CREATE INDEX idx_chunks_object_id ON chunks(object_id);
CREATE INDEX idx_chunks_notebook_id ON chunks(notebook_id);

-- Embeddings for vector search
CREATE TABLE embeddings (
    id INTEGER PRIMARY KEY,
    chunk_id INTEGER NOT NULL,
    model TEXT NOT NULL,                             -- e.g., 'text-embedding-3-small'
    vector_id TEXT NOT NULL UNIQUE,                  -- Format: <object_id>_<chunk_idx>_<model>
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

-- Index for embeddings
CREATE INDEX idx_embeddings_chunk ON embeddings(chunk_id);

-- User activity tracking for personalization
CREATE TABLE user_activities (
    id TEXT PRIMARY KEY,                             -- UUID v4
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    activity_type TEXT NOT NULL,
    details_json TEXT NOT NULL,                      -- JSON string with activity-specific data
    user_id TEXT NOT NULL DEFAULT 'default_user',
    CHECK (activity_type IN (
        'notebook_visit',
        'notebook_created',
        'create_notebook',                           -- Note management action
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

-- Indexes for user activities
CREATE INDEX idx_user_activities_timestamp ON user_activities(timestamp DESC);
CREATE INDEX idx_user_activities_user_id ON user_activities(user_id);
CREATE INDEX idx_user_activities_type ON user_activities(activity_type);
CREATE INDEX idx_user_activities_user_timestamp ON user_activities(user_id, timestamp DESC);

-- User profiles for personalization
CREATE TABLE user_profiles (
    user_id TEXT PRIMARY KEY DEFAULT 'default_user',
    name TEXT,
    about_me TEXT,
    custom_instructions TEXT,
    
    -- Goal tracking
    stated_user_goals_json TEXT,                     -- User-defined goals
    inferred_user_goals_json TEXT,                   -- AI-inferred goals with confidence scores
    time_bound_goals_json TEXT,                      -- Goals with deadlines and temporal context
    past_goals_json TEXT,                            -- Historical completed/abandoned goals
    
    -- AI-synthesized insights
    synthesized_interests_json TEXT,                 -- Topics of interest
    synthesized_preferred_sources_json TEXT,         -- Frequently visited sources
    synthesized_recent_intents_json TEXT,            -- Recent query patterns
    inferred_expertise_areas_json TEXT,              -- Detected areas of expertise
    preferred_source_types_json TEXT,                -- e.g., "academic papers", "blogs"
    
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now'))
);

-- User todos for task management
CREATE TABLE user_todos (
    id TEXT PRIMARY KEY,                             -- UUID v4
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    
    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    due_date TEXT,
    completed_at TEXT,
    
    -- Task properties
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER,                                -- 1-5, lower is higher priority
    
    -- Relationships
    parent_todo_id TEXT,                             -- For subtasks
    project_or_goal_id TEXT,                         -- Links to goals in user profile
    related_object_ids_json TEXT,                    -- JSON array of related content
    
    CHECK (status IN ('pending', 'in_progress', 'completed', 'archived')),
    CHECK (priority IS NULL OR (priority >= 1 AND priority <= 5)),
    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_todo_id) REFERENCES user_todos(id) ON DELETE SET NULL
);

-- Indexes for user todos
CREATE INDEX idx_user_todos_user_id ON user_todos(user_id);
CREATE INDEX idx_user_todos_status ON user_todos(status);
CREATE INDEX idx_user_todos_due_date ON user_todos(due_date);
CREATE INDEX idx_user_todos_parent_todo ON user_todos(parent_todo_id);
CREATE INDEX idx_user_todos_user_status ON user_todos(user_id, status);
CREATE INDEX idx_user_todos_user_due_date ON user_todos(user_id, due_date);

-- Ingestion job queue for async processing
CREATE TABLE ingestion_jobs (
    id TEXT PRIMARY KEY,                             -- UUID v4
    job_type TEXT NOT NULL CHECK(job_type IN ('pdf', 'url', 'text_snippet')),
    source_identifier TEXT NOT NULL,                 -- File path or URL
    original_file_name TEXT,
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN (
        'queued',
        'processing_source',
        'parsing_content', 
        'ai_processing',
        'persisting_data',
        'vectorizing',
        'completed',
        'failed',
        'retry_pending',
        'cancelled'
    )),
    
    -- Chunking status (separate from main status)
    chunking_status TEXT,
    chunking_error_info TEXT,
    
    -- Queue management
    priority INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,                            -- ISO 8601 timestamp
    next_attempt_at TEXT,                            -- ISO 8601 timestamp for retries
    
    -- Progress and error tracking
    progress TEXT,                                   -- JSON: { stage, percent, message }
    error_info TEXT,
    failed_stage TEXT,
    
    -- Additional data
    job_specific_data TEXT,                          -- JSON for job-type specific data
    related_object_id TEXT,                          -- Link to created object
    
    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')),
    completed_at TEXT,
    
    FOREIGN KEY (related_object_id) REFERENCES objects(id) ON DELETE SET NULL
);

-- Indexes for ingestion jobs
CREATE INDEX idx_ingestion_jobs_status ON ingestion_jobs(status);
CREATE INDEX idx_ingestion_jobs_job_type ON ingestion_jobs(job_type);
CREATE INDEX idx_ingestion_jobs_priority_status ON ingestion_jobs(priority DESC, status);
CREATE INDEX idx_ingestion_jobs_next_attempt ON ingestion_jobs(next_attempt_at) WHERE status = 'retry_pending';
CREATE INDEX idx_ingestion_jobs_created_at ON ingestion_jobs(created_at);
CREATE INDEX idx_ingestion_jobs_related_object ON ingestion_jobs(related_object_id);

-- Auto-update trigger for ingestion jobs
CREATE TRIGGER update_ingestion_jobs_updated_at
AFTER UPDATE ON ingestion_jobs
BEGIN
    UPDATE ingestion_jobs SET updated_at = strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now') WHERE id = NEW.id;
END;

-- Insert default user profile
INSERT INTO user_profiles (user_id, name, updated_at) 
VALUES ('default_user', 'Default User', strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now'));

-- Insert special notebook for homepage conversations
INSERT INTO notebooks (id, title, description, created_at, updated_at)
VALUES (
    'cover-default_user',
    'Homepage Conversations',
    'Chat sessions from the Jeffers homepage',
    strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now'),
    strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')
);