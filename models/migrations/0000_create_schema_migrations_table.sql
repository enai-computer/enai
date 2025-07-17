-- Migration to create the table that tracks which migrations have been applied.
-- This should always be the first migration.
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now'))
); 