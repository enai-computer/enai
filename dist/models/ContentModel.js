"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentModel = void 0;
const logger_1 = require("../utils/logger");
// Define the class
class ContentModel {
    /**
     * Creates an instance of ContentModel.
     * @param dbInstance - An initialized better-sqlite3 database instance.
     */
    constructor(dbInstance) {
        this.db = dbInstance;
    }
    /**
     * Inserts or replaces a record in the content table.
     * Uses bookmark_id as the primary key.
     * @returns The RunResult object from better-sqlite3.
     */
    upsertContent(record) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO content (
          bookmark_id, title, byline, body, length, source_url, fetched_at, status, error_info
        ) VALUES (
          @bookmarkId, @title, @byline, @body, @length, @sourceUrl, @fetchedAt, @status, @errorInfo
        )
      `);
        try {
            const info = stmt.run({
                bookmarkId: record.bookmarkId,
                title: (_b = (_a = record.parsedContent) === null || _a === void 0 ? void 0 : _a.title) !== null && _b !== void 0 ? _b : null,
                byline: (_d = (_c = record.parsedContent) === null || _c === void 0 ? void 0 : _c.byline) !== null && _d !== void 0 ? _d : null,
                body: (_f = (_e = record.parsedContent) === null || _e === void 0 ? void 0 : _e.textContent) !== null && _f !== void 0 ? _f : null, // Map Readability's textContent to the 'body' column
                length: (_h = (_g = record.parsedContent) === null || _g === void 0 ? void 0 : _g.length) !== null && _h !== void 0 ? _h : null,
                sourceUrl: record.sourceUrl,
                fetchedAt: ((_j = record.fetchedAt) !== null && _j !== void 0 ? _j : new Date()).toISOString(),
                status: record.status,
                errorInfo: (_k = record.errorInfo) !== null && _k !== void 0 ? _k : null, // Add errorInfo here, defaulting to null
            });
            if (info.changes > 0) {
                logger_1.logger.debug(`[ContentModel] Upserted content for bookmark ID ${record.bookmarkId} with status ${record.status}. Changes: ${info.changes}`);
            }
            else {
                logger_1.logger.debug(`[ContentModel] Content for bookmark ID ${record.bookmarkId} likely unchanged. Status: ${record.status}. Changes: ${info.changes}`);
            }
            return info;
        }
        catch (error) {
            logger_1.logger.error(`[ContentModel] Failed to upsert content for bookmark ID ${record.bookmarkId}:`, error);
            throw error; // Re-throw for the service layer to handle
        }
    }
    /**
     * Updates the status of a content record.
     * @returns The RunResult object from better-sqlite3.
     */
    updateContentStatus(bookmarkId, status, fetchedAt) {
        const stmt = this.db.prepare(`
            UPDATE content
            SET status = @status, fetched_at = @fetchedAt
            WHERE bookmark_id = @bookmarkId
        `);
        try {
            const info = stmt.run({
                bookmarkId: bookmarkId,
                status: status,
                fetchedAt: (fetchedAt !== null && fetchedAt !== void 0 ? fetchedAt : new Date()).toISOString(),
            });
            if (info.changes > 0) {
                logger_1.logger.debug(`[ContentModel] Updated status for bookmark ID ${bookmarkId} to ${status}`);
            }
            else {
                logger_1.logger.warn(`[ContentModel] Attempted to update status for non-existent bookmark ID ${bookmarkId}`);
            }
            return info;
        }
        catch (error) {
            logger_1.logger.error(`[ContentModel] Failed to update status for bookmark ID ${bookmarkId}:`, error);
            throw error;
        }
    }
    /**
     * Finds content records matching a list of statuses.
     * Primarily used for re-queuing stale jobs on startup.
     * @param statuses - An array of ContentStatus values to query for.
     * @returns An array of objects containing bookmark_id and source_url.
     */
    findByStatuses(statuses) {
        if (!statuses || statuses.length === 0) {
            return [];
        }
        // Create placeholders for the IN clause (?, ?, ?)
        const placeholders = statuses.map(() => '?').join(', ');
        const stmt = this.db.prepare(`
            SELECT bookmark_id, source_url
            FROM content
            WHERE status IN (${placeholders})
        `);
        try {
            // Type assertion: better-sqlite3 returns any[], we expect this structure.
            const rows = stmt.all(...statuses);
            logger_1.logger.debug(`[ContentModel] Found ${rows.length} content records with statuses: ${statuses.join(', ')}`);
            return rows;
        }
        catch (error) {
            logger_1.logger.error(`[ContentModel] Failed to find content by statuses (${statuses.join(', ')}):`, error);
            throw error; // Re-throw for the caller (main.ts) to handle
        }
    }
}
exports.ContentModel = ContentModel;
//# sourceMappingURL=ContentModel.js.map