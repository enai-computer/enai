import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import { logger } from '../utils/logger';
import { Note, NoteType, NoteMetadata } from '../shared/types';
import Database from 'better-sqlite3';

// Define the structure returned by the database (snake_case)
interface NoteRecord {
  id: string;
  notebook_id: string;
  content: string;
  type: string;
  metadata: string | null;
  position: number;
  created_at: number;
  updated_at: number;
}

// Helper to convert DB record (snake_case) to application object (camelCase)
function mapRecordToNote(record: NoteRecord): Note {
  return {
    id: record.id,
    notebookId: record.notebook_id,
    content: record.content,
    type: record.type as NoteType,
    metadata: record.metadata ? JSON.parse(record.metadata) : null,
    position: record.position,
    createdAt: new Date(record.created_at),
    updatedAt: new Date(record.updated_at),
  };
}

export class NoteModel {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDb();
  }

  /**
   * Creates a new note in the database.
   */
  create(params: {
    notebookId: string;
    content: string;
    type?: NoteType;
    metadata?: NoteMetadata | null;
    position?: number;
  }): Note {
    const id = uuidv4();
    const now = Date.now();
    
    // If position is not provided, get the next position
    let position = params.position;
    if (position === undefined) {
      position = this.getNextPosition(params.notebookId);
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO notes (id, notebook_id, content, type, metadata, position, created_at, updated_at)
      VALUES ($id, $notebookId, $content, $type, $metadata, $position, $createdAt, $updatedAt)
    `);

    try {
      stmt.run({
        id,
        notebookId: params.notebookId,
        content: params.content,
        type: params.type || 'text',
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        position,
        createdAt: now,
        updatedAt: now,
      });

      logger.info("[NoteModel] Created note", { id, notebookId: params.notebookId });
      
      // Return the created note
      const created = this.getById(id);
      if (!created) {
        throw new Error('Failed to retrieve created note');
      }
      return created;
    } catch (error) {
      logger.error("[NoteModel] Error creating note:", error);
      throw error;
    }
  }

  /**
   * Gets a note by ID.
   */
  getById(id: string): Note | null {
    const stmt = this.db.prepare('SELECT * FROM notes WHERE id = ?');
    const record = stmt.get(id) as NoteRecord | undefined;
    
    if (!record) {
      return null;
    }
    
    return mapRecordToNote(record);
  }

  /**
   * Gets all notes for a notebook, ordered by position.
   */
  getByNotebookId(notebookId: string): Note[] {
    const stmt = this.db.prepare(`
      SELECT * FROM notes 
      WHERE notebook_id = ? 
      ORDER BY position ASC, created_at ASC
    `);
    
    const records = stmt.all(notebookId) as NoteRecord[];
    return records.map(mapRecordToNote);
  }

  /**
   * Updates a note's content.
   */
  update(id: string, params: { content: string }): Note | null {
    const now = Date.now();
    
    const stmt = this.db.prepare(`
      UPDATE notes 
      SET content = $content, updated_at = $updatedAt
      WHERE id = $id
    `);

    try {
      const result = stmt.run({
        id,
        content: params.content,
        updatedAt: now,
      });

      if (result.changes === 0) {
        logger.warn("[NoteModel] No note found to update", { id });
        return null;
      }

      logger.info("[NoteModel] Updated note", { id });
      return this.getById(id);
    } catch (error) {
      logger.error("[NoteModel] Error updating note:", error);
      throw error;
    }
  }

  /**
   * Deletes a note by ID.
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM notes WHERE id = ?');
    
    try {
      const result = stmt.run(id);
      const deleted = result.changes > 0;
      
      if (deleted) {
        logger.info("[NoteModel] Deleted note", { id });
      } else {
        logger.warn("[NoteModel] No note found to delete", { id });
      }
      
      return deleted;
    } catch (error) {
      logger.error("[NoteModel] Error deleting note:", error);
      throw error;
    }
  }

  /**
   * Updates positions for multiple notes in a notebook.
   * Used for reordering.
   */
  updatePositions(notebookId: string, notePositions: { id: string; position: number }[]): void {
    const updateStmt = this.db.prepare(`
      UPDATE notes 
      SET position = $position, updated_at = $updatedAt
      WHERE id = $id AND notebook_id = $notebookId
    `);

    const now = Date.now();

    const transaction = this.db.transaction(() => {
      for (const { id, position } of notePositions) {
        updateStmt.run({
          id,
          position,
          notebookId,
          updatedAt: now,
        });
      }
    });

    try {
      transaction();
      logger.info("[NoteModel] Updated note positions", { notebookId, count: notePositions.length });
    } catch (error) {
      logger.error("[NoteModel] Error updating note positions:", error);
      throw error;
    }
  }

  /**
   * Gets the next available position for a note in a notebook.
   */
  private getNextPosition(notebookId: string): number {
    const stmt = this.db.prepare(`
      SELECT MAX(position) as maxPosition 
      FROM notes 
      WHERE notebook_id = ?
    `);
    
    const result = stmt.get(notebookId) as { maxPosition: number | null };
    return (result.maxPosition ?? -1) + 1;
  }
}