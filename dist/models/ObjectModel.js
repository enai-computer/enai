"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectModel = void 0;
const uuid_1 = require("uuid");
const db_1 = require("./db");
const logger_1 = require("../utils/logger");
// Helper to convert DB record (snake_case) to application object (camelCase)
// TODO: Consider a more robust mapping solution if needed
function mapRecordToObject(record) {
    return {
        id: record.id,
        objectType: record.object_type,
        sourceUri: record.source_uri,
        title: record.title,
        status: record.status, // Type assertion
        rawContentRef: record.raw_content_ref,
        parsedContentJson: record.parsed_content_json,
        errorInfo: record.error_info,
        parsedAt: record.parsed_at ? new Date(record.parsed_at) : undefined, // Convert ISO string to Date
        createdAt: new Date(record.created_at), // Convert ISO string to Date
        updatedAt: new Date(record.updated_at), // Convert ISO string to Date
    };
}
class ObjectModel {
    constructor(dbInstance) {
        this.db = dbInstance !== null && dbInstance !== void 0 ? dbInstance : (0, db_1.getDb)(); // Use provided instance or default singleton
    }
    /**
     * Creates a new object record in the database.
     * Generates a UUID v4 for the new record.
     * @param data - The object data excluding id, createdAt, updatedAt.
     * @returns The fully created JeffersObject including generated fields.
     */
    async create(data // Allow providing status, parsedAt, parsedContentJson, errorInfo optionally
    ) {
        var _a, _b, _c, _d, _e, _f;
        const db = this.db;
        const newId = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        const parsedAtISO = data.parsedAt instanceof Date ? data.parsedAt.toISOString() : data.parsedAt;
        const stmt = db.prepare(`
      INSERT INTO objects (
        id, object_type, source_uri, title, status,
        raw_content_ref, parsed_content_json, error_info, parsed_at,
        created_at, updated_at
      )
      VALUES (
        @id, @objectType, @sourceUri, @title, @status,
        @rawContentRef, @parsedContentJson, @errorInfo, @parsedAt,
        @createdAt, @updatedAt
      )
    `);
        try {
            stmt.run({
                id: newId,
                objectType: data.objectType,
                sourceUri: (_a = data.sourceUri) !== null && _a !== void 0 ? _a : null,
                title: (_b = data.title) !== null && _b !== void 0 ? _b : null,
                status: (_c = data.status) !== null && _c !== void 0 ? _c : 'new',
                rawContentRef: (_d = data.rawContentRef) !== null && _d !== void 0 ? _d : null,
                parsedContentJson: (_e = data.parsedContentJson) !== null && _e !== void 0 ? _e : null, // Handle new field
                errorInfo: (_f = data.errorInfo) !== null && _f !== void 0 ? _f : null, // Handle new field
                parsedAt: parsedAtISO !== null && parsedAtISO !== void 0 ? parsedAtISO : null,
                createdAt: now,
                updatedAt: now,
            });
            logger_1.logger.debug(`[ObjectModel] Created object with ID: ${newId}`);
            const newRecord = await this.getById(newId);
            if (!newRecord) {
                throw new Error('Failed to retrieve newly created object');
            }
            return newRecord;
        }
        catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                logger_1.logger.warn(`[ObjectModel] Attempted to create object with duplicate source_uri: ${data.sourceUri}`);
                const existing = await this.getBySourceUri(data.sourceUri);
                if (existing)
                    return existing;
                throw error;
            }
            logger_1.logger.error(`[ObjectModel] Failed to create object for source URI ${data.sourceUri}:`, error);
            throw error;
        }
    }
    /**
     * Updates specific fields of an object record.
     * Automatically updates the updated_at timestamp via trigger.
     * @param id - The UUID of the object to update.
     * @param updates - An object containing fields to update (e.g., { status: 'parsed', title: 'New Title' }).
     * @returns Promise<void>
     */
    async update(id, updates) {
        const db = this.db;
        const fieldsToSet = [];
        const params = { id };
        // Map camelCase keys from updates to snake_case DB columns and add to query
        for (const key in updates) {
            if (Object.prototype.hasOwnProperty.call(updates, key)) {
                const dbKey = key
                    .replace('objectType', 'object_type')
                    .replace('sourceUri', 'source_uri')
                    .replace('rawContentRef', 'raw_content_ref')
                    .replace('parsedContentJson', 'parsed_content_json')
                    .replace('errorInfo', 'error_info')
                    .replace('parsedAt', 'parsed_at');
                // Handle Date objects for parsedAt
                if (key === 'parsedAt') {
                    params[dbKey] = updates.parsedAt instanceof Date ? updates.parsedAt.toISOString() : updates.parsedAt;
                }
                else {
                    params[dbKey] = updates[key];
                }
                // Only add if the key is a valid column name (basic check)
                if (dbKey !== key || ['status', 'title'].includes(key)) { // Simple check, might need refinement
                    fieldsToSet.push(`${dbKey} = @${dbKey}`);
                }
                else if (['parsedContentJson', 'errorInfo', 'rawContentRef', 'sourceUri', 'objectType', 'parsedAt'].includes(key)) {
                    fieldsToSet.push(`${dbKey} = @${dbKey}`);
                }
            }
        }
        if (fieldsToSet.length === 0) {
            logger_1.logger.warn(`[ObjectModel] Update called for object ${id} with no fields to update.`);
            return; // Nothing to update
        }
        // Trigger handles updated_at
        const stmt = db.prepare(`
      UPDATE objects
      SET ${fieldsToSet.join(', ')}
      WHERE id = @id
    `);
        try {
            const info = stmt.run(params);
            if (info.changes > 0) {
                logger_1.logger.debug(`[ObjectModel] Updated object ${id}. Fields: ${Object.keys(updates).join(', ')}`);
            }
            else {
                logger_1.logger.warn(`[ObjectModel] Attempted to update non-existent object ID ${id}`);
                // Optionally throw an error if the object must exist
                // throw new Error(`Object with ID ${id} not found for update.`);
            }
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to update object ${id}:`, error);
            throw error;
        }
    }
    /**
     * Updates the status of an object, optionally setting parsed_at and clearing error_info.
     * Primarily useful for simple status transitions. Use `update` for more complex changes.
     * @param id - The UUID of the object to update.
     * @param status - The new status.
     * @param parsedAt - Optional date when parsing was completed (often set with 'parsed' status).
     * @param errorInfo - Optional error details (often set with 'error' status). If undefined and status is not 'error', error_info is set to NULL.
     * @returns Promise<void>
     */
    async updateStatus(id, status, parsedAt, errorInfo) {
        const db = this.db;
        const fieldsToSet = ['status = @status'];
        const params = { id, status };
        if (parsedAt) {
            fieldsToSet.push('parsed_at = @parsedAt');
            params.parsedAt = parsedAt.toISOString();
        }
        // Set or clear error_info based on status and provided value
        fieldsToSet.push('error_info = @errorInfo');
        if (status === 'error') {
            params.errorInfo = errorInfo !== null && errorInfo !== void 0 ? errorInfo : null; // Set error info if status is error
        }
        else {
            params.errorInfo = null; // Clear error info if status is not error
        }
        // Trigger handles updated_at
        const stmt = db.prepare(`
      UPDATE objects
      SET ${fieldsToSet.join(', ')}
      WHERE id = @id
    `);
        try {
            const info = stmt.run(params);
            if (info.changes > 0) {
                logger_1.logger.debug(`[ObjectModel] Updated status for object ${id} to ${status}. Error info ${params.errorInfo === null ? 'cleared' : 'set'}.`);
            }
            else {
                logger_1.logger.warn(`[ObjectModel] Attempted to update status for non-existent object ID ${id}`);
            }
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to update status for object ${id}:`, error);
            throw error;
        }
    }
    /**
     * Finds objects matching a list of statuses.
     * Primarily used for re-queuing stale jobs on startup.
     * @param statuses - An array of ObjectStatus values to query for.
     * @returns An array of objects containing id and source_uri.
     */
    async findByStatus(statuses) {
        const db = this.db;
        if (!statuses || statuses.length === 0) {
            return [];
        }
        // Create placeholders for the IN clause (?, ?, ?)
        const placeholders = statuses.map(() => '?').join(', ');
        const stmt = db.prepare(`
        SELECT id, source_uri
        FROM objects
        WHERE status IN (${placeholders})
        ORDER BY created_at ASC -- Process older items first potentially
    `);
        try {
            // Type assertion: better-sqlite3 returns any[], we expect this structure.
            const rows = stmt.all(...statuses);
            logger_1.logger.debug(`[ObjectModel] Found ${rows.length} objects with statuses: ${statuses.join(', ')}`);
            return rows;
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to find objects by statuses (${statuses.join(', ')}):`, error);
            throw error;
        }
    }
    /**
     * Retrieves objects that are ready for the next stage of processing.
     * Currently targets objects with status 'parsed'.
     * @param limit - Maximum number of objects to retrieve.
     * @returns An array of JeffersObject ready for processing.
     */
    async getProcessableObjects(limit) {
        const db = this.db;
        // Initially fetch 'parsed' objects for chunking/embedding
        const targetStatus = 'parsed';
        const stmt = db.prepare(`
      SELECT * FROM objects
      WHERE status = ?
      ORDER BY created_at ASC -- Process oldest first
      LIMIT ?
    `);
        try {
            const records = stmt.all(targetStatus, limit);
            logger_1.logger.debug(`[ObjectModel] Found ${records.length} objects with status '${targetStatus}' to process.`);
            return records.map(mapRecordToObject);
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to get processable objects with status ${targetStatus}:`, error);
            throw error;
        }
    }
    /**
    * Retrieves a single object by its UUID.
    * @param id - The UUID of the object.
    * @returns The JeffersObject or null if not found.
    */
    async getById(id) {
        const db = this.db;
        const stmt = db.prepare('SELECT * FROM objects WHERE id = ?');
        try {
            const record = stmt.get(id);
            return record ? mapRecordToObject(record) : null; // Simplified return
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to get object by ID ${id}:`, error);
            throw error;
        }
    }
    /**
    * Retrieves a single object by its source URI.
    * Assumes source_uri is UNIQUE.
    * @param uri - The source URI of the object.
    * @returns The JeffersObject or null if not found.
    */
    async getBySourceUri(uri) {
        const db = this.db;
        const stmt = db.prepare('SELECT * FROM objects WHERE source_uri = ?');
        try {
            const record = stmt.get(uri);
            return record ? mapRecordToObject(record) : null; // Simplified return
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to get object by source URI ${uri}:`, error);
            throw error;
        }
    }
    /**
     * Deletes an object by its ID.
     * Cascading deletes should handle related chunks/embeddings due to FOREIGN KEY constraints.
     * @param id - The UUID of the object to delete.
     * @returns Promise<void>
     */
    async deleteById(id) {
        const db = this.db;
        const stmt = db.prepare('DELETE FROM objects WHERE id = ?');
        try {
            const info = stmt.run(id);
            if (info.changes > 0) {
                logger_1.logger.debug(`[ObjectModel] Deleted object with ID: ${id}`);
            }
            else {
                logger_1.logger.warn(`[ObjectModel] Attempted to delete non-existent object ID ${id}`);
            }
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to delete object by ID ${id}:`, error);
            throw error;
        }
    }
}
exports.ObjectModel = ObjectModel;
//# sourceMappingURL=ObjectModel.js.map