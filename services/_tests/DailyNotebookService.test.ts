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
      objectModel.update(object!.id, { tags: ['dailynotebook'] });

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
      expect(object?.tags).toContain('dailynotebook');
      
      // Verify no chunks were created (empty notebook)
      const chunks = chunkModel.getByNotebookId(result.id);
      expect(chunks).toHaveLength(0);
    });

    it('should copy content from the most recent daily notebook', async () => {
      // Create a daily notebook for Jan 3, 2025 with content
      const jan3 = await notebookService.createNotebook('January-03-2025');
      objectModel.update(jan3.objectId!, { tags: ['dailynotebook'] });
      
      // Add some chunks to Jan 3
      const chunk1Id = uuidv4();
      const chunk2Id = uuidv4();
      chunkModel.create({
        id: chunk1Id,
        objectId: jan3.objectId!,
        notebookId: jan3.id,
        text: 'Morning meeting notes',
        cleanedText: 'Morning meeting notes',
        chunkIndex: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      chunkModel.create({
        id: chunk2Id,
        objectId: jan3.objectId!,
        notebookId: jan3.id,
        text: 'Afternoon tasks completed',
        cleanedText: 'Afternoon tasks completed',
        chunkIndex: 1,
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
      const jan4Chunks = chunkModel.getByNotebookId(jan4.id);
      expect(jan4Chunks).toHaveLength(2);
      expect(jan4Chunks[0].text).toBe('Morning meeting notes');
      expect(jan4Chunks[1].text).toBe('Afternoon tasks completed');
      
      // Verify chat session was copied
      const jan4Sessions = chatModel.getSessionsByNotebookId(jan4.id);
      expect(jan4Sessions).toHaveLength(1);
      
      const jan4Messages = chatModel.getMessagesBySessionId(jan4Sessions[0].id);
      expect(jan4Messages).toHaveLength(1);
      expect(jan4Messages[0].content).toBe('What should I work on today?');
    });

    it('should return existing daily notebook if it already exists', async () => {
      // Create Jan 4's notebook
      const jan4 = await notebookService.createNotebook('January-04-2025');
      objectModel.update(jan4.objectId!, { tags: ['dailynotebook'] });
      
      // Add a chunk to identify it
      chunkModel.create({
        id: uuidv4(),
        objectId: jan4.objectId!,
        notebookId: jan4.id,
        text: 'Original content',
        cleanedText: 'Original content',
        chunkIndex: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      // Try to get/create it again
      const result = await notebookService.getOrCreateDailyNotebook(new Date('2025-01-04'));
      
      // Should be the same notebook
      expect(result.id).toBe(jan4.id);
      
      // Content should be unchanged
      const chunks = chunkModel.getByNotebookId(result.id);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe('Original content');
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

  describe('getPreviousDailyNotebook', () => {
    it('should return the most recent daily notebook before the given date', async () => {
      // Create daily notebooks for Jan 1, 3, and 5
      const jan1 = await notebookService.createNotebook('January-01-2025');
      objectModel.update(jan1.objectId!, { tags: ['dailynotebook'] });
      
      const jan3 = await notebookService.createNotebook('January-03-2025');
      objectModel.update(jan3.objectId!, { tags: ['dailynotebook'] });
      
      const jan5 = await notebookService.createNotebook('January-05-2025');
      objectModel.update(jan5.objectId!, { tags: ['dailynotebook'] });

      // Get previous from Jan 4 should return Jan 3
      const result = await notebookService.getPreviousDailyNotebook(new Date('2025-01-04'));
      expect(result?.title).toBe('January-03-2025');
    });

    it('should return null if no daily notebooks exist before the given date', async () => {
      // Create a daily notebook for Jan 5
      const jan5 = await notebookService.createNotebook('January-05-2025');
      objectModel.update(jan5.objectId!, { tags: ['dailynotebook'] });

      // Get previous from Jan 4 should return null
      const result = await notebookService.getPreviousDailyNotebook(new Date('2025-01-04'));
      expect(result).toBeNull();
    });
  });

  describe('convertToDailyNotebook', () => {
    it('should rename a notebook to today\'s date and add dailynotebook tag', async () => {
      // Create a regular notebook
      const notebook = await notebookService.createNotebook('Old Title');
      
      // Mock current date to Jan 4, 2025
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-04'));

      // Convert to daily notebook
      const result = await notebookService.convertToDailyNotebook(notebook.id);
      
      expect(result.title).toBe('January-04-2025');
      
      // Verify tag was added
      const object = objectModel.getById(result.objectId!);
      expect(object?.tags).toContain('dailynotebook');

      vi.useRealTimers();
    });

    it('should not convert if a daily notebook already exists for today', async () => {
      // Create today's daily notebook
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-04'));
      
      const todayNotebook = await notebookService.createNotebook('January-04-2025');
      objectModel.update(todayNotebook.objectId!, { tags: ['dailynotebook'] });
      
      // Create another notebook
      const otherNotebook = await notebookService.createNotebook('Other Notebook');
      
      // Try to convert - should throw or return the original
      await expect(
        notebookService.convertToDailyNotebook(otherNotebook.id)
      ).rejects.toThrow('Daily notebook already exists for today');

      vi.useRealTimers();
    });
  });

  describe('filterOutDailyNotebooks', () => {
    it('should exclude daily notebooks from regular notebook lists', async () => {
      // Create mix of regular and daily notebooks
      const regular1 = await notebookService.createNotebook('Regular Notebook 1');
      const regular2 = await notebookService.createNotebook('Regular Notebook 2');
      
      const daily1 = await notebookService.createNotebook('January-03-2025');
      objectModel.update(daily1.objectId!, { tags: ['dailynotebook'] });
      
      const daily2 = await notebookService.createNotebook('January-04-2025');
      objectModel.update(daily2.objectId!, { tags: ['dailynotebook'] });

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