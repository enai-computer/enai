"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertIfNew = insertIfNew;
exports.getExistingUrlHashes = getExistingUrlHashes;
const db_1 = require("./db");
const logger_1 = require("../utils/logger");
// Get the DB instance -- REMOVED FROM TOP LEVEL
// const db = getDb();
// Prepare statements for performance -- REMOVED FROM TOP LEVEL
// Use transactions for multiple operations for atomicity and performance
// const stmtInsert = db.prepare(
//   'INSERT OR IGNORE INTO bookmarks (url, url_hash) VALUES (?, ?)'
// );
// const stmtSelectId = db.prepare(
//   'SELECT bookmark_id FROM bookmarks WHERE url_hash = ?'
// );
// const stmtSelectAllHashes = db.prepare('SELECT url_hash FROM bookmarks');
/**
 * Attempts to insert a bookmark based on its URL and hash.
 * Uses INSERT OR IGNORE to avoid duplicates on url_hash.
 * Returns the ID and whether the insert was successful (i.e., it was new).
 * Note: This function involves two separate statements, consider wrapping in a transaction
 * if atomicity between insert and select is critical for complex workflows.
 */
function insertIfNew(url, urlHash) {
    var _a;
    try {
        // Get DB and prepare statements lazily inside the function
        const db = (0, db_1.getDb)();
        const stmtInsert = db.prepare('INSERT OR IGNORE INTO bookmarks (url, url_hash) VALUES (?, ?)');
        const stmtSelectId = db.prepare('SELECT bookmark_id FROM bookmarks WHERE url_hash = ?');
        const insertInfo = stmtInsert.run(url, urlHash);
        const wasNew = insertInfo.changes > 0;
        if (!wasNew) {
            // If it wasn't new, we still need the existing ID
            const row = stmtSelectId.get(urlHash);
            return { id: (_a = row === null || row === void 0 ? void 0 : row.bookmark_id) !== null && _a !== void 0 ? _a : null, wasNew: false };
        }
        else {
            // If it *was* new, the insertInfo.lastInsertRowid gives us the ID
            return { id: Number(insertInfo.lastInsertRowid), wasNew: true };
        }
    }
    catch (error) {
        logger_1.logger.error(`[BookmarkModel] Failed to insert/select bookmark for hash ${urlHash}:`, error);
        // Re-throw or handle error as appropriate for the service layer
        throw error;
    }
}
/**
 * Retrieves a Set containing all existing URL hashes from the bookmarks table.
 * Used for efficient in-memory checking before attempting inserts.
 */
function getExistingUrlHashes() {
    try {
        // Get DB and prepare statement lazily inside the function
        const db = (0, db_1.getDb)();
        const stmtSelectAllHashes = db.prepare('SELECT url_hash FROM bookmarks');
        // Type assertion assuming url_hash is always string and non-null
        const rows = stmtSelectAllHashes.all();
        return new Set(rows.map((r) => r.url_hash));
    }
    catch (error) {
        logger_1.logger.error('[BookmarkModel] Failed to retrieve existing URL hashes:', error);
        // Depending on the caller, returning an empty set might be safer than throwing
        // Or re-throw if the caller expects to handle DB errors.
        throw error;
    }
}
//# sourceMappingURL=BookmarkModel.js.map