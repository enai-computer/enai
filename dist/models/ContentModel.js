"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveContent = saveContent;
exports.saveErrorStatus = saveErrorStatus;
exports.updateContentStatus = updateContentStatus;
const db_1 = __importDefault(require("./db"));
const logger_1 = require("../utils/logger");
/**
 * Saves the fetched/parsed content for a bookmark.
 * Uses INSERT OR IGNORE based on bookmark_id UNIQUE constraint.
 */
function saveContent(data) {
    var _a, _b, _c;
    const db = (0, db_1.default)();
    try {
        // Prepare statement lazily for efficiency if called multiple times
        const stmt = db.prepare(`
      INSERT INTO content (bookmark_id, raw_html, text, metadata, status)
      VALUES (@bookmarkId, @rawHtml, @text, @metadata, @status)
      ON CONFLICT(bookmark_id) DO UPDATE SET
        raw_html = excluded.raw_html,
        text = excluded.text,
        metadata = excluded.metadata,
        status = excluded.status,
        updated_at = CURRENT_TIMESTAMP
    `);
        // Determine status based on input (simple logic for now)
        const status = data.rawHtml || data.text ? 'fetched' : 'error'; // Or perhaps 'parsed' if text is present
        stmt.run({
            bookmarkId: data.bookmarkId,
            rawHtml: (_a = data.rawHtml) !== null && _a !== void 0 ? _a : null, // Ensure null if undefined
            text: (_b = data.text) !== null && _b !== void 0 ? _b : null, // Ensure null if undefined
            metadata: JSON.stringify((_c = data.metadata) !== null && _c !== void 0 ? _c : {}), // Ensure empty object if undefined
            status: status,
        });
        // logger.debug(`[ContentModel] Saved content for bookmark ID: ${data.bookmarkId}, Status: ${status}`); // Temporarily commented out
    }
    catch (err) {
        // Check specifically for "no such table" error
        if (err.code === 'SQLITE_ERROR' && /no such table/i.test(err.message)) {
            logger_1.logger.error('[ContentModel] DB missing `content` table – run migrations before ingesting.');
            // Re-throw a more specific error for the service layer to potentially handle
            throw new Error('DB missing `content` table – run migrations before ingesting.');
        }
        // Log and re-throw other errors
        logger_1.logger.error(`[ContentModel] Error saving content for bookmark ID ${data.bookmarkId}:`, err);
        throw err;
    }
}
/**
 * Saves or updates an error status for a specific bookmark ID in the content table.
 * Useful for recording fetch failures, timeouts, parsing errors etc.
 * Uses INSERT ... ON CONFLICT to handle both new entries and updates.
 */
function saveErrorStatus(bookmarkId, status, errorMessage) {
    const db = (0, db_1.default)();
    try {
        const stmt = db.prepare(`
      INSERT INTO content (bookmark_id, status, metadata)
      VALUES (@bookmarkId, @status, @metadata)
      ON CONFLICT(bookmark_id) DO UPDATE SET
        status = excluded.status,
        -- Append new error to existing metadata if possible, otherwise create new
        metadata = json_patch(
                     json(metadata), -- Existing metadata
                     json_object('error', excluded.metadata) -- New error message as JSON object
                   ),
        -- metadata = JSON_SET(metadata, '$.error', excluded.metadata), -- Alternative if json_patch isn't suitable
        updated_at = CURRENT_TIMESTAMP
    `);
        // Store the error message in the metadata field
        const metadataWithError = JSON.stringify({ error: errorMessage !== null && errorMessage !== void 0 ? errorMessage : 'Unknown error' });
        stmt.run({
            bookmarkId: bookmarkId,
            status: status, // e.g., 'error', 'timeout', 'fetch_failed'
            metadata: metadataWithError,
        });
        logger_1.logger.warn(`[ContentModel] Saved error status '${status}' for bookmark ID: ${bookmarkId}`);
    }
    catch (err) {
        // Check specifically for "no such table" error
        if (err.code === 'SQLITE_ERROR' && /no such table/i.test(err.message)) {
            logger_1.logger.error('[ContentModel] DB missing `content` table – cannot save error status. Run migrations.');
            // Don't re-throw here, as logging the error might be sufficient during error handling itself
            return;
        }
        // Log other errors during status update
        logger_1.logger.error(`[ContentModel] Error saving error status '${status}' for bookmark ID ${bookmarkId}:`, err);
        // Decide if re-throwing is necessary based on context
        // throw err;
    }
}
/**
 * Optional: Function to update only the status of a content entry.
 *
 * @param bookmarkId The ID of the bookmark.
 * @param status The new status to set.
 */
function updateContentStatus(bookmarkId, status) {
    try {
        const db = (0, db_1.default)();
        const stmt = db.prepare(`UPDATE content SET status = ? WHERE bookmark_id = ?`);
        const info = stmt.run(status, bookmarkId);
        if (info.changes > 0) {
            logger_1.logger.debug(`[ContentModel] Updated status for bookmark_id ${bookmarkId} to ${status}`);
        }
        else {
            // This might happen if saveContent hasn't run yet or the ID is wrong
            logger_1.logger.warn(`[ContentModel] Attempted to update status for non-existent bookmark_id ${bookmarkId}`);
        }
    }
    catch (error) {
        logger_1.logger.error(`[ContentModel] Failed to update status for bookmark_id ${bookmarkId}:`, error);
        throw error;
    }
}
//# sourceMappingURL=ContentModel.js.map