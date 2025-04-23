-- Migration to create the table that tracks which migrations have been applied.
-- This should always be the first migration.
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
); 