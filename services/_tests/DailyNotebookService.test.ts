import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { NotebookService } from '../NotebookService';
import { NotebookModel } from '../../models/NotebookModel';
import { ObjectModel } from '../../models/ObjectModel';
import { ChunkSqlModel } from '../../models/ChunkModel';
import { ChatModel } from '../../models/ChatModel';
import { ActivityLogService } from '../ActivityLogService';
import { ActivityLogModel } from '../../models/ActivityLogModel';
import { runMigrations } from '../../models/runMigrations';
import { v4 as uuidv4 } from 'uuid';

describe('DailyNotebookService', () => {
  let db: Database.Database;
  let notebookService: NotebookService;
  let notebookModel: NotebookModel;
  let objectModel: ObjectModel;
  let chunkModel: ChunkSqlModel;
  let chatModel: ChatModel;
  let activityLogService: ActivityLogService;
  let activityLogModel: ActivityLogModel;

  beforeEach(async () => {
    // Create in-memory database
    db = new Database(':memory:');
    await runMigrations(db);

    // Initialize models
    notebookModel = new NotebookModel(db);
    objectModel = new ObjectModel(db);
    chunkModel = new ChunkSqlModel(db);
    chatModel = new ChatModel(db);
    activityLogModel = new ActivityLogModel(db);

    // Initialize services
    activityLogService = new ActivityLogService({
      db,
      activityLogModel
    });

    notebookService = new NotebookService({
      db,
      notebookModel,
      objectModel,
      chunkSqlModel: chunkModel,
      chatModel,
      activityLogService,
      activityLogModel
    });
  });

  afterEach(() => {
    db.close();
  });

  describe('getDailyNotebook', () => {
    it('should return null when no daily notebooks exist', async () => {
      const result = await notebookService.getDailyNotebook(new Date('2025-01-04'));
      expect(result).toBeNull();
    });

    it('should return the daily notebook for the specified date if it exists', async () => {
      // Create a daily notebook for Jan 4, 2025
      const notebook = await notebookService.createNotebook('January-04-2025');
      
      // Add the dailynotebook tag to the object
      const object = objectModel.getById(notebook.objectId!);
      objectModel.update(object!.id, { tagsJson: JSON.stringify(['dailynotebook']) });

      const result = await notebookService.getDailyNotebook(new Date('2025-01-04'));
      expect(result).toBeDefined();
      expect(result?.title).toBe('January-04-2025');
    });

    it('should not return non-daily notebooks', async () => {
      // Create a regular notebook with a date-like title but no tag
      await notebookService.createNotebook('January-04-2025');
      
      const result = await notebookService.getDailyNotebook(new Date('2025-01-04'));
      expect(result).toBeNull();
    });
  });

  describe('getOrCreateDailyNotebook', () => {
    it('should create an empty notebook when no previous daily notebooks exist', async () => {
      const date = new Date('2025-01-04');
      const result = await notebookService.getOrCreateDailyNotebook(date);
      
      expect(result).toBeDefined();
      expect(result.title).toBe('January-04-2025');
      
      // Verify the object has the dailynotebook tag
      const object = objectModel.getById(result.objectId!);
      const tags = object?.tagsJson ? JSON.parse(object.tagsJson) : [];
      expect(tags).toContain('dailynotebook');
      
      // Verify no chunks were created (empty notebook)
      const chunks = await chunkModel.listByNotebookId(result.id);
      expect(chunks).toHaveLength(0);
    });

    it('should copy content from the most recent daily notebook', async () => {
      // Create a daily notebook for Jan 3, 2025 with content
      const jan3 = await notebookService.createNotebook('January-03-2025');
      objectModel.update(jan3.objectId!, { tagsJson: JSON.stringify(['dailynotebook']) });
      
      // Add some chunks to Jan 3
      const chunk1Id = uuidv4();
      const chunk2Id = uuidv4();
      await chunkModel.addChunk({
        id: chunk1Id,
        objectId: jan3.objectId!,
        notebookId: jan3.id,
        content: 'Morning meeting notes',
        chunkIdx: 0,
        summary: null,
        tagsJson: null,
        propositionsJson: null,
        tokenCount: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      await chunkModel.addChunk({
        id: chunk2Id,
        objectId: jan3.objectId!,
        notebookId: jan3.id,
        content: 'Afternoon tasks completed',
        chunkIdx: 1,
        summary: null,
        tagsJson: null,
        propositionsJson: null,
        tokenCount: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      
      // Create a chat session in Jan 3
      const sessionId = uuidv4();
      chatModel.createSession({
        id: sessionId,
        notebookId: jan3.id,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      chatModel.createMessage({
        id: uuidv4(),
        sessionId,
        role: 'user',
        content: 'What should I work on today?',
        createdAt: Date.now()
      });

      // Now create Jan 4's notebook
      const jan4 = await notebookService.getOrCreateDailyNotebook(new Date('2025-01-04'));
      
      // Verify content was copied
      const jan4Chunks = await chunkModel.listByNotebookId(jan4.id);
      expect(jan4Chunks).toHaveLength(2);
      expect(jan4Chunks[0].content).toBe('Morning meeting notes');
      expect(jan4Chunks[1].content).toBe('Afternoon tasks completed');
      
      // Verify chat session was copied
      const jan4Sessions = await chatModel.listSessionsForNotebook(jan4.id);
      expect(jan4Sessions).toHaveLength(1);
      
      const jan4Messages = await chatModel.getMessagesBySessionId(jan4Sessions[0].sessionId);
      expect(jan4Messages).toHaveLength(1);
      expect(jan4Messages[0].content).toBe('What should I work on today?');
    });

    it('should return existing daily notebook if it already exists', async () => {
      // Create Jan 4's notebook
      const jan4 = await notebookService.createNotebook('January-04-2025');
      objectModel.update(jan4.objectId!, { tagsJson: JSON.stringify(['dailynotebook']) });
      
      // Add a chunk to identify it
      await chunkModel.addChunk({
        id: uuidv4(),
        objectId: jan4.objectId!,
        notebookId: jan4.id,
        content: 'Original content',
        chunkIdx: 0,
        summary: null,
        tagsJson: null,
        propositionsJson: null,
        tokenCount: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      // Try to get/create it again
      const result = await notebookService.getOrCreateDailyNotebook(new Date('2025-01-04'));
      
      // Should be the same notebook
      expect(result.id).toBe(jan4.id);
      
      // Content should be unchanged
      const chunks = await chunkModel.listByNotebookId(result.id);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('Original content');
    });

    it('should handle month formatting correctly', async () => {
      const testCases = [
        { date: new Date('2025-01-04'), expected: 'January-04-2025' },
        { date: new Date('2025-02-28'), expected: 'February-28-2025' },
        { date: new Date('2025-12-01'), expected: 'December-01-2025' },
        { date: new Date('2025-07-04'), expected: 'July-04-2025' }
      ];

      for (const testCase of testCases) {
        const notebook = await notebookService.getOrCreateDailyNotebook(testCase.date);
        expect(notebook.title).toBe(testCase.expected);
      }
    });
  });

  describe('filterOutDailyNotebooks', () => {
    it('should exclude daily notebooks from regular notebook lists', async () => {
      // Create mix of regular and daily notebooks
      const regular1 = await notebookService.createNotebook('Regular Notebook 1');
      const regular2 = await notebookService.createNotebook('Regular Notebook 2');
      
      const daily1 = await notebookService.createNotebook('January-03-2025');
      objectModel.update(daily1.objectId!, { tagsJson: JSON.stringify(['dailynotebook']) });
      
      const daily2 = await notebookService.createNotebook('January-04-2025');
      objectModel.update(daily2.objectId!, { tagsJson: JSON.stringify(['dailynotebook']) });

      // Get all notebooks
      const allNotebooks = await notebookService.getAllNotebooks();
      expect(allNotebooks).toHaveLength(4);

      // Get regular notebooks (should exclude daily)
      const regularNotebooks = await notebookService.getAllRegularNotebooks();
      expect(regularNotebooks).toHaveLength(2);
      expect(regularNotebooks.map(n => n.title)).toEqual(['Regular Notebook 1', 'Regular Notebook 2']);
    });
  });
});