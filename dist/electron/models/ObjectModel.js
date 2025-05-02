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
        cleanedText: record.cleaned_text,
        errorInfo: record.error_info,
        parsedAt: record.parsed_at ? new Date(record.parsed_at) : undefined, // Convert ISO string to Date
        createdAt: new Date(record.created_at), // Convert ISO string to Date
        updatedAt: new Date(record.updated_at), // Convert ISO string to Date
    };
}
// Explicit mapping from JeffersObject keys (camelCase) to DB columns (snake_case)
const objectColumnMap = {
    objectType: 'object_type',
    sourceUri: 'source_uri',
    title: 'title',
    status: 'status',
    rawContentRef: 'raw_content_ref',
    parsedContentJson: 'parsed_content_json',
    cleanedText: 'cleaned_text',
    errorInfo: 'error_info',
    parsedAt: 'parsed_at', // Special handling needed for Date -> string
};
class ObjectModel {
    constructor(dbInstance) {
        this.db = dbInstance ?? (0, db_1.getDb)(); // Use provided instance or default singleton
    }
    /**
     * Creates a new object record in the database.
     * Generates a UUID v4 for the new record.
     * Handles unique constraint violation on source_uri by returning existing object.
     * Underlying DB operation is synchronous.
     * @param data - The object data excluding id, createdAt, updatedAt.
     * @returns Promise resolving to the fully created JeffersObject including generated fields.
     */
    async create(data) {
        const db = this.db;
        const newId = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        const parsedAtISO = data.parsedAt instanceof Date ? data.parsedAt.toISOString() : data.parsedAt;
        const stmt = db.prepare(`
      INSERT INTO objects (
        id, object_type, source_uri, title, status,
        raw_content_ref, parsed_content_json, cleaned_text, error_info, parsed_at,
        created_at, updated_at
      )
      VALUES (
        @id, @objectType, @sourceUri, @title, @status,
        @rawContentRef, @parsedContentJson, @cleanedText, @errorInfo, @parsedAt,
        @createdAt, @updatedAt
      )
    `);
        try {
            // Note: better-sqlite3 operations are synchronous
            stmt.run({
                id: newId,
                objectType: data.objectType,
                sourceUri: data.sourceUri ?? null,
                title: data.title ?? null,
                status: data.status ?? 'new',
                rawContentRef: data.rawContentRef ?? null,
                parsedContentJson: data.parsedContentJson ?? null,
                cleanedText: data.cleanedText ?? null, // Allow providing cleanedText
                errorInfo: data.errorInfo ?? null,
                parsedAt: parsedAtISO ?? null,
                createdAt: now,
                updatedAt: now,
            });
            logger_1.logger.debug(`[ObjectModel] Created object with ID: ${newId}`);
            const newRecord = await this.getById(newId); // Fetch the created record
            if (!newRecord) {
                // This should not happen if insert succeeded and getById is correct
                throw new Error('Failed to retrieve newly created object');
            }
            return newRecord;
        }
        catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                // Check if the violation might be due to a non-null source_uri
                if (data.sourceUri) {
                    logger_1.logger.warn(`[ObjectModel] Attempted to create object with duplicate source_uri: ${data.sourceUri}. Fetching existing.`);
                    const existing = await this.getBySourceUri(data.sourceUri); // Fetch existing by URI
                    if (existing)
                        return existing; // Return the existing object if found
                    // If not found by URI despite constraint error, something else is wrong
                    logger_1.logger.error(`[ObjectModel] Unique constraint error for source_uri ${data.sourceUri}, but no existing object found by URI.`);
                }
                // If sourceUri was null, or getBySourceUri failed, re-throw the original error
                logger_1.logger.error(`[ObjectModel] Unique constraint violation during create (source_uri: ${data.sourceUri}):`, error);
                throw error; // Re-throw original error
            }
            else {
                // Handle other errors
                logger_1.logger.error(`[ObjectModel] Failed to create object for source URI ${data.sourceUri}:`, error);
                throw error;
            }
        }
    }
    /**
     * Updates specific fields of an object record.
     * Uses an explicit mapping to prevent invalid column names.
     * Automatically updates the updated_at timestamp via trigger.
     * Underlying DB operation is synchronous.
     * @param id - The UUID of the object to update.
     * @param updates - An object containing fields to update (e.g., { status: 'parsed', title: 'New Title' }).
     * @returns Promise resolving when the update is complete.
     */
    async update(id, updates) {
        const db = this.db;
        const fieldsToSet = [];
        const params = { id };
        // Use explicit mapping to build SET clause safely
        for (const key in updates) {
            if (Object.prototype.hasOwnProperty.call(updates, key)) {
                const typedKey = key;
                // Explicitly skip trying to update sourceUri, as it should be immutable
                if (typedKey === 'sourceUri') {
                    logger_1.logger.debug(`[ObjectModel] Skipping update of immutable field: ${key}`);
                    continue; // Go to the next key in the updates object
                }
                const dbColumn = objectColumnMap[typedKey];
                if (dbColumn) {
                    fieldsToSet.push(`${dbColumn} = @${typedKey}`); // Use original key for param name
                    // Handle Date object for parsedAt specifically
                    if (typedKey === 'parsedAt') {
                        params[typedKey] = updates.parsedAt instanceof Date ? updates.parsedAt.toISOString() : updates.parsedAt;
                    }
                    else {
                        params[typedKey] = updates[typedKey];
                    }
                }
                else {
                    logger_1.logger.warn(`[ObjectModel] Update called with unmapped property: ${key}`);
                }
            }
        }
        if (fieldsToSet.length === 0) {
            logger_1.logger.warn(`[ObjectModel] Update called for object ${id} with no valid fields to update.`);
            return; // Nothing to update
        }
        // Trigger handles updated_at
        const stmt = db.prepare(`
      UPDATE objects
      SET ${fieldsToSet.join(', ')}
      WHERE id = @id
    `);
        try {
            // Note: better-sqlite3 operations are synchronous
            const info = stmt.run(params);
            if (info.changes > 0) {
                logger_1.logger.debug(`[ObjectModel] Updated object ${id}. Fields: ${Object.keys(updates).filter(k => objectColumnMap[k]).join(', ')}`);
            }
            else {
                logger_1.logger.warn(`[ObjectModel] Attempted to update non-existent object ID ${id}`);
            }
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to update object ${id}:`, error);
            throw error;
        }
    }
    /**
     * Updates the status of an object, optionally setting parsed_at and error_info.
     * Clears error_info when status is not 'error'.
     * Underlying DB operation is synchronous.
     * @param id - The UUID of the object to update.
     * @param status - The new status.
     * @param parsedAt - Optional date when parsing was completed (often set with 'parsed' status).
     * @param errorInfo - Optional error details (only set if status is 'error').
     * @returns Promise resolving when the update is complete.
     */
    async updateStatus(id, status, parsedAt, errorInfo) {
        const db = this.db;
        const fieldsToSet = ['status = @status'];
        const params = { id, status };
        // Only add parsed_at if provided
        if (parsedAt) {
            fieldsToSet.push('parsed_at = @parsedAt');
            params.parsedAt = parsedAt.toISOString();
        }
        // Handle error_info based on the new status
        fieldsToSet.push('error_info = @errorInfo');
        if (status === 'error') {
            // Set errorInfo if status is 'error', use provided value or null
            params.errorInfo = errorInfo ?? null;
        }
        else {
            // Clear errorInfo if status is not 'error'
            params.errorInfo = null;
        }
        // Trigger handles updated_at
        const stmt = db.prepare(`
      UPDATE objects
      SET ${fieldsToSet.join(', ')}
      WHERE id = @id
    `);
        try {
            // Note: better-sqlite3 operations are synchronous
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
     * NOTE: Vulnerable to >999 variable limit. Implement batching if needed.
     * Underlying DB operation is synchronous.
     * @param statuses - An array of ObjectStatus values to query for.
     * @returns Promise resolving to an array of objects containing id and source_uri.
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
     * Underlying DB operation is synchronous.
     * @param limit - Maximum number of objects to retrieve.
     * @returns Promise resolving to an array of JeffersObject ready for processing.
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
    * Underlying DB operation is synchronous.
    * @param id - The UUID of the object.
    * @returns Promise resolving to the JeffersObject or null if not found.
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
    * Assumes source_uri is UNIQUE (or returns the first match).
    * Underlying DB operation is synchronous.
    * @param uri - The source URI of the object.
    * @returns Promise resolving to the JeffersObject or null if not found.
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
     * Underlying DB operation is synchronous.
     * @param id - The UUID of the object to delete.
     * @returns Promise resolving when the delete is complete.
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
    /**
     * Fetches minimal metadata for the given source object IDs.
     * Returns a Map keyed by object ID for easy lookup.
     * NOTE: Vulnerable to >999 variable limit. Implement batching if needed.
     * Underlying DB operation is synchronous.
     * @param objectIds Array of source object UUIDs.
     * @returns Promise resolving to a Map<string, SourceMetadata>.
     */
    async getSourceContentDetailsByIds(objectIds) {
        const resultsMap = new Map();
        if (!objectIds || objectIds.length === 0) {
            return resultsMap;
        }
        const placeholders = objectIds.map(() => '?').join(', ');
        const query = `SELECT id, title, source_uri, object_type FROM objects WHERE id IN (${placeholders})`;
        try {
            logger_1.logger.debug(`[ObjectModel] Fetching details for object IDs: [${objectIds.slice(0, 5).join(', ')}...] (${objectIds.length} total)`);
            const stmt = this.db.prepare(query);
            // Use SPREAD operator (...) for multiple bindings
            const rows = stmt.all(...objectIds);
            logger_1.logger.debug(`[ObjectModel] Found ${rows.length} details for ${objectIds.length} IDs.`);
            rows.forEach(row => {
                resultsMap.set(row.id, {
                    id: row.id,
                    title: row.title,
                    sourceUri: row.source_uri,
                    objectType: row.object_type,
                });
            });
            return resultsMap;
        }
        catch (error) {
            logger_1.logger.error(`[ObjectModel] Failed to fetch details for object IDs: [${objectIds.slice(0, 5).join(', ')}...]`, error);
            throw new Error(`Database error fetching source content details: ${error.message}`);
        }
    }
}
exports.ObjectModel = ObjectModel;
//# sourceMappingURL=ObjectModel.js.map