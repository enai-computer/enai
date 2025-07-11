import { BaseModel } from './BaseModel';
import { logger } from '../utils/logger';

/**
 * Handles junction table operations for notebook-object associations
 * Pure database operations, no business logic
 */
export class ObjectAssociationModel extends BaseModel {
  protected readonly modelName = 'ObjectAssociationModel';

  /**
   * Adds an object to a notebook via the junction table
   * @param objectId - The UUID of the object
   * @param notebookId - The UUID of the notebook
   * @returns void
   */
  async addToNotebook(objectId: string, notebookId: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO notebook_objects (notebook_id, object_id)
      VALUES (?, ?)
    `);
    
    try {
      stmt.run(notebookId, objectId);
      logger.debug(`[ObjectAssociationModel] Added object ${objectId} to notebook ${notebookId}`);
    } catch (error) {
      this.handleDbError(error, `add object ${objectId} to notebook ${notebookId}`);
    }
  }

  /**
   * Removes an object from a notebook via the junction table
   * @param objectId - The UUID of the object
   * @param notebookId - The UUID of the notebook
   * @returns void
   */
  async removeFromNotebook(objectId: string, notebookId: string): Promise<void> {
    const stmt = this.db.prepare(`
      DELETE FROM notebook_objects 
      WHERE notebook_id = ? AND object_id = ?
    `);
    
    try {
      const info = stmt.run(notebookId, objectId);
      if (info.changes > 0) {
        logger.debug(`[ObjectAssociationModel] Removed object ${objectId} from notebook ${notebookId}`);
      } else {
        logger.warn(`[ObjectAssociationModel] No association found between object ${objectId} and notebook ${notebookId}`);
      }
    } catch (error) {
      this.handleDbError(error, `remove object ${objectId} from notebook ${notebookId}`);
    }
  }

  /**
   * Gets all notebook IDs that an object belongs to
   * @param objectId - The UUID of the object
   * @returns Array of notebook IDs
   */
  getNotebookIdsForObject(objectId: string): string[] {
    const stmt = this.db.prepare(`
      SELECT notebook_id 
      FROM notebook_objects 
      WHERE object_id = ?
      ORDER BY added_at DESC
    `);
    
    try {
      const rows = stmt.all(objectId) as { notebook_id: string }[];
      return rows.map(row => row.notebook_id);
    } catch (error) {
      this.handleDbError(error, `get notebook IDs for object ${objectId}`);
    }
  }

  /**
   * Gets all object IDs in a notebook
   * @param notebookId - The UUID of the notebook
   * @returns Array of object IDs
   */
  getObjectIdsForNotebook(notebookId: string): string[] {
    const stmt = this.db.prepare(`
      SELECT object_id 
      FROM notebook_objects 
      WHERE notebook_id = ?
      ORDER BY added_at DESC
    `);
    
    try {
      const rows = stmt.all(notebookId) as { object_id: string }[];
      return rows.map(row => row.object_id);
    } catch (error) {
      this.handleDbError(error, `get object IDs for notebook ${notebookId}`);
    }
  }

  /**
   * Checks if an object is associated with a notebook
   * @param objectId - The UUID of the object
   * @param notebookId - The UUID of the notebook
   * @returns true if association exists
   */
  hasAssociation(objectId: string, notebookId: string): boolean {
    const stmt = this.db.prepare(`
      SELECT 1 FROM notebook_objects 
      WHERE notebook_id = ? AND object_id = ?
      LIMIT 1
    `);
    
    try {
      const result = stmt.get(notebookId, objectId);
      return result !== undefined;
    } catch (error) {
      this.handleDbError(error, `check association between object ${objectId} and notebook ${notebookId}`);
    }
  }

  /**
   * Gets the timestamp when an object was added to a notebook
   * @param objectId - The UUID of the object
   * @param notebookId - The UUID of the notebook
   * @returns Date when added, or null if no association
   */
  getAddedAt(objectId: string, notebookId: string): Date | null {
    const stmt = this.db.prepare(`
      SELECT added_at 
      FROM notebook_objects 
      WHERE notebook_id = ? AND object_id = ?
    `);
    
    try {
      const result = stmt.get(notebookId, objectId) as { added_at: string } | undefined;
      return result ? new Date(result.added_at) : null;
    } catch (error) {
      this.handleDbError(error, `get added_at for object ${objectId} in notebook ${notebookId}`);
    }
  }

  /**
   * Removes all associations for an object (used when deleting an object)
   * @param objectId - The UUID of the object
   * @returns Number of associations removed
   */
  removeAllAssociationsForObject(objectId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM notebook_objects 
      WHERE object_id = ?
    `);
    
    try {
      const info = stmt.run(objectId);
      if (info.changes > 0) {
        logger.debug(`[ObjectAssociationModel] Removed ${info.changes} associations for object ${objectId}`);
      }
      return info.changes;
    } catch (error) {
      this.handleDbError(error, `remove all associations for object ${objectId}`);
    }
  }

  /**
   * Removes all associations for a notebook (used when deleting a notebook)
   * @param notebookId - The UUID of the notebook
   * @returns Number of associations removed
   */
  removeAllAssociationsForNotebook(notebookId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM notebook_objects 
      WHERE notebook_id = ?
    `);
    
    try {
      const info = stmt.run(notebookId);
      if (info.changes > 0) {
        logger.debug(`[ObjectAssociationModel] Removed ${info.changes} associations for notebook ${notebookId}`);
      }
      return info.changes;
    } catch (error) {
      this.handleDbError(error, `remove all associations for notebook ${notebookId}`);
    }
  }
}