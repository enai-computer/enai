CREATE TABLE IF NOT EXISTS content (
    bookmark_id TEXT PRIMARY KEY,
    title       TEXT,
    byline      TEXT,
    body        TEXT,
    length      INTEGER,
    source_url  TEXT NOT NULL, -- Store the final URL after redirects
    fetched_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    status      TEXT NOT NULL, -- 'pending', 'ok', 'timeout', 'too_large', 'parse_fail', 'http_error', 'fetch_error'
    FOREIGN KEY (bookmark_id) REFERENCES bookmarks(bookmark_id) ON DELETE CASCADE
);

-- Optional: Add an index for faster status lookups if needed later
-- CREATE INDEX IF NOT EXISTS idx_content_status ON content(status); 