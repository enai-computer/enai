import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import { logger } from '../utils/logger';
import { JeffersObject, ObjectStatus } from '../shared/types'; // Assuming these types exist/will exist
import Database from 'better-sqlite3';

// Define the structure returned by the database (snake_case)
interface ObjectRecord {
  id: string;
  object_type: string;
  source_uri: string | null;
  title: string | null;
  status: string;
  raw_content_ref: string | null;
  parsed_content_json: string | null;
  cleaned_text: string | null;
  error_info: string | null;
  parsed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Helper to convert DB record (snake_case) to application object (camelCase)
// TODO: Consider a more robust mapping solution if needed
function mapRecordToObject(record: ObjectRecord): JeffersObject {
  return {
    id: record.id,
    objectType: record.object_type,
    sourceUri: record.source_uri,
    title: record.title,
    status: record.status as ObjectStatus, // Type assertion
    rawContentRef: record.raw_content_ref,
    parsedContentJson: record.parsed_content_json,
    cleanedText: record.cleaned_text,
    errorInfo: record.error_info,
    parsedAt: record.parsed_at ? new Date(record.parsed_at) : undefined, // Convert ISO string to Date
    createdAt: new Date(record.created_at), // Convert ISO string to Date
    updatedAt: new Date(record.updated_at), // Convert ISO string to Date
  };
}


export class ObjectModel {
  private db: Database.Database;

  constructor(dbInstance?: Database.Database) {
    this.db = dbInstance ?? getDb(); // Use provided instance or default singleton
  }

  /**
   * Creates a new object record in the database.
   * Generates a UUID v4 for the new record.
   * @param data - The object data excluding id, createdAt, updatedAt.
   * @returns The fully created JeffersObject including generated fields.
   */
  async create(
    data: Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'> & { cleanedText?: string | null; } // Allow providing cleanedText optionally
  ): Promise<JeffersObject> {
    const db = this.db;
    const newId = uuidv4();
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
      stmt.run({
        id: newId,
        objectType: data.objectType,
        sourceUri: data.sourceUri ?? null,
        title: data.title ?? null,
        status: data.status ?? 'new',
        rawContentRef: data.rawContentRef ?? null,
        parsedContentJson: data.parsedContentJson ?? null,
        cleanedText: data.cleanedText ?? null,
        errorInfo: data.errorInfo ?? null,
        parsedAt: parsedAtISO ?? null,
        createdAt: now,
        updatedAt: now,
      });
      logger.debug(`[ObjectModel] Created object with ID: ${newId}`);

      const newRecord = await this.getById(newId);
      if (!newRecord) {
          throw new Error('Failed to retrieve newly created object');
      }
      return newRecord;

    } catch (error: any) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            logger.warn(`[ObjectModel] Attempted to create object with duplicate source_uri: ${data.sourceUri}`);
            const existing = await this.getBySourceUri(data.sourceUri!);
            if (existing) return existing;
            throw error;
        }
      logger.error(`[ObjectModel] Failed to create object for source URI ${data.sourceUri}:`, error);
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
  async update(id: string, updates: Partial<Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void> {
    const db = this.db;
    const fieldsToSet: string[] = [];
    const params: Record<string, any> = { id };

    // Map camelCase keys from updates to snake_case DB columns and add to query
    for (const key in updates) {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
            const dbKey = key
                .replace('objectType', 'object_type')
                .replace('sourceUri', 'source_uri')
                .replace('rawContentRef', 'raw_content_ref')
                .replace('parsedContentJson', 'parsed_content_json')
                .replace('cleanedText', 'cleaned_text')
                .replace('errorInfo', 'error_info')
                .replace('parsedAt', 'parsed_at');

            // Handle Date objects for parsedAt
            if (key === 'parsedAt') {
                 params[dbKey] = updates.parsedAt instanceof Date ? updates.parsedAt.toISOString() : updates.parsedAt;
            } else {
                params[dbKey] = (updates as any)[key];
            }

            // Only add if the key is a valid column name (basic check)
            if (dbKey !== key || ['status', 'title'].includes(key)) { // Simple check, might need refinement
                 fieldsToSet.push(`${dbKey} = @${dbKey}`);
            } else if (['parsedContentJson', 'cleanedText', 'errorInfo', 'rawContentRef', 'sourceUri', 'objectType', 'parsedAt'].includes(key)) {
                 fieldsToSet.push(`${dbKey} = @${dbKey}`);
            }
        }
    }

    if (fieldsToSet.length === 0) {
      logger.warn(`[ObjectModel] Update called for object ${id} with no fields to update.`);
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
        logger.debug(`[ObjectModel] Updated object ${id}. Fields: ${Object.keys(updates).join(', ')}`);
      } else {
        logger.warn(`[ObjectModel] Attempted to update non-existent object ID ${id}`);
        // Optionally throw an error if the object must exist
        // throw new Error(`Object with ID ${id} not found for update.`);
      }
    } catch (error) {
      logger.error(`[ObjectModel] Failed to update object ${id}:`, error);
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
  async updateStatus(id: string, status: ObjectStatus, parsedAt?: Date, errorInfo?: string | null): Promise<void> {
    const db = this.db;
    const fieldsToSet: string[] = ['status = @status'];
    const params: Record<string, any> = { id, status };

    if (parsedAt) {
        fieldsToSet.push('parsed_at = @parsedAt');
        params.parsedAt = parsedAt.toISOString();
    }

    // Set or clear error_info based on status and provided value
    fieldsToSet.push('error_info = @errorInfo');
    if (status === 'error') {
        params.errorInfo = errorInfo ?? null; // Set error info if status is error
    } else {
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
        logger.debug(`[ObjectModel] Updated status for object ${id} to ${status}. Error info ${params.errorInfo === null ? 'cleared' : 'set'}.`);
      } else {
        logger.warn(`[ObjectModel] Attempted to update status for non-existent object ID ${id}`);
      }
    } catch (error) {
      logger.error(`[ObjectModel] Failed to update status for object ${id}:`, error);
      throw error;
    }
  }

