"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
const db_1 = __importDefault(require("../models/db"));
function up() {
    const db = (0, db_1.default)();
    db.exec(`
    CREATE TABLE IF NOT EXISTS content (
      id           INTEGER PRIMARY KEY, -- Changed from UUID to INTEGER for simplicity for now
      bookmark_id  INTEGER NOT NULL UNIQUE, -- Added UNIQUE constraint, assumes one content per bookmark
      raw_html     TEXT,
      text         TEXT,
      metadata     JSON, -- Store things like title, lang, fetch errors, etc.
      status       TEXT DEFAULT 'pending', -- e.g., pending, fetched, parsed, error, timeout
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME, -- Consider a trigger to auto-update this
      FOREIGN KEY(bookmark_id) REFERENCES bookmarks(bookmark_id) ON DELETE CASCADE -- Added FK
    );

    -- Index for faster lookup by bookmark_id
    CREATE INDEX IF NOT EXISTS idx_content_bookmark_id ON content(bookmark_id);

    -- Optional: Trigger to update updated_at timestamp
    CREATE TRIGGER IF NOT EXISTS trigger_content_updated_at
    AFTER UPDATE ON content
    FOR EACH ROW
    BEGIN
      UPDATE content SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;
  `);
    console.log('[Migration] Applied: create_content_table');
}
// Optional: Add down migration if needed
// export function down() { ... } 
//# sourceMappingURL=20250418_create_content_table.js.map