-- Create user_todos table for task management
CREATE TABLE IF NOT EXISTS user_todos (
    id TEXT PRIMARY KEY,  -- UUID v4
    user_id TEXT NOT NULL,  -- Foreign key to user_profiles
    title TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL,  -- Unix epoch milliseconds
    due_date INTEGER,  -- Unix epoch milliseconds (optional)
    completed_at INTEGER,  -- Unix epoch milliseconds (optional)
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER,  -- 1-5, lower is higher priority
    parent_todo_id TEXT,  -- Self-referencing foreign key for subtasks
    project_or_goal_id TEXT,  -- Links to goal IDs from user_profiles JSON
    related_object_ids_json TEXT,  -- JSON array of related object/chunk IDs
    updated_at INTEGER NOT NULL,  -- Unix epoch milliseconds
    
    -- Constraints
    CHECK (status IN ('pending', 'in_progress', 'completed', 'archived')),
    CHECK (priority IS NULL OR (priority >= 1 AND priority <= 5)),
    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_todo_id) REFERENCES user_todos(id) ON DELETE SET NULL
);

-- Create indexes for common query patterns
CREATE INDEX idx_user_todos_user_id ON user_todos(user_id);
CREATE INDEX idx_user_todos_status ON user_todos(status);
CREATE INDEX idx_user_todos_due_date ON user_todos(due_date);
CREATE INDEX idx_user_todos_parent_todo ON user_todos(parent_todo_id);
CREATE INDEX idx_user_todos_user_status ON user_todos(user_id, status);
CREATE INDEX idx_user_todos_user_due_date ON user_todos(user_id, due_date);