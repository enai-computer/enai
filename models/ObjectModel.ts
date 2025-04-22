import { v4 as uuidv4 } from 'uuid';
import getDb from './db';
import { logger } from '../utils/logger';
import { JeffersObject, ObjectStatus } from '../shared/types'; // Assuming these types exist/will exist

// Define the structure returned by the database (snake_case)
interface ObjectRecord {
  id: string;
  object_type: string;
  source_uri: string | null;
  title: string | null;
  status: string;
  raw_content_ref: string | null;
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
    parsedAt: record.parsed_at ? new Date(record.parsed_at) : undefined, // Convert ISO string to Date
    createdAt: new Date(record.created_at), // Convert ISO string to Date
    updatedAt: new Date(record.updated_at), // Convert ISO string to Date
  };
}


export class ObjectModel {
  /**
   * Creates a new object record in the database.
   * Generates a UUID v4 for the new record.
   * @param data - The object data excluding id, createdAt, updatedAt.
   * @returns The fully created JeffersObject including generated fields.
   */
  async create(
    data: Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt' | 'parsedAt' | 'status'> & { status?: ObjectStatus, parsedAt?: Date | string }
  ): Promise<JeffersObject> {
    const db = getDb();
    const newId = uuidv4();
    // Ensure timestamps are ISO strings for SQLite
    const now = new Date().toISOString();
    const parsedAtISO = data.parsedAt instanceof Date ? data.parsedAt.toISOString() : data.parsedAt;

    const stmt = db.prepare(`
      INSERT INTO objects (id, object_type, source_uri, title, status, raw_content_ref, parsed_at, created_at, updated_at)
      VALUES (@id, @objectType, @sourceUri, @title, @status, @rawContentRef, @parsedAt, @createdAt, @updatedAt)
    `);

    try {
      stmt.run({
        id: newId,
        objectType: data.objectType,
        sourceUri: data.sourceUri ?? null,
        title: data.title ?? null,
        status: data.status ?? 'new', // Default status if not provided
        rawContentRef: data.rawContentRef ?? null,
        parsedAt: parsedAtISO ?? null,
        createdAt: now,
        updatedAt: now,
      });
      logger.debug(`[ObjectModel] Created object with ID: ${newId}`);

      // Fetch the newly created record to return the full object
      const newRecord = await this.getById(newId);
      if (!newRecord) {
          // Should not happen if insert succeeded
          throw new Error('Failed to retrieve newly created object');
      }
      return newRecord;

    } catch (error: any) {
        // Handle potential UNIQUE constraint violation on source_uri
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            logger.warn(`[ObjectModel] Attempted to create object with duplicate source_uri: ${data.sourceUri}`);
            // Option: Return the existing object instead of throwing?
            const existing = await this.getBySourceUri(data.sourceUri!);
            if (existing) return existing;
            // If somehow getBySourceUri fails after unique constraint, throw original error
            throw error;
        }
      logger.error(`[ObjectModel] Failed to create object for source URI ${data.sourceUri}:`, error);
      throw error; // Re-throw for service layer
    }
  }

  /**
   * Updates the status and potentially the parsed_at timestamp of an object.
   * Also updates the updated_at timestamp automatically via trigger or manually.
   * @param id - The UUID of the object to update.
   * @param status - The new status.
   * @param parsedAt - Optional date when parsing was completed.
   * @returns Promise<void>
   */
  async updateStatus(id: string, status: ObjectStatus, parsedAt?: Date): Promise<void> {
    const db = getDb();
    // Trigger handles updated_at, but include parsed_at if provided
    const fieldsToSet: string[] = ['status = @status'];
    const params: Record<string, any> = { id, status };

    if (parsedAt) {
        fieldsToSet.push('parsed_at = @parsedAt');
        params.parsedAt = parsedAt.toISOString();
    }
    // Explicitly set updated_at if not using trigger (trigger IS defined in migration 0003)
    // fieldsToSet.push('updated_at = @updatedAt');
    // params.updatedAt = new Date().toISOString();

    const stmt = db.prepare(`
      UPDATE objects
      SET ${fieldsToSet.join(', ')}
      WHERE id = @id
    `);

    try {
      const info = stmt.run(params);
      if (info.changes > 0) {
        logger.debug(`[ObjectModel] Updated status for object ${id} to ${status}`);
      } else {
        logger.warn(`[ObjectModel] Attempted to update status for non-existent object ID ${id}`);
        // Optionally throw an error if the object must exist
        // throw new Error(`Object with ID ${id} not found for status update.`);
      }
    } catch (error) {
      logger.error(`[ObjectModel] Failed to update status for object ${id}:`, error);
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
    const db = getDb();
    // Initially fetch 'parsed' objects for chunking/embedding
    // Could be expanded later: e.g., 'fetched' for parsing
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
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM objects WHERE id = ?');
    try {
        const record = stmt.get(id) as ObjectRecord | undefined;
        if (record) {
            return mapRecordToObject(record);
        }
        return null;
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
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM objects WHERE source_uri = ?');
     try {
        const record = stmt.get(uri) as ObjectRecord | undefined;
        if (record) {
            return mapRecordToObject(record);
        }
        return null;
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
      const db = getDb();
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

// Export a singleton instance
export const objectModel = new ObjectModel(); 