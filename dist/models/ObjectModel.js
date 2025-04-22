"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.objectModel = void 0;
const uuid_1 = require("uuid");
const db_1 = __importDefault(require("./db"));
const logger_1 = require("../utils/logger");
// Helper to ensure date strings are in ISO 8601 format (YYYY-MM-DDTHH:MM:SS.SSSZ)
// SQLite's strftime('%Y-%m-%dT%H:%M:%fZ', ...) produces this format.
const ensureISOString = (date) => {
    if (!date)
        return null;
    if (date instanceof Date)
        return date.toISOString();
    // Basic check if it already looks like an ISO string
    if (typeof date === 'string' && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(date)) {
        return date;
    }
    // Attempt conversion if it's a different string format or number (timestamp)
    try {
        return new Date(date).toISOString();
    }
    catch (e) {
        logger_1.logger.warn(`[ObjectModel] Could not convert date to ISO string: ${date}`);
        return null; // Or throw an error depending on strictness needed
    }
};
class ObjectModel {
    constructor() {
        this.db = (0, db_1.default)();
    }
    /**
     * Creates a new object record in the database.
     * Generates a UUID v4 for the ID.
     * Uses INSERT OR IGNORE on source_uri to prevent duplicates.
     * If the object already exists (based on source_uri), it returns the existing object.
     */
    createObject(data) {
        var _a, _b, _c, _d, _e, _f;
        const id = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO objects (id, object_type, source_uri, title, status, raw_content_ref, parsed_at, created_at, updated_at)
      VALUES (@id, @object_type, @source_uri, @title, @status, @raw_content_ref, @parsed_at, @created_at, @updated_at)
    `);
        const findStmt = this.db.prepare('SELECT * FROM objects WHERE source_uri = @source_uri');
        try {
            const info = insertStmt.run({
                id: id,
                object_type: data.object_type,
                source_uri: data.source_uri,
                title: (_a = data.title) !== null && _a !== void 0 ? _a : null,
                status: (_b = data.status) !== null && _b !== void 0 ? _b : 'new',
                raw_content_ref: (_c = data.raw_content_ref) !== null && _c !== void 0 ? _c : null,
                parsed_at: ensureISOString(data.parsed_at), // Use helper
                created_at: now,
                updated_at: now,
            });
            if (info.changes > 0) {
                // Insert successful, return the newly created object data
                logger_1.logger.debug(`[ObjectModel] Created new object with ID: ${id} for URI: ${data.source_uri}`);
                return {
                    id: id,
                    object_type: data.object_type,
                    source_uri: data.source_uri,
                    title: (_d = data.title) !== null && _d !== void 0 ? _d : null,
                    status: (_e = data.status) !== null && _e !== void 0 ? _e : 'new',
                    raw_content_ref: (_f = data.raw_content_ref) !== null && _f !== void 0 ? _f : null,
                    parsed_at: ensureISOString(data.parsed_at),
                    created_at: now,
                    updated_at: now,
                };
            }
            else {
                // Insert ignored (duplicate source_uri), fetch and return the existing object
                logger_1.logger.debug(`[ObjectModel] Object already exists for URI: ${data.source_uri}. Fetching existing.`);
                const existingObject = findStmt.get({ source_uri: data.source_uri });
                if (!existingObject) {
                    // This case should be rare due to INSERT OR IGNORE but handle defensively
                    logger_1.logger.error(`[ObjectModel] Failed to find existing object after INSERT IGNORE for URI: ${data.source_uri}`);
                    return null;
                }
                return existingObject;
            }
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to create or find object for URI ${data.source_uri}:`, error);
            throw error; // Re-throw for service layer
        }
    }
    /**
     * Retrieves an object by its UUID.
     */
    getObjectById(id) {
        const stmt = this.db.prepare('SELECT * FROM objects WHERE id = ?');
        try {
            const row = stmt.get(id);
            return row !== null && row !== void 0 ? row : null;
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to get object by ID ${id}:`, error);
            throw error;
        }
    }
    /**
     * Retrieves an object by its source URI.
     */
    getObjectBySourceUri(source_uri) {
        const stmt = this.db.prepare('SELECT * FROM objects WHERE source_uri = ?');
        try {
            const row = stmt.get(source_uri);
            return row !== null && row !== void 0 ? row : null;
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to get object by source URI ${source_uri}:`, error);
            throw error;
        }
    }
    /**
     * Updates the status of an object. Also updates 'updated_at'.
     */
    updateStatus(id, status) {
        // Note: The trigger 'objects_updated_at' handles updating the 'updated_at' column automatically.
        const stmt = this.db.prepare('UPDATE objects SET status = ? WHERE id = ?');
        try {
            const info = stmt.run(status, id);
            const success = info.changes > 0;
            if (success) {
                logger_1.logger.debug(`[ObjectModel] Updated status to '${status}' for object ID: ${id}`);
            }
            else {
                logger_1.logger.warn(`[ObjectModel] Attempted to update status for non-existent object ID: ${id}`);
            }
            return success;
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to update status for object ID ${id}:`, error);
            throw error;
        }
    }
    /**
    * Updates specified fields of an object.
    * Automatically updates 'updated_at' via trigger.
    * Fields not included in the 'data' object remain unchanged.
    */
    updateObject(id, data) {
        const fieldsToUpdate = Object.keys(data).filter(key => key !== 'id' && key !== 'created_at' && key !== 'updated_at');
        if (fieldsToUpdate.length === 0) {
            logger_1.logger.warn(`[ObjectModel] No fields provided to update for object ID: ${id}`);
            return false;
        }
        // Handle date conversion for parsed_at if present
        const params = Object.assign({}, data);
        if ('parsed_at' in params) {
            params.parsed_at = ensureISOString(params.parsed_at);
        }
        const setClause = fieldsToUpdate.map(key => `${key.replace(/([A-Z])/g, '_$1').toLowerCase()} = @${key}`).join(', '); // Convert camelCase keys to snake_case for SQL
        const sql = `UPDATE objects SET ${setClause} WHERE id = @id`;
        const stmt = this.db.prepare(sql);
        try {
            const info = stmt.run(Object.assign(Object.assign({}, params), { id: id }));
            const success = info.changes > 0;
            if (success) {
                logger_1.logger.debug(`[ObjectModel] Updated fields [${fieldsToUpdate.join(', ')}] for object ID: ${id}`);
            }
            else {
                logger_1.logger.warn(`[ObjectModel] Attempted to update non-existent object ID: ${id}`);
            }
            return success;
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to update object ID ${id}:`, error);
            throw error;
        }
    }
    /**
     * Finds objects matching a list of statuses.
     */
    findObjectsByStatus(statuses, limit) {
        const statusArray = Array.isArray(statuses) ? statuses : [statuses];
        if (statusArray.length === 0) {
            return [];
        }
        const placeholders = statusArray.map(() => '?').join(', ');
        let sql = `SELECT * FROM objects WHERE status IN (${placeholders})`;
        if (limit && limit > 0) {
            sql += ` LIMIT ${limit}`;
        }
        const stmt = this.db.prepare(sql);
        try {
            const rows = stmt.all(...statusArray);
            logger_1.logger.debug(`[ObjectModel] Found ${rows.length} objects with statuses: ${statusArray.join(', ')}`);
            return rows;
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to find objects by statuses (${statusArray.join(', ')}):`, error);
            throw error;
        }
    }
    /**
     * Gets all objects, potentially useful for admin or debugging. Use with caution on large datasets.
     */
    getAllObjects() {
        const stmt = this.db.prepare('SELECT * FROM objects ORDER BY created_at DESC');
        try {
            const rows = stmt.all();
            logger_1.logger.debug(`[ObjectModel] Retrieved ${rows.length} objects.`);
            return rows;
        }
        catch (error) {
            logger_1.logger.error('[ObjectModel] Failed to get all objects:', error);
            throw error;
        }
    }
}
// Export a singleton instance
exports.objectModel = new ObjectModel();
//# sourceMappingURL=ObjectModel.js.map