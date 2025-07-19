import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { BaseModel } from './BaseModel';
import { logger } from '../utils/logger';
import { JeffersObject, ObjectStatus, MediaType } from '../shared/types';

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
  // PDF-specific fields
  file_hash: string | null;
  original_file_name: string | null;
  file_size_bytes: number | null;
  file_mime_type: string | null;
  internal_file_path: string | null;
  ai_generated_metadata: string | null;
  // Object-level summary fields
  summary: string | null;
  propositions_json: string | null;
  tags_json: string | null;
  summary_generated_at: string | null;
  // WOM support fields
  last_accessed_at: string | null;
  child_object_ids: string | null; // JSON array
  // Cognitive fields
  object_bio: string | null;
  object_relationships: string | null;
}

// Type for the metadata subset fetched by getSourceContentDetailsByIds
export interface SourceMetadata {
  id: string;
  title: string | null;
  sourceUri: string | null;
  objectType: string;
}

// Explicit mapping from JeffersObject keys (camelCase) to DB columns (snake_case)
const objectColumnMap: { [K in keyof Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt' | 'parsedAt' | 'summaryGeneratedAt' | 'lastAccessedAt'>]?: string } & { parsedAt?: string; summaryGeneratedAt?: string; lastAccessedAt?: string } = {
  objectType: 'object_type',
  sourceUri: 'source_uri',
  title: 'title',
  status: 'status',
  rawContentRef: 'raw_content_ref',
  parsedContentJson: 'parsed_content_json',
  cleanedText: 'cleaned_text',
  errorInfo: 'error_info',
  parsedAt: 'parsed_at',
  fileHash: 'file_hash',
  originalFileName: 'original_file_name',
  fileSizeBytes: 'file_size_bytes',
  fileMimeType: 'file_mime_type',
  internalFilePath: 'internal_file_path',
  aiGeneratedMetadata: 'ai_generated_metadata',
  summary: 'summary',
  propositionsJson: 'propositions_json',
  tagsJson: 'tags_json',
  summaryGeneratedAt: 'summary_generated_at',
  lastAccessedAt: 'last_accessed_at',
  childObjectIds: 'child_object_ids',
  objectBio: 'object_bio',
  objectRelationships: 'object_relationships',
};

// Helper to convert DB record (snake_case) to application object (camelCase)
function mapRecordToObject(record: ObjectRecord): JeffersObject {
  return {
    id: record.id,
    objectType: record.object_type as MediaType,
    sourceUri: record.source_uri,
    title: record.title,
    status: record.status as ObjectStatus,
    rawContentRef: record.raw_content_ref,
    parsedContentJson: record.parsed_content_json,
    cleanedText: record.cleaned_text,
    errorInfo: record.error_info,
    parsedAt: record.parsed_at || undefined,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    fileHash: record.file_hash,
    originalFileName: record.original_file_name,
    fileSizeBytes: record.file_size_bytes,
    fileMimeType: record.file_mime_type,
    internalFilePath: record.internal_file_path,
    aiGeneratedMetadata: record.ai_generated_metadata,
    summary: record.summary,
    propositionsJson: record.propositions_json,
    tagsJson: record.tags_json,
    summaryGeneratedAt: record.summary_generated_at || null,
    lastAccessedAt: record.last_accessed_at || undefined,
    childObjectIds: record.child_object_ids ? JSON.parse(record.child_object_ids) : undefined,
    // Return cognitive fields as-is (services will handle parsing/validation)
    objectBio: record.object_bio ?? undefined,
    objectRelationships: record.object_relationships ?? undefined,
  };
}

/**
 * Core CRUD operations for objects table
 * No validation, no defaults, just raw database operations
 */
export class ObjectModelCore extends BaseModel {
  protected readonly modelName = 'ObjectModelCore';

  /**
   * Creates a new object record in the database.
   * No validation or defaults - raw insert only.
   */
  async create(
    data: Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'> & { cleanedText?: string | null; }
  ): Promise<JeffersObject> {
    const newId = uuidv4();
    const nowISO = new Date().toISOString();
    const parsedAtISO = data.parsedAt; // Already ISO string

    const stmt = this.db.prepare(`
      INSERT INTO objects (
        id, object_type, source_uri, title, status,
        raw_content_ref, parsed_content_json, cleaned_text, error_info, parsed_at,
        file_hash, original_file_name, file_size_bytes, file_mime_type, internal_file_path, ai_generated_metadata,
        summary, propositions_json, tags_json, summary_generated_at,
        last_accessed_at, child_object_ids,
        object_bio, object_relationships,
        created_at, updated_at
      )
      VALUES (
        @id, @objectType, @sourceUri, @title, @status,
        @rawContentRef, @parsedContentJson, @cleanedText, @errorInfo, @parsedAt,
        @fileHash, @originalFileName, @fileSizeBytes, @fileMimeType, @internalFilePath, @aiGeneratedMetadata,
        @summary, @propositionsJson, @tagsJson, @summaryGeneratedAt,
        @lastAccessedAt, @childObjectIds,
        @objectBio, @objectRelationships,
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
        fileHash: data.fileHash ?? null,
        originalFileName: data.originalFileName ?? null,
        fileSizeBytes: data.fileSizeBytes ?? null,
        fileMimeType: data.fileMimeType ?? null,
        internalFilePath: data.internalFilePath ?? null,
        aiGeneratedMetadata: data.aiGeneratedMetadata ?? null,
        summary: data.summary ?? null,
        propositionsJson: data.propositionsJson ?? null,
        tagsJson: data.tagsJson ?? null,
        summaryGeneratedAt: data.summaryGeneratedAt ?? null,
        lastAccessedAt: data.lastAccessedAt ?? nowISO,
        childObjectIds: data.childObjectIds ? JSON.stringify(data.childObjectIds) : null,
        objectBio: data.objectBio ?? null,
        objectRelationships: data.objectRelationships ?? null,
        createdAt: nowISO,
        updatedAt: nowISO,
      });
      
      logger.debug(`[ObjectModelCore] Created object with ID: ${newId}`);
      const newRecord = await this.getById(newId);
      if (!newRecord) {
        throw new Error('Failed to retrieve newly created object');
      }
      return newRecord;
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && data.sourceUri) {
        logger.warn(`[ObjectModelCore] Duplicate source_uri: ${data.sourceUri}. Fetching existing.`);
        const existing = await this.getBySourceUri(data.sourceUri);
        if (existing) return existing;
        
        // If we reach here, constraint failed but object not found - re-throw original error
        logger.error(`[ObjectModelCore] Constraint violation but object not found for URI: ${data.sourceUri}`);
        throw error;
      }
      
      // For non-constraint errors, use BaseModel's generic handling
      this.handleDbError(error, `create object`);
    }
  }

  /**
   * Creates a new object record synchronously (for transactions)
   */
  createSync(
    data: Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'> & { cleanedText?: string | null; }
  ): JeffersObject {
    const newId = uuidv4();
    const nowISO = new Date().toISOString();
    const parsedAtISO = data.parsedAt; // Already ISO string

    const stmt = this.db.prepare(`
      INSERT INTO objects (
        id, object_type, source_uri, title, status,
        raw_content_ref, parsed_content_json, cleaned_text, error_info, parsed_at,
        file_hash, original_file_name, file_size_bytes, file_mime_type, internal_file_path, ai_generated_metadata,
        summary, propositions_json, tags_json, summary_generated_at,
        last_accessed_at, child_object_ids,
        object_bio, object_relationships,
        created_at, updated_at
      )
      VALUES (
        @id, @objectType, @sourceUri, @title, @status,
        @rawContentRef, @parsedContentJson, @cleanedText, @errorInfo, @parsedAt,
        @fileHash, @originalFileName, @fileSizeBytes, @fileMimeType, @internalFilePath, @aiGeneratedMetadata,
        @summary, @propositionsJson, @tagsJson, @summaryGeneratedAt,
        @lastAccessedAt, @childObjectIds,
        @objectBio, @objectRelationships,
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
        fileHash: data.fileHash ?? null,
        originalFileName: data.originalFileName ?? null,
        fileSizeBytes: data.fileSizeBytes ?? null,
        fileMimeType: data.fileMimeType ?? null,
        internalFilePath: data.internalFilePath ?? null,
        aiGeneratedMetadata: data.aiGeneratedMetadata ?? null,
        summary: data.summary ?? null,
        propositionsJson: data.propositionsJson ?? null,
        tagsJson: data.tagsJson ?? null,
        summaryGeneratedAt: data.summaryGeneratedAt ?? null,
        lastAccessedAt: data.lastAccessedAt ?? nowISO,
        childObjectIds: data.childObjectIds ? JSON.stringify(data.childObjectIds) : null,
        objectBio: data.objectBio ?? null,
        objectRelationships: data.objectRelationships ?? null,
        createdAt: nowISO,
        updatedAt: nowISO,
      });
      
      logger.debug(`[ObjectModelCore] Created object synchronously with ID: ${newId}`);

      // Re-fetch from DB to guarantee consistency with database state
      const selectStmt = this.db.prepare('SELECT * FROM objects WHERE id = ?');
      const record = selectStmt.get(newId) as ObjectRecord | undefined;
      if (!record) {
        throw new Error('Failed to retrieve newly created object');
      }
      return mapRecordToObject(record);
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && data.sourceUri) {
        throw new Error(`Object with source_uri '${data.sourceUri}' already exists`);
      }
      this.handleDbError(error, `create object synchronously`);
    }
  }

  /**
   * Updates specific fields of an object record
   */
  async update(id: string, updates: Partial<Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void> {
    const fieldsToSet: string[] = [];
    const params: Record<string, any> = { id };

    // Build SET clause using mapping
    for (const key in updates) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) {
        const typedKey = key as keyof typeof updates;

        // Skip immutable fields
        if (typedKey === 'sourceUri') {
          logger.debug(`[ObjectModelCore] Skipping update of immutable field: ${key}`);
          continue;
        }

        const dbColumn = objectColumnMap[typedKey];
        if (dbColumn) {
          fieldsToSet.push(`${dbColumn} = @${typedKey}`);
          // Handle conversions
          if (typedKey === 'parsedAt' || typedKey === 'summaryGeneratedAt' || typedKey === 'lastAccessedAt') {
            // Timestamps are already ISO strings
            const value = updates[typedKey];
            if (typeof value === 'object' && value !== null && 'toISOString' in value) {
              // It's a Date object
              params[typedKey] = (value as Date).toISOString();
            } else if (typeof value === 'string') {
              // Validate it's a valid ISO string by parsing and re-formatting
              params[typedKey] = new Date(value).toISOString();
            } else {
              params[typedKey] = value;
            }
          } else if (typedKey === 'childObjectIds') {
            params[typedKey] = updates.childObjectIds ? JSON.stringify(updates.childObjectIds) : null;
          } else {
            params[typedKey] = updates[typedKey];
          }
        } else {
          logger.warn(`[ObjectModelCore] Update called with unmapped property: ${key}`);
        }
      }
    }

    if (fieldsToSet.length === 0) {
      logger.warn(`[ObjectModelCore] Update called for object ${id} with no valid fields`);
      return;
    }

    const stmt = this.db.prepare(`
      UPDATE objects
      SET ${fieldsToSet.join(', ')}
      WHERE id = @id
    `);

    try {
      const info = stmt.run(params);
      if (info.changes > 0) {
        logger.debug(`[ObjectModelCore] Updated object ${id}`);
      } else {
        logger.warn(`[ObjectModelCore] No object found with ID ${id}`);
      }
    } catch (error) {
      this.handleDbError(error, `update object ${id}`);
    }
  }

  /**
   * Updates the status of an object
   */
  async updateStatus(id: string, status: ObjectStatus, parsedAt?: string, errorInfo?: string | null): Promise<void> {
    const fieldsToSet: string[] = ['status = @status'];
    const params: Record<string, any> = { id, status };

    if (parsedAt) {
      fieldsToSet.push('parsed_at = @parsedAt');
      params.parsedAt = parsedAt;
    }

    fieldsToSet.push('error_info = @errorInfo');
    params.errorInfo = status === 'error' ? (errorInfo ?? null) : null;

    const stmt = this.db.prepare(`
      UPDATE objects
      SET ${fieldsToSet.join(', ')}
      WHERE id = @id
    `);

    try {
      const info = stmt.run(params);
      if (info.changes > 0) {
        logger.debug(`[ObjectModelCore] Updated status for object ${id} to ${status}`);
      } else {
        logger.warn(`[ObjectModelCore] No object found with ID ${id}`);
      }
    } catch (error) {
      this.handleDbError(error, `update status for object ${id}`);
    }
  }

  /**
   * Retrieves a single object by its UUID
   */
  async getById(id: string): Promise<JeffersObject | null> {
    const stmt = this.db.prepare('SELECT * FROM objects WHERE id = ?');
    try {
      const record = stmt.get(id) as ObjectRecord | undefined;
      return record ? mapRecordToObject(record) : null;
    } catch (error) {
      this.handleDbError(error, `get object by ID ${id}`);
    }
  }

  /**
   * Retrieves a single object by its source URI
   */
  async getBySourceUri(uri: string): Promise<JeffersObject | null> {
    const stmt = this.db.prepare('SELECT * FROM objects WHERE source_uri = ?');
    try {
      const record = stmt.get(uri) as ObjectRecord | undefined;
      return record ? mapRecordToObject(record) : null;
    } catch (error) {
      this.handleDbError(error, `get object by source URI ${uri}`);
    }
  }

  /**
   * Finds objects matching a list of statuses
   */
  async findByStatus(statuses: ObjectStatus[]): Promise<JeffersObject[]> {
    if (!statuses || statuses.length === 0) {
      return [];
    }

    const placeholders = statuses.map(() => '?').join(', ');
    const stmt = this.db.prepare(`
      SELECT * FROM objects
      WHERE status IN (${placeholders})
      ORDER BY created_at ASC
    `);

    try {
      const rows = stmt.all(...statuses) as ObjectRecord[];
      logger.debug(`[ObjectModelCore] Found ${rows.length} objects with statuses: ${statuses.join(', ')}`);
      return rows.map(mapRecordToObject);
    } catch (error) {
      this.handleDbError(error, `find objects by status`);
    }
  }

  /**
   * Deletes an object by its ID
   */
  deleteById(id: string): void {
    const stmt = this.db.prepare('DELETE FROM objects WHERE id = ?');
    try {
      const info = stmt.run(id);
      if (info.changes > 0) {
        logger.debug(`[ObjectModelCore] Deleted object with ID: ${id}`);
      } else {
        logger.warn(`[ObjectModelCore] No object found with ID ${id}`);
      }
    } catch (error) {
      this.handleDbError(error, `delete object by ID ${id}`);
    }
  }

  /**
   * Deletes multiple objects by their IDs
   */
  deleteByIds(ids: string[]): void {
    if (ids.length === 0) return;

    const BATCH_SIZE = 500;
    let totalDeleted = 0;

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(', ');
      const stmt = this.db.prepare(`DELETE FROM objects WHERE id IN (${placeholders})`);

      try {
        const result = stmt.run(...batch);
        totalDeleted += result.changes;
        logger.debug(`[ObjectModelCore] Deleted ${result.changes} objects in batch`);
      } catch (error) {
        this.handleDbError(error, `delete objects by IDs`);
      }
    }

    logger.info(`[ObjectModelCore] Deleted ${totalDeleted} total objects`);
  }

  /**
   * Updates the last_accessed_at timestamp
   */
  updateLastAccessed(objectId: string): void {
    const stmt = this.db.prepare(`
      UPDATE objects
      SET last_accessed_at = ?
      WHERE id = ?
    `);

    try {
      const info = stmt.run(new Date().toISOString(), objectId);
      if (info.changes > 0) {
        logger.debug(`[ObjectModelCore] Updated last_accessed_at for object ${objectId}`);
      } else {
        logger.warn(`[ObjectModelCore] No object found with ID ${objectId}`);
      }
    } catch (error) {
      this.handleDbError(error, `update last_accessed_at for object ${objectId}`);
    }
  }

  /**
   * Gets the child object IDs for a composite object
   */
  getChildIds(objectId: string): string[] {
    const stmt = this.db.prepare('SELECT child_object_ids FROM objects WHERE id = ?');
    
    try {
      const record = stmt.get(objectId) as { child_object_ids: string | null } | undefined;
      if (!record || !record.child_object_ids) {
        return [];
      }
      return JSON.parse(record.child_object_ids);
    } catch (error) {
      this.handleDbError(error, `get child IDs for object ${objectId}`);
    }
  }

  /**
   * Updates the child object IDs for a composite object
   */
  updateChildIds(objectId: string, childIds: string[]): void {
    const stmt = this.db.prepare(`
      UPDATE objects
      SET child_object_ids = ?
      WHERE id = ?
    `);

    try {
      const childIdsJson = childIds.length > 0 ? JSON.stringify(childIds) : null;
      const info = stmt.run(childIdsJson, objectId);
      if (info.changes > 0) {
        logger.debug(`[ObjectModelCore] Updated child IDs for object ${objectId}`);
      } else {
        logger.warn(`[ObjectModelCore] No object found with ID ${objectId}`);
      }
    } catch (error) {
      this.handleDbError(error, `update child IDs for object ${objectId}`);
    }
  }

  /**
   * Additional query methods from original ObjectModel
   */
  async getProcessableObjects(limit: number): Promise<JeffersObject[]> {
    const targetStatus: ObjectStatus = 'parsed';
    const stmt = this.db.prepare(`
      SELECT * FROM objects
      WHERE status = ?
      ORDER BY created_at ASC
      LIMIT ?
    `);

    try {
      const records = stmt.all(targetStatus, limit) as ObjectRecord[];
      logger.debug(`[ObjectModelCore] Found ${records.length} processable objects`);
      return records.map(mapRecordToObject);
    } catch (error) {
      this.handleDbError(error, `get processable objects`);
    }
  }

  async countObjectsByStatus(status: ObjectStatus | ObjectStatus[]): Promise<number> {
    const statuses = Array.isArray(status) ? status : [status];
    if (statuses.length === 0) return 0;

    const placeholders = statuses.map(() => '?').join(', ');
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM objects
      WHERE status IN (${placeholders})
    `);

    try {
      const result = stmt.get(...statuses) as { count: number };
      logger.debug(`[ObjectModelCore] Counted ${result.count} objects with status(es)`);
      return result.count;
    } catch (error) {
      this.handleDbError(error, `count objects by status`);
    }
  }

  async findByFileHash(fileHash: string): Promise<JeffersObject | null> {
    const stmt = this.db.prepare('SELECT * FROM objects WHERE file_hash = ?');
    try {
      const record = stmt.get(fileHash) as ObjectRecord | undefined;
      return record ? mapRecordToObject(record) : null;
    } catch (error) {
      this.handleDbError(error, `find object by file hash`);
    }
  }

  async existsBySourceUri(sourceUri: string): Promise<boolean> {
    // Only check LOM layer to distinguish explicit bookmarks from WOM navigation history
    const stmt = this.db.prepare("SELECT 1 FROM objects WHERE source_uri = ? AND layer = 'LOM' LIMIT 1");
    try {
      const record = stmt.get(sourceUri);
      return record !== undefined;
    } catch (error) {
      this.handleDbError(error, `check existence by source URI`);
    }
  }

  async getSourceContentDetailsByIds(objectIds: string[]): Promise<Map<string, SourceMetadata>> {
    const resultsMap = new Map<string, SourceMetadata>();
    if (!objectIds || objectIds.length === 0) {
      return resultsMap;
    }

    const placeholders = objectIds.map(() => '?').join(', ');
    const query = `SELECT id, title, source_uri, object_type FROM objects WHERE id IN (${placeholders})`;

    try {
      const stmt = this.db.prepare(query);
      const rows = stmt.all(...objectIds) as { id: string; title: string | null; source_uri: string | null; object_type: string }[];

      rows.forEach(row => {
        resultsMap.set(row.id, {
          id: row.id,
          title: row.title,
          sourceUri: row.source_uri,
          objectType: row.object_type,
        });
      });

      return resultsMap;
    } catch (error) {
      this.handleDbError(error, `fetch details for object IDs`);
    }
  }

  // Convenience methods to match original API
  async findBySourceUri(sourceUri: string): Promise<JeffersObject | null> {
    return this.getBySourceUri(sourceUri);
  }

  async createOrUpdate(
    data: Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<JeffersObject> {
    if (data.sourceUri) {
      const existing = await this.findBySourceUri(data.sourceUri);
      if (existing) {
        const updatePayload: Partial<JeffersObject> = {
          ...data,
          lastAccessedAt: new Date().toISOString(),
        };
        await this.update(existing.id, updatePayload);
        return (await this.getById(existing.id))!;
      }
    }
    return this.create(data);
  }
}