import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { BaseService } from './base/BaseService';
import { NotebookModel } from '../models/NotebookModel';
import { ObjectModelCore } from '../models/ObjectModelCore';
import { ObjectCognitiveModel } from '../models/ObjectCognitiveModel';
import { ObjectAssociationModel } from '../models/ObjectAssociationModel';
import { ChunkModel } from '../models/ChunkModel';
import { ChatModel } from '../models/ChatModel';
import { ActivityLogService } from './ActivityLogService';
import { ActivityLogModel } from '../models/ActivityLogModel';
import { NotebookRecord, ObjectChunk, JeffersObject, IChatSession, ObjectStatus, RecentNotebook } from '../shared/types';

interface NotebookServiceDeps {
  db: Database.Database;
  notebookModel: NotebookModel;
  objectModelCore: ObjectModelCore;
  objectCognitive: ObjectCognitiveModel;
  objectAssociation: ObjectAssociationModel;
  chunkModel: ChunkModel;
  chatModel: ChatModel;
  activityLogService: ActivityLogService;
  activityLogModel: ActivityLogModel;
}

export class NotebookService extends BaseService<NotebookServiceDeps> {
  private objectCognitive: ObjectCognitiveModel;
  private objectAssociation: ObjectAssociationModel;

  constructor(deps: NotebookServiceDeps) {
    super('NotebookService', deps);
    this.objectCognitive = deps.objectCognitive;
    this.objectAssociation = deps.objectAssociation;
  }

  async initialize(): Promise<void> {
    this.logger.info('NotebookService initialized');
  }

  async cleanup(): Promise<void> {
    this.logger.info('NotebookService cleanup complete (no resources to clean)');
  }

  private getNotebookObjectSourceUri(notebookId: string): string {
    return `jeffers://notebook/${notebookId}`;
  }

  /**
   * Creates a new notebook and its corresponding JeffersObject within a transaction.
   * @param title The title of the notebook.
   * @param description Optional description for the notebook.
   * @returns The created NotebookRecord.
   * @throws Error if underlying model operations fail or transaction cannot be completed.
   */
  async createNotebook(title: string, description?: string | null): Promise<NotebookRecord> {
    return this.execute('createNotebook', async () => {
      const notebookId = uuidv4();
      this.logDebug(`Attempting to create notebook (transactionally) with title: "${title}", generated ID: ${notebookId}`);
      
      let notebookRecord: NotebookRecord;

      // NOTE: Due to the async signatures on model methods (even though they're sync internally),
      // we cannot use BaseService.transaction() here. This is a known limitation.
      // TODO: Consider creating sync versions of model methods for use in transactions.
      try {
        this.deps.db.exec('BEGIN');
        const sourceUri = this.getNotebookObjectSourceUri(notebookId);
        const cleanedText = title + (description ? `\n${description}` : '');
        
        const notebookJeffersObjectData: Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'> = {
          objectType: 'notebook',
          sourceUri: sourceUri,
          title: title,
          status: 'parsed' as ObjectStatus,
          cleanedText: cleanedText,
          rawContentRef: null,
          parsedContentJson: null,
          parsedAt: new Date(),
        };

        const jeffersObject = await this.deps.objectModelCore.create(notebookJeffersObjectData);
        this.logInfo(`[TX] Corresponding JeffersObject created with ID: ${jeffersObject.id} for potential notebook ID: ${notebookId}`);

        notebookRecord = await this.deps.notebookModel.create(notebookId, title, jeffersObject.id, description);
        this.logInfo(`[TX] NotebookRecord created with ID: ${notebookId} and linked ObjectId: ${jeffersObject.id}`);
        
        this.deps.db.exec('COMMIT');
        
        // Log the activity after transaction completes
        try {
          await this.deps.activityLogService.logActivity({
            activityType: 'notebook_created',
            details: {
              notebookId: notebookRecord.id,
              title: notebookRecord.title,
              description: notebookRecord.description,
              objectId: jeffersObject.id
            }
          });
        } catch (logError) {
          this.logError('Failed to log notebook creation activity:', logError);
        }
        
        return notebookRecord;
      } catch (error) {
        this.deps.db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  /**
   * Retrieves a notebook by its ID.
   * @param id The ID of the notebook.
   * @returns The NotebookRecord or null if not found.
   */
  async getNotebookById(id: string): Promise<NotebookRecord | null> {
    return this.execute('getNotebookById', async () => {
      this.logger.debug(`Getting notebook by ID: ${id}`);
      const notebook = await this.deps.notebookModel.getById(id);
      
      // Log notebook visit if found
      if (notebook) {
        try {
          await this.deps.activityLogService.logNotebookVisit(notebook.id, notebook.title);
        } catch (logError) {
          this.logger.error('Failed to log notebook visit activity:', logError);
        }
      }
      
      return notebook;
    });
  }

  /**
   * Retrieves all notebooks (including NotebookCovers).
   * @returns An array of NotebookRecord.
   */
  async getAllNotebooks(): Promise<NotebookRecord[]> {
    return this.execute('getAllNotebooks', async () => {
      this.logger.debug('Getting all notebooks');
      return this.deps.notebookModel.getAll();
    });
  }

  /**
   * Retrieves all regular notebooks (excludes NotebookCovers and daily notebooks).
   * @returns An array of NotebookRecord.
   */
  async getAllRegularNotebooks(): Promise<NotebookRecord[]> {
    return this.execute('getAllRegularNotebooks', async () => {
      this.logger.debug('Getting all regular notebooks');
      const notebooks = await this.deps.notebookModel.getAllRegularNotebooks();
      
      // Filter out daily notebooks by checking their tags
      const regularNotebooks: NotebookRecord[] = [];
      for (const notebook of notebooks) {
        if (!notebook.objectId) {
          regularNotebooks.push(notebook); // Keep notebooks without objects
          continue;
        }
        
        const object = await this.deps.objectModelCore.getById(notebook.objectId);
        const tags = object?.tagsJson ? JSON.parse(object.tagsJson) : [];
        if (!tags.includes('dailynotebook')) {
          regularNotebooks.push(notebook);
        }
      }
      
      this.logger.debug(`Filtered out ${notebooks.length - regularNotebooks.length} daily notebooks`);
      return regularNotebooks;
    });
  }

  /**
   * Gets the NotebookCover for a specific user, creating it if it doesn't exist.
   * @param userId The user ID (defaults to 'default_user').
   * @returns The NotebookCover record.
   */
  async getNotebookCover(userId: string = 'default_user'): Promise<NotebookRecord> {
    return this.execute('getNotebookCover', async () => {
      this.logger.debug(`Getting NotebookCover for user: ${userId}`);
      return this.deps.notebookModel.ensureNotebookCover(userId);
    });
  }

  /**
   * Updates a notebook and its corresponding JeffersObject within a transaction.
   * @param id The ID of the notebook to update.
   * @param data An object containing fields to update (title, description).
   * @returns The updated NotebookRecord or null if not found and no update occurred.
   * @throws Error if underlying model operations fail or transaction cannot be completed.
   */
  async updateNotebook(id: string, data: Partial<{ title: string, description: string | null }>): Promise<NotebookRecord | null> {
    return this.execute('updateNotebook', async () => {
      this.logDebug(`Attempting to update notebook (transactionally) ID: ${id}`);
      
      let updatedNotebookRecord: NotebookRecord | null = null;

      // NOTE: Manual transaction management due to async model methods
      try {
        this.deps.db.exec('BEGIN');
        updatedNotebookRecord = await this.deps.notebookModel.update(id, data);

        if (updatedNotebookRecord) {
          this.logInfo(`[TX] NotebookRecord ${id} updated.`);
          if (data.title !== undefined || data.description !== undefined) {
            const sourceUri = this.getNotebookObjectSourceUri(id);
            const jeffersObject = await this.deps.objectModelCore.getBySourceUri(sourceUri);

            if (jeffersObject) {
              const newCleanedText = updatedNotebookRecord.title + (updatedNotebookRecord.description ? `\n${updatedNotebookRecord.description}` : '');
              const objectUpdates: Partial<Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'>> = {
                title: updatedNotebookRecord.title,
                cleanedText: newCleanedText,
              };
              await this.deps.objectModelCore.update(jeffersObject.id, objectUpdates);
              this.logInfo(`[TX] Corresponding JeffersObject ${jeffersObject.id} updated for notebook ID: ${id}`);
            } else {
              this.logWarn(`[TX] JeffersObject not found for notebook ID: ${id} (sourceUri: ${sourceUri}) during update. It may need to be created or was deleted. Update to JeffersObject skipped.`);
            }
          }
        } else {
          this.logWarn(`[TX] Notebook ID: ${id} not found for update or no changes made in NotebookModel.`);
        }
        
        this.deps.db.exec('COMMIT');
        return updatedNotebookRecord;
      } catch (error) {
        this.deps.db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  /**
   * Deletes a notebook and its corresponding JeffersObject within a transaction.
   * Associated chat sessions are deleted by DB cascade.
   * Associated chunks have their notebook_id set to NULL by DB constraint.
   * @param id The ID of the notebook to delete.
   * @returns True if notebook record deletion was successful, false otherwise.
   * @throws Error if transaction fails or a critical error occurs.
   */
  async deleteNotebook(id: string): Promise<boolean> {
    return this.execute('deleteNotebook', async () => {
      this.logWarn(`Attempting to delete notebook ID: ${id}.`);

      // Check for existence BEFORE starting any transaction or other operations.
      const notebookRecordExistedInitially = await this.deps.notebookModel.getById(id);
      if (!notebookRecordExistedInitially) {
        this.logWarn(`NotebookRecord for ID: ${id} not found. Nothing to delete. Returning false.`);
        return false; // Notebook wasn't there to begin with. No transaction needed.
      }

      // If we proceed, the notebook record exists.
      this.logInfo(`Notebook ID: ${id} exists. Proceeding with transactional deletion of it and its corresponding JeffersObject.`);
      
      // NOTE: Manual transaction management due to async model methods
      try {
        this.deps.db.exec('BEGIN');
        
        const sourceUri = this.getNotebookObjectSourceUri(id);
        const jeffersObject = await this.deps.objectModelCore.getBySourceUri(sourceUri);
        
        if (jeffersObject) {
          this.deps.objectModelCore.deleteById(jeffersObject.id);
          this.logInfo(`[TX] Corresponding JeffersObject ${jeffersObject.id} deleted for notebook ID: ${id}.`);
        } else {
          // This case should ideally not be hit if notebookRecordExistedInitially is true, 
          // as a notebook record should have a corresponding JeffersObject by design from createNotebook.
          // However, if it does happen (e.g., data inconsistency), we log it but proceed to delete the notebook record.
          this.logWarn(`[TX] JeffersObject not found for sourceUri ${sourceUri} during deletion of existing notebook ID: ${id}. This is unexpected.`);
        }

        // Attempt to delete the notebook record, which we know existed.
        const deletedSuccessfully = await this.deps.notebookModel.delete(id);
        if (deletedSuccessfully) {
          this.logInfo(`[TX] NotebookRecord deleted successfully: ${id}.`);
        } else {
          // This means notebookRecordExistedInitially was true, but notebookModel.delete(id) still returned false.
          // This indicates a failure to delete an existing, known record.
          this.logError(`[TX] NotebookRecord for ID: ${id} existed but its deletion failed in NotebookModel. This will trigger a rollback.`);
          throw new Error(`NotebookModel.delete() failed for existing ID ${id}.`);
        }
        
        this.deps.db.exec('COMMIT');
        return deletedSuccessfully;
      } catch (error) {
        this.deps.db.exec('ROLLBACK');
        throw error;
      }
    });
  }
  
  /**
   * Creates a new chat session within a specified notebook.
   * @param notebookId The ID of the notebook.
   * @param chatTitle Optional title for the chat session.
   * @returns The created IChatSession.
   * @throws Error if the notebook is not found or chat session creation fails.
   */
  async createChatInNotebook(notebookId: string, chatTitle?: string | null): Promise<IChatSession> {
    return this.execute('createChatInNotebook', async () => {
      this.logger.debug(`Creating chat in notebook ID: ${notebookId}, title: "${chatTitle || 'Untitled'}"`);
      const notebook = await this.deps.notebookModel.getById(notebookId);
      if (!notebook) {
        this.logger.error(`Notebook not found with ID: ${notebookId} when trying to create chat session.`);
        throw new Error(`Notebook not found with ID: ${notebookId}`);
      }
      return this.deps.chatModel.createSession(notebookId, undefined, chatTitle);
    });
  }

  /**
   * Lists all chat sessions for a specific notebook.
   * @param notebookId The ID of the notebook.
   * @returns An array of IChatSession.
   * @throws Error if the notebook is not found.
   */
  async listChatsForNotebook(notebookId: string): Promise<IChatSession[]> {
    return this.execute('listChatsForNotebook', async () => {
      this.logger.debug(`Listing chats for notebook ID: ${notebookId}`);
      const notebook = await this.deps.notebookModel.getById(notebookId);
      if (!notebook) {
        this.logger.error(`Notebook not found with ID: ${notebookId} when trying to list chat sessions.`);
        throw new Error(`Notebook not found with ID: ${notebookId}`);
      }
      return this.deps.chatModel.listSessionsForNotebook(notebookId);
    });
  }

  /**
   * Transfers a chat session to a different notebook.
   * @param sessionId The ID of the chat session to transfer.
   * @param newNotebookId The ID of the target notebook.
   * @returns True if the transfer was successful, false otherwise.
   * @throws Error if the session or target notebook is not found.
   */
  async transferChatToNotebook(sessionId: string, newNotebookId: string): Promise<boolean> {
    return this.execute('transferChatToNotebook', async () => {
      this.logger.debug(`Transferring chat session ID: ${sessionId} to notebook ID: ${newNotebookId}`);
      
      const session = await this.deps.chatModel.getSessionById(sessionId);
      if (!session) {
        this.logger.error(`Chat session not found with ID: ${sessionId} for transfer.`);
        throw new Error(`Chat session not found with ID: ${sessionId}`);
      }

      const newNotebook = await this.deps.notebookModel.getById(newNotebookId);
      if (!newNotebook) {
        this.logger.error(`Target notebook not found with ID: ${newNotebookId} for chat transfer.`);
        throw new Error(`Target notebook not found with ID: ${newNotebookId}`);
      }

      if (session.notebookId === newNotebookId) {
        this.logger.info(`Chat session ${sessionId} is already in notebook ${newNotebookId}. No transfer needed.`);
        return true;
      }

      return this.deps.chatModel.updateChatNotebook(sessionId, newNotebookId);
    });
  }

  /**
   * Assigns a chunk to a notebook or removes its assignment.
   * @param chunkId The ID of the chunk.
   * @param notebookId The ID of the notebook to assign to, or null to remove assignment.
   * @returns True if the assignment was successful, false otherwise.
   */
  async assignChunkToNotebook(chunkId: number, notebookId: string | null): Promise<boolean> {
    return this.execute('assignChunkToNotebook', async () => {
      this.logger.debug(`Assigning chunk ID ${chunkId} to notebook ID ${notebookId}`);
      if (notebookId) {
        const notebook = await this.deps.notebookModel.getById(notebookId);
        if (!notebook) {
          this.logger.error(`Target notebook ${notebookId} not found for assigning chunk ${chunkId}.`);
          throw new Error(`Target notebook not found with ID: ${notebookId}`);
        }
      }
      
      const success = await this.deps.chunkModel.assignToNotebook(chunkId, notebookId);
      if (success) {
        this.logger.info(`Chunk ${chunkId} assignment to notebook ${notebookId} updated in SQL.`);
      } else {
        this.logger.warn(`Failed to assign chunk ${chunkId} to notebook ${notebookId} in SQL.`);
      }
      return success;
    });
  }

  /**
   * Retrieves all chunks associated with a specific notebook ID.
   * @param notebookId The ID of the notebook.
   * @returns An array of ObjectChunk.
   */
  async getChunksForNotebook(notebookId: string): Promise<ObjectChunk[]> {
    return this.execute('getChunksForNotebook', async () => {
      this.logger.debug(`Getting chunks for notebook ID: ${notebookId}`);
      const notebook = await this.deps.notebookModel.getById(notebookId);
      if (!notebook) {
        this.logger.error(`Notebook ${notebookId} not found when getting chunks.`);
        throw new Error(`Notebook not found with ID: ${notebookId}`);
      }
      return this.deps.chunkModel.listByNotebookId(notebookId);
    });
  }

  /**
   * Retrieves the most recently viewed notebooks based on activity logs.
   * @param limit The maximum number of notebooks to return (default: 12).
   * @returns An array of NotebookRecord ordered by most recent access.
   */
  async getRecentlyViewed(limit: number = 12): Promise<RecentNotebook[]> {
    return this.execute('getRecentlyViewed', async () => {
      this.logger.debug(`Getting recently viewed notebooks, limit: ${limit}`);
      
      // Note: Recently opened notebooks may have up to 5 second delay due to activity batching
      
      // Query the activity logs for notebook_visit events
      const stmt = this.deps.db.prepare(`
        SELECT DISTINCT json_extract(details_json, '$.notebookId') as notebook_id,
               MAX(timestamp) as last_accessed
        FROM user_activities
        WHERE activity_type = 'notebook_visit'
          AND json_extract(details_json, '$.notebookId') IS NOT NULL
          AND json_extract(details_json, '$.notebookId') NOT LIKE 'cover-%'
        GROUP BY json_extract(details_json, '$.notebookId')
        ORDER BY last_accessed DESC
        LIMIT ?
      `);
      
      const recentNotebookLogs = stmt.all(limit) as Array<{ notebook_id: string; last_accessed: number }>;
      
      if (recentNotebookLogs.length === 0) {
        this.logger.debug('No recently viewed notebooks found');
        return [];
      }
      
      // Extract just the IDs
      const notebookIds = recentNotebookLogs.map(row => row.notebook_id);
      
      // Fetch full notebook details using getByIds
      const notebooks = await this.deps.notebookModel.getByIds(notebookIds);
      
      // Create a map for quick lookup
      const notebookMap = new Map(notebooks.map(n => [n.id, n]));
      
      // Return notebooks in the same order as the activity log query,
      // and append the last_accessed timestamp.
      const orderedNotebooks: RecentNotebook[] = [];
      for (const { notebook_id, last_accessed } of recentNotebookLogs) {
        const notebook = notebookMap.get(notebook_id);
        if (notebook) {
          orderedNotebooks.push({
            ...notebook,
            lastAccessed: last_accessed
          });
        }
      }
      
      this.logger.info(`Found ${orderedNotebooks.length} recently viewed notebooks`);
      return orderedNotebooks;
    });
  }

  /**
   * Formats a date into the daily notebook title format: "Month D"
   */
  private formatDailyNotebookTitle(date: Date): string {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                    'July', 'August', 'September', 'October', 'November', 'December'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    return `${month} ${day}`;
  }

  /**
   * Gets a daily notebook for the specified date if it exists
   */
  async getDailyNotebook(date: Date): Promise<NotebookRecord | null> {
    return this.execute('getDailyNotebook', async () => {
      const title = this.formatDailyNotebookTitle(date);
      this.logger.debug(`Looking for daily notebook with title: ${title}`);
      
      // Get all notebooks and filter by title and tag
      const notebooks = await this.deps.notebookModel.getAll();
      
      for (const notebook of notebooks) {
        if (notebook.title === title && notebook.objectId) {
          const object = await this.deps.objectModelCore.getById(notebook.objectId);
          const tags = object?.tagsJson ? JSON.parse(object.tagsJson) : [];
          if (tags.includes('dailynotebook')) {
            this.logger.info(`Found daily notebook for ${title}`);
            return notebook;
          }
        }
      }
      
      this.logger.debug(`No daily notebook found for ${title}`);
      return null;
    });
  }


  /**
   * Assigns an object to a notebook with cognitive relationship management.
   * Creates junction table entry, adds relationship with computed affinity,
   * and logs a biography event.
   */
  async assignObjectToNotebook(objectId: string, notebookId: string, affinity?: number): Promise<void> {
    return this.execute('assignObjectToNotebook', async () => {
      // Verify both object and notebook exist
      const object = await this.deps.objectModelCore.getById(objectId);
      if (!object) {
        throw new Error(`Object ${objectId} not found`);
      }
      
      const notebook = await this.deps.notebookModel.getById(notebookId);
      if (!notebook) {
        throw new Error(`Notebook ${notebookId} not found`);
      }
      
      // Add to junction table
      await this.objectAssociation.addToNotebook(objectId, notebookId);
      
      // Compute affinity if not provided (stub for now - will be enhanced in Phase 4)
      const computedAffinity = affinity ?? 0.5;
      
      // Create and add the relationship
      const relationship = this.objectCognitive.createNotebookRelationship(notebookId, computedAffinity);
      const updatedRelationships = await this.objectCognitive.addRelationship(objectId, relationship);
      
      // Update the object with new relationships
      await this.deps.objectModelCore.update(objectId, { objectRelationships: updatedRelationships });
      
      // Create a biography event
      const event = this.objectCognitive.createNotebookEvent(notebookId, 'added');
      const updatedBio = await this.objectCognitive.addBiographyEvent(objectId, event);
      
      // Update the object with new biography
      await this.deps.objectModelCore.update(objectId, { objectBio: updatedBio });
      
      // Log the activity
      await this.deps.activityLogService.logActivity({
        activityType: 'obj_assigned_to_nb',
        details: {
          objectId,
          notebookId,
          affinity: computedAffinity
        }
      });
      
      this.logger.info(`Object ${objectId} assigned to notebook ${notebookId} with affinity ${computedAffinity}`);
    });
  }

  /**
   * Removes an object from a notebook with cognitive cleanup.
   */
  async removeObjectFromNotebook(objectId: string, notebookId: string): Promise<void> {
    return this.execute('removeObjectFromNotebook', async () => {
      // Remove from junction table
      await this.objectAssociation.removeFromNotebook(objectId, notebookId);
      
      // Remove the relationship
      const updatedRelationships = await this.objectCognitive.removeRelationship(objectId, notebookId);
      await this.deps.objectModelCore.update(objectId, { objectRelationships: updatedRelationships });
      
      // Add a removal event to biography
      const event = this.objectCognitive.createNotebookEvent(notebookId, 'removed');
      const updatedBio = await this.objectCognitive.addBiographyEvent(objectId, event);
      await this.deps.objectModelCore.update(objectId, { objectBio: updatedBio });
      
      this.logger.info(`Object ${objectId} removed from notebook ${notebookId}`);
    });
  }

  /**
   * Copies window layout from one notebook to another, mapping chat session IDs
   * and generating new window IDs to avoid conflicts.
   */
  private async copyWindowLayout(
    sourceNotebookId: string,
    targetNotebookId: string,
    sessionIdMap: Map<string, string>
  ): Promise<void> {
    const userDataPath = app.getPath('userData');
    const layoutsDir = path.join(userDataPath, 'notebook_layouts');
    const sourceLayoutPath = path.join(layoutsDir, `notebook-layout-${sourceNotebookId}.json`);
    const targetLayoutPath = path.join(layoutsDir, `notebook-layout-${targetNotebookId}.json`);
    
    // Check if source layout exists
    if (!(await fs.pathExists(sourceLayoutPath))) {
      this.logger.info(`No window layout found for source notebook ${sourceNotebookId}`);
      return;
    }
    
    // Read source layout
    const sourceLayout = await fs.readJson(sourceLayoutPath);
    
    // Transform the layout
    const transformedLayout = this.transformWindowLayout(sourceLayout, sessionIdMap);
    
    // Ensure layouts directory exists
    await fs.ensureDir(layoutsDir);
    
    // Write transformed layout
    await fs.writeJson(targetLayoutPath, transformedLayout, { spaces: 2 });
    
    this.logger.info(`Window layout copied from ${sourceNotebookId} to ${targetNotebookId}`);
  }
  
  /**
   * Transforms a window layout by generating new window IDs and mapping chat session IDs.
   */
  private transformWindowLayout(
    sourceLayout: any,
    sessionIdMap: Map<string, string>
  ): any {
    // Deep clone the layout
    const layout = JSON.parse(JSON.stringify(sourceLayout));
    
    // Transform each window
    if (layout.windows && Array.isArray(layout.windows)) {
      layout.windows = layout.windows
        .map((window: any) => {
          if (!window) return null;
          
          // Generate new window ID to avoid conflicts
          window.id = uuidv4();
          
          // Handle different window types
          switch (window.type) {
            case 'chat':
              // Map chat session ID
              if (window.sessionId && sessionIdMap.has(window.sessionId)) {
                window.sessionId = sessionIdMap.get(window.sessionId);
                return window;
              }
              // Skip unmappable chat windows
              return null;
              
            case 'classic-browser':
              // Browser windows can be copied as-is (URLs not notebook-specific)
              return window;
              
            case 'note_editor':
              // Skip note editor windows (notes are notebook-specific)
              return null;
              
            default:
              // Copy other window types as-is
              return window;
          }
        })
        .filter((window: any) => window !== null);
    }
    
    return layout;
  }

  /**
   * Gets or creates a daily notebook for the specified date
   * 
   * Performance Note: This method loads all notebooks and filters by tag, which may seem inefficient
   * but is actually appropriate for the use case:
   * - Users typically have 10s-100s of notebooks, not thousands
   * - This operation runs at most once per day (subsequent calls return existing notebook)
   * - The filtering is fast enough at expected scale
   * 
   * Transaction Note: The synchronous transaction handling is intentional and correct.
   * better-sqlite3 requires synchronous callbacks for transactions. While our models have
   * async signatures for API consistency, they're synchronous internally. The manual
   * transaction with raw SQL ensures atomicity while working within these constraints.
   */
  async getOrCreateDailyNotebook(date: Date): Promise<NotebookRecord> {
    return this.execute('getOrCreateDailyNotebook', async () => {
      // Check if today's notebook already exists
      const existing = await this.getDailyNotebook(date);
      if (existing) {
        this.logger.info(`Returning existing daily notebook for ${date.toISOString()}`);
        return existing;
      }
      
      const title = this.formatDailyNotebookTitle(date);
      
      // Find the most recent daily notebook to copy content from
      // We do this inline to avoid loading all notebooks twice
      const yesterday = new Date(date);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayTitle = this.formatDailyNotebookTitle(yesterday);
      
      // Try to get yesterday's notebook specifically
      const notebooks = await this.deps.notebookModel.getAll();
      let sourceNotebook: NotebookRecord | null = null;
      
      // First try yesterday's notebook
      for (const notebook of notebooks) {
        if (notebook.title === yesterdayTitle && notebook.objectId) {
          const object = await this.deps.objectModelCore.getById(notebook.objectId);
          const tags = object?.tagsJson ? JSON.parse(object.tagsJson) : [];
          if (tags.includes('dailynotebook')) {
            sourceNotebook = notebook;
            this.logger.info(`Found yesterday's daily notebook: ${yesterdayTitle}`);
            break;
          }
        }
      }
      
      // If yesterday's doesn't exist, find the most recent daily notebook
      if (!sourceNotebook) {
        const dailyNotebooks: NotebookRecord[] = [];
        for (const n of notebooks) {
          if (!n.objectId || n.createdAt >= date.getTime()) continue;
          const obj = await this.deps.objectModelCore.getById(n.objectId);
          const tags = obj?.tagsJson ? JSON.parse(obj.tagsJson) : [];
          if (tags.includes('dailynotebook')) {
            dailyNotebooks.push(n);
          }
        }
        dailyNotebooks.sort((a, b) => b.createdAt - a.createdAt);
        
        sourceNotebook = dailyNotebooks[0] || null;
        if (sourceNotebook) {
          this.logger.info(`Found previous daily notebook: ${sourceNotebook.title}`);
        }
      }
      
      // Create the new notebook with transaction
      let sessionIdMap: Map<string, string> | null = null;
      
      const transaction = this.deps.db.transaction(() => {
        // Create the notebook
        const notebookId = uuidv4();
        const now = Date.now();
        const nowISO = new Date(now).toISOString();
        
        // Create the object with dailynotebook tag
        const objectResult = this.deps.objectModelCore.createSync({
          objectType: 'notebook',
          sourceUri: this.getNotebookObjectSourceUri(notebookId),
          title: title,
          cleanedText: title,
          tagsJson: JSON.stringify(['dailynotebook']),
          status: 'active' as ObjectStatus,
          rawContentRef: null
        });
        
        // Create the notebook
        // Create the notebook using raw SQL since createSync doesn't exist
        const notebookStmt = this.deps.db.prepare(
          'INSERT INTO notebooks (id, title, description, object_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        );
        notebookStmt.run(notebookId, title, null, objectResult.id, now, now);
        
        // If there's a source notebook, copy its content
        if (sourceNotebook) {
          this.logger.info(`Copying content from daily notebook: ${sourceNotebook.title}`);
          
          // Initialize session ID map
          sessionIdMap = new Map<string, string>();
          
          // Copy chunks
          // Get chunks synchronously for transaction
          const stmt = this.deps.db.prepare('SELECT * FROM chunks WHERE notebook_id = ? ORDER BY chunk_idx ASC');
          const sourceChunks = stmt.all(sourceNotebook.id) as any[];
          for (const chunk of sourceChunks) {
            this.deps.chunkModel.addChunkSync({
              objectId: objectResult.id,
              notebookId: notebookId,
              content: chunk.content,
              chunkIdx: chunk.chunk_idx,
              summary: chunk.summary,
              tagsJson: chunk.tags_json,
              propositionsJson: chunk.propositions_json,
              tokenCount: chunk.token_count
            });
          }
          
          // Copy chat sessions
          // Get sessions synchronously for transaction
          const sessionStmt = this.deps.db.prepare('SELECT * FROM chat_sessions WHERE notebook_id = ? ORDER BY updated_at DESC');
          const sourceSessions = sessionStmt.all(sourceNotebook.id) as any[];
          for (const session of sourceSessions) {
            const newSessionId = uuidv4();
            // Map old session ID to new session ID
            sessionIdMap.set(session.session_id, newSessionId);
            
            // Create session synchronously
            const sessionInsertStmt = this.deps.db.prepare(
              'INSERT INTO chat_sessions (session_id, notebook_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
            );
            sessionInsertStmt.run(newSessionId, notebookId, session.title, now, now);
            
            // Copy messages
            // Get messages synchronously
            const messageStmt = this.deps.db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC');
            const messages = messageStmt.all(session.session_id) as any[];
            for (const message of messages) {
              // Insert message synchronously
              const msgInsertStmt = this.deps.db.prepare(
                'INSERT INTO chat_messages (message_id, session_id, timestamp, role, content, metadata) VALUES (?, ?, ?, ?, ?, ?)'
              );
              msgInsertStmt.run(uuidv4(), newSessionId, message.timestamp, message.role, message.content, message.metadata);
            }
          }
        }
        
        return notebookId;
      });
      
      const notebookId = transaction();
      const newNotebook = await this.deps.notebookModel.getById(notebookId);
      
      if (!newNotebook) {
        throw new Error(`Failed to create daily notebook for ${title}`);
      }
      
      // Copy window layout if we have a source notebook and session mappings
      if (sourceNotebook && sessionIdMap && sessionIdMap.size > 0) {
        try {
          await this.copyWindowLayout(sourceNotebook.id, newNotebook.id, sessionIdMap);
        } catch (error) {
          // Log error but don't fail notebook creation
          this.logger.error(`Failed to copy window layout: ${error}`);
        }
      }
      
      // Log the creation
      await this.deps.activityLogService.logActivity({
        activityType: 'notebook_created',
        details: { notebookId: newNotebook.id, title: newNotebook.title, isDailyNotebook: true }
      });
      
      this.logger.info(`Created new daily notebook: ${title}`);
      return newNotebook;
    });
  }
}

