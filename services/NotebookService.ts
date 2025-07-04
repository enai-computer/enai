import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { BaseService } from './base/BaseService';
import { NotebookModel } from '../models/NotebookModel';
import { ObjectModel } from '../models/ObjectModel';
import { ChunkSqlModel } from '../models/ChunkModel';
import { ChatModel } from '../models/ChatModel';
import { ActivityLogService } from './ActivityLogService';
import { ActivityLogModel } from '../models/ActivityLogModel';
import { NotebookRecord, ObjectChunk, JeffersObject, IChatSession, ObjectStatus, RecentNotebook } from '../shared/types';

interface NotebookServiceDeps {
  db: Database.Database;
  notebookModel: NotebookModel;
  objectModel: ObjectModel;
  chunkSqlModel: ChunkSqlModel;
  chatModel: ChatModel;
  activityLogService: ActivityLogService;
  activityLogModel: ActivityLogModel;
}

export class NotebookService extends BaseService<NotebookServiceDeps> {
  constructor(deps: NotebookServiceDeps) {
    super('NotebookService', deps);
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

        const jeffersObject = await this.deps.objectModel.create(notebookJeffersObjectData);
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
      const regularNotebooks = notebooks.filter(notebook => {
        if (!notebook.objectId) return true; // Keep notebooks without objects
        
        const object = this.deps.objectModel.getById(notebook.objectId);
        return !object?.tags?.includes('dailynotebook');
      });
      
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
            const jeffersObject = await this.deps.objectModel.getBySourceUri(sourceUri);

            if (jeffersObject) {
              const newCleanedText = updatedNotebookRecord.title + (updatedNotebookRecord.description ? `\n${updatedNotebookRecord.description}` : '');
              const objectUpdates: Partial<Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'>> = {
                title: updatedNotebookRecord.title,
                cleanedText: newCleanedText,
              };
              await this.deps.objectModel.update(jeffersObject.id, objectUpdates);
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
        const jeffersObject = await this.deps.objectModel.getBySourceUri(sourceUri);
        
        if (jeffersObject) {
          await this.deps.objectModel.deleteById(jeffersObject.id);
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
      
      const success = await this.deps.chunkSqlModel.assignToNotebook(chunkId, notebookId);
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
      return this.deps.chunkSqlModel.listByNotebookId(notebookId);
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
   * Formats a date into the daily notebook title format: "Month-DD-YYYY"
   */
  private formatDailyNotebookTitle(date: Date): string {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                    'July', 'August', 'September', 'October', 'November', 'December'];
    const month = months[date.getMonth()];
    const day = date.getDate().toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${month}-${day}-${year}`;
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
          const object = this.deps.objectModel.getById(notebook.objectId);
          if (object?.tags?.includes('dailynotebook')) {
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
   * Gets the most recent daily notebook before the specified date
   */
  async getPreviousDailyNotebook(date: Date): Promise<NotebookRecord | null> {
    return this.execute('getPreviousDailyNotebook', async () => {
      const targetTimestamp = date.getTime();
      
      // Get all notebooks and filter for daily notebooks
      const notebooks = await this.deps.notebookModel.getAll();
      const dailyNotebooks: NotebookRecord[] = [];
      
      for (const notebook of notebooks) {
        if (notebook.objectId) {
          const object = this.deps.objectModel.getById(notebook.objectId);
          if (object?.tags?.includes('dailynotebook')) {
            dailyNotebooks.push(notebook);
          }
        }
      }
      
      // Sort by created date descending and find the most recent before target date
      const sorted = dailyNotebooks
        .filter(n => n.createdAt < targetTimestamp)
        .sort((a, b) => b.createdAt - a.createdAt);
      
      const previous = sorted[0] || null;
      if (previous) {
        this.logger.info(`Found previous daily notebook: ${previous.title}`);
      } else {
        this.logger.debug(`No previous daily notebook found before ${date.toISOString()}`);
      }
      
      return previous;
    });
  }

  /**
   * Gets or creates a daily notebook for the specified date
   */
  async getOrCreateDailyNotebook(date: Date): Promise<NotebookRecord> {
    return this.execute('getOrCreateDailyNotebook', async () => {
      // Check if today's notebook already exists
      const existing = await this.getDailyNotebook(date);
      if (existing) {
        this.logger.info(`Returning existing daily notebook for ${date.toISOString()}`);
        return existing;
      }
      
      // Get the previous daily notebook to copy content from
      const previous = await this.getPreviousDailyNotebook(date);
      const title = this.formatDailyNotebookTitle(date);
      
      // Create the new notebook with transaction
      const transaction = this.deps.db.transaction(() => {
        // Create the notebook
        const notebookId = uuidv4();
        const objectId = uuidv4();
        const now = Date.now();
        
        // Create the object with dailynotebook tag
        this.deps.objectModel.create({
          id: objectId,
          type: 'notebook',
          title: title,
          url: null,
          cleanedText: null,
          tags: ['dailynotebook'],
          createdAt: now,
          updatedAt: now,
          status: 'active' as ObjectStatus
        });
        
        // Create the notebook
        this.deps.notebookModel.create({
          id: notebookId,
          title: title,
          description: null,
          objectId: objectId,
          createdAt: now,
          updatedAt: now
        });
        
        // If there's a previous notebook, copy its content
        if (previous) {
          this.logger.info(`Copying content from previous daily notebook: ${previous.title}`);
          
          // Copy chunks
          const previousChunks = this.deps.chunkSqlModel.getByNotebookId(previous.id);
          for (const chunk of previousChunks) {
            this.deps.chunkSqlModel.create({
              id: uuidv4(),
              objectId: objectId,
              notebookId: notebookId,
              text: chunk.text,
              cleanedText: chunk.cleanedText,
              chunkIndex: chunk.chunkIndex,
              createdAt: now,
              updatedAt: now
            });
          }
          
          // Copy chat sessions
          const previousSessions = this.deps.chatModel.getSessionsByNotebookId(previous.id);
          for (const session of previousSessions) {
            const newSessionId = uuidv4();
            this.deps.chatModel.createSession({
              id: newSessionId,
              notebookId: notebookId,
              createdAt: now,
              updatedAt: now
            });
            
            // Copy messages
            const messages = this.deps.chatModel.getMessagesBySessionId(session.id);
            for (const message of messages) {
              this.deps.chatModel.createMessage({
                id: uuidv4(),
                sessionId: newSessionId,
                role: message.role,
                content: message.content,
                createdAt: message.createdAt
              });
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
      
      // Log the creation
      await this.deps.activityLogService.logActivity({
        activityType: 'notebook_creation',
        details: { notebookId: newNotebook.id, title: newNotebook.title, isDailyNotebook: true }
      });
      
      this.logger.info(`Created new daily notebook: ${title}`);
      return newNotebook;
    });
  }

  /**
   * Converts an existing notebook to today's daily notebook
   */
  async convertToDailyNotebook(notebookId: string): Promise<NotebookRecord> {
    return this.execute('convertToDailyNotebook', async () => {
      const today = new Date();
      const todayNotebook = await this.getDailyNotebook(today);
      
      if (todayNotebook) {
        throw new Error('Daily notebook already exists for today');
      }
      
      const notebook = await this.deps.notebookModel.getById(notebookId);
      if (!notebook) {
        throw new Error(`Notebook not found with ID: ${notebookId}`);
      }
      
      const newTitle = this.formatDailyNotebookTitle(today);
      
      // Update notebook title and add tag
      const transaction = this.deps.db.transaction(() => {
        // Update notebook
        this.deps.notebookModel.update(notebookId, { 
          title: newTitle,
          updatedAt: Date.now()
        });
        
        // Add dailynotebook tag
        if (notebook.objectId) {
          const obj = this.deps.objectModel.getById(notebook.objectId);
          const existingTags = obj?.tags || [];
          if (!existingTags.includes('dailynotebook')) {
            this.deps.objectModel.update(notebook.objectId, { 
              tags: [...existingTags, 'dailynotebook'],
              title: newTitle,
              updatedAt: Date.now()
            });
          }
        }
      });
      
      transaction();
      
      const updated = await this.deps.notebookModel.getById(notebookId);
      if (!updated) {
        throw new Error(`Failed to convert notebook ${notebookId} to daily notebook`);
      }
      
      this.logger.info(`Converted notebook ${notebookId} to daily notebook: ${newTitle}`);
      return updated;
    });
  }
}