  /**
   * Finds objects matching a list of statuses.
   * Primarily used for re-queuing stale jobs on startup.
   * @param statuses - An array of ObjectStatus values to query for.
   * @returns An array of objects containing id and source_uri.
   */
  async findByStatus(statuses: ObjectStatus[]): Promise<{ id: string; source_uri: string | null }[]> {
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
        const rows = stmt.all(...statuses) as { id: string; source_uri: string | null }[];
        logger.debug(`[ObjectModel] Found ${rows.length} objects with statuses: ${statuses.join(', ')}`);
        return rows;
    } catch (error) {
        logger.error(`[ObjectModel] Failed to find objects by statuses (${statuses.join(', ')}):`, error);
        throw error;
    }
  }

  /**
   * Retrieves objects that are ready for the next stage of processing.
   * Currently targets objects with status 'parsed'.
   * @param limit - Maximum number of objects to retrieve.
   * @returns An array of JeffersObject ready for processing.
   */
  async getProcessableObjects(limit: number): Promise<JeffersObject[]> {
    const db = this.db;
    // Initially fetch 'parsed' objects for chunking/embedding
    const targetStatus: ObjectStatus = 'parsed';
    const stmt = db.prepare(`
      SELECT * FROM objects
      WHERE status = ?
      ORDER BY created_at ASC -- Process oldest first
      LIMIT ?
    `);

    try {
      const records = stmt.all(targetStatus, limit) as ObjectRecord[];
      logger.debug(`[ObjectModel] Found ${records.length} objects with status '${targetStatus}' to process.`);
      return records.map(mapRecordToObject);
    } catch (error) {
      logger.error(`[ObjectModel] Failed to get processable objects with status ${targetStatus}:`, error);
      throw error;
    }
  }

   /**
   * Retrieves a single object by its UUID.
   * @param id - The UUID of the object.
   * @returns The JeffersObject or null if not found.
   */
  async getById(id: string): Promise<JeffersObject | null> {
    const db = this.db;
    const stmt = db.prepare('SELECT * FROM objects WHERE id = ?');
    try {
        const record = stmt.get(id) as ObjectRecord | undefined;
        return record ? mapRecordToObject(record) : null; // Simplified return
    } catch (error) {
        logger.error(`[ObjectModel] Failed to get object by ID ${id}:`, error);
        throw error;
    }
  }

   /**
   * Retrieves a single object by its source URI.
   * Assumes source_uri is UNIQUE.
   * @param uri - The source URI of the object.
   * @returns The JeffersObject or null if not found.
   */
  async getBySourceUri(uri: string): Promise<JeffersObject | null> {
    const db = this.db;
    const stmt = db.prepare('SELECT * FROM objects WHERE source_uri = ?');
     try {
        const record = stmt.get(uri) as ObjectRecord | undefined;
        return record ? mapRecordToObject(record) : null; // Simplified return
    } catch (error) {
        logger.error(`[ObjectModel] Failed to get object by source URI ${uri}:`, error);
        throw error;
    }
  }

  /**
   * Deletes an object by its ID.
   * Cascading deletes should handle related chunks/embeddings due to FOREIGN KEY constraints.
   * @param id - The UUID of the object to delete.
   * @returns Promise<void>
   */
  async deleteById(id: string): Promise<void> {
      const db = this.db;
      const stmt = db.prepare('DELETE FROM objects WHERE id = ?');
      try {
          const info = stmt.run(id);
          if (info.changes > 0) {
              logger.debug(`[ObjectModel] Deleted object with ID: ${id}`);
          } else {
              logger.warn(`[ObjectModel] Attempted to delete non-existent object ID ${id}`);
          }
      } catch (error) {
          logger.error(`[ObjectModel] Failed to delete object by ID ${id}:`, error);
          throw error;
      }
  }

  // TODO: Add other methods as needed (e.g., listAll, updateTitle, etc.)
} 