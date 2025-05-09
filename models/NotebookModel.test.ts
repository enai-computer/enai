import { describe, beforeEach, expect, it, vi, afterEach } from 'vitest';
import { initDb, closeDb } from './db'; // Assuming db.ts is in the same directory for models
import runMigrations from './runMigrations';
import { NotebookModel } from './NotebookModel';
import { NotebookRecord } from '../shared/types';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';

const testDbPath = ':memory:';

describe('NotebookModel Unit Tests', () => {
  let db: Database.Database;
  let notebookModel: NotebookModel;

  beforeEach(() => {
    // Vitest typically runs tests in a way that might share context if not careful.
    // For better-sqlite3 in-memory, creating a new instance is the cleanest way.
    db = new Database(testDbPath); // Create a new in-memory DB for each test
    runMigrations(db); // Apply migrations to this new DB instance
    notebookModel = new NotebookModel(db);
  });

  afterEach(() => {
    if (db && db.open) {
      // It's important that the local 'db' instance for the test is closed if it's not the global one.
      // However, if beforeEach now sets the global instance, closeDb() handles it.
      // db.close(); // This would be for a purely local instance not affecting global.
    }
    closeDb(); // Ensure global singleton is closed and nullified.
  });

  describe('create', () => {
    it('should create a new notebook with title and description', async () => {
      const id = randomUUID();
      const title = 'Test Notebook';
      const description = 'This is a test description.';
      
      const createdNotebook = await notebookModel.create(id, title, description);

      expect(createdNotebook).toBeDefined();
      expect(createdNotebook.id).toBe(id);
      expect(createdNotebook.title).toBe(title);
      expect(createdNotebook.description).toBe(description);
      expect(createdNotebook.createdAt).toEqual(expect.any(Number));
      expect(createdNotebook.updatedAt).toEqual(expect.any(Number));
      expect(createdNotebook.createdAt).toBe(createdNotebook.updatedAt);

      // Verify in DB
      const dbRecord = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as any;
      expect(dbRecord).toBeDefined();
      expect(dbRecord.title).toBe(title);
      expect(dbRecord.description).toBe(description);
    });

    it('should create a new notebook with title and null description', async () => {
      const id = randomUUID();
      const title = 'Test Notebook No Desc';
      
      const createdNotebook = await notebookModel.create(id, title, null);

      expect(createdNotebook.id).toBe(id);
      expect(createdNotebook.title).toBe(title);
      expect(createdNotebook.description).toBeNull();

      const dbRecord = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as any;
      expect(dbRecord.description).toBeNull();
    });

    it('should create a new notebook with title and undefined description (becomes null)', async () => {
        const id = randomUUID();
        const title = 'Test Notebook Undef Desc';
        
        const createdNotebook = await notebookModel.create(id, title); // Undefined description
  
        expect(createdNotebook.id).toBe(id);
        expect(createdNotebook.title).toBe(title);
        expect(createdNotebook.description).toBeNull();
  
        const dbRecord = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as any;
        expect(dbRecord.description).toBeNull();
      });

    it('should throw an error if trying to create a notebook with an existing ID', async () => {
      const id = randomUUID();
      await notebookModel.create(id, 'First Notebook', 'Desc1');
      
      await expect(notebookModel.create(id, 'Second Notebook Same ID', 'Desc2'))
        .rejects
        .toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })); // Or SQLITE_CONSTRAINT_UNIQUE
    });
  });

  describe('getById', () => {
    it('should retrieve an existing notebook by its ID', async () => {
      const id = randomUUID();
      const title = 'Notebook to Get';
      await notebookModel.create(id, title, 'Some description');
      
      const fetchedNotebook = await notebookModel.getById(id);
      
      expect(fetchedNotebook).toBeDefined();
      expect(fetchedNotebook?.id).toBe(id);
      expect(fetchedNotebook?.title).toBe(title);
      expect(fetchedNotebook?.description).toBe('Some description');
    });

    it('should return null if no notebook exists with the given ID', async () => {
      const nonExistentId = randomUUID();
      const fetchedNotebook = await notebookModel.getById(nonExistentId);
      expect(fetchedNotebook).toBeNull();
    });
  });

  describe('getAll', () => {
    it('should return an empty array if no notebooks exist', async () => {
      const allNotebooks = await notebookModel.getAll();
      expect(allNotebooks).toEqual([]);
    });

    it('should retrieve all notebooks ordered by title ascending', async () => {
      // Create notebooks out of alphabetical order to test sorting
      await notebookModel.create(randomUUID(), 'Charlie Notebook', 'Desc C');
      await notebookModel.create(randomUUID(), 'Alpha Notebook', 'Desc A');
      await notebookModel.create(randomUUID(), 'Bravo Notebook', 'Desc B');

      const allNotebooks = await notebookModel.getAll();

      expect(allNotebooks.length).toBe(3);
      expect(allNotebooks[0].title).toBe('Alpha Notebook');
      expect(allNotebooks[1].title).toBe('Bravo Notebook');
      expect(allNotebooks[2].title).toBe('Charlie Notebook');
    });

    it('should return multiple notebooks with correct data', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      await notebookModel.create(id1, 'Notebook One', 'Desc1');
      await notebookModel.create(id2, 'Notebook Two', 'Desc2');

      const allNotebooks = await notebookModel.getAll();
      expect(allNotebooks.length).toBe(2);

      const nb1 = allNotebooks.find(nb => nb.id === id1);
      const nb2 = allNotebooks.find(nb => nb.id === id2);

      expect(nb1).toBeDefined();
      expect(nb1?.title).toBe('Notebook One');
      expect(nb2).toBeDefined();
      expect(nb2?.title).toBe('Notebook Two');
    });
  });

  describe('update', () => {
    let notebookToUpdate: NotebookRecord;
    let originalUpdatedAt: number;

    beforeEach(async () => {
      const id = randomUUID();
      notebookToUpdate = await notebookModel.create(id, 'Original Title', 'Original Description');
      originalUpdatedAt = notebookToUpdate.updatedAt;
      // Ensure a small delay so that a subsequent update can have a different timestamp
      await new Promise(resolve => setTimeout(resolve, 1001)); 
    });

    it('should update the title and description of an existing notebook', async () => {
      const updates = { title: 'Updated Title', description: 'Updated Description' };
      const updatedNotebook = await notebookModel.update(notebookToUpdate.id, updates);

      expect(updatedNotebook).toBeDefined();
      expect(updatedNotebook?.id).toBe(notebookToUpdate.id);
      expect(updatedNotebook?.title).toBe(updates.title);
      expect(updatedNotebook?.description).toBe(updates.description);
      expect(updatedNotebook?.updatedAt).toBeGreaterThan(originalUpdatedAt);

      const dbRecord = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(notebookToUpdate.id) as any;
      expect(dbRecord.title).toBe(updates.title);
      expect(dbRecord.description).toBe(updates.description);
      expect(dbRecord.updated_at).toBeGreaterThan(originalUpdatedAt);
    });

    it('should update only the title', async () => {
      const updates = { title: 'New Title Only' };
      const updatedNotebook = await notebookModel.update(notebookToUpdate.id, updates);

      expect(updatedNotebook?.title).toBe(updates.title);
      expect(updatedNotebook?.description).toBe('Original Description');
      expect(updatedNotebook?.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });

    it('should update only the description (to new value and to null)', async () => {
      let updates: Partial<Pick<NotebookRecord, 'title' | 'description'>> = { description: 'New Description Only' };
      let updatedNotebook = await notebookModel.update(notebookToUpdate.id, updates);
      let currentUpdatedAt = updatedNotebook!.updatedAt;

      expect(updatedNotebook?.title).toBe('Original Title');
      expect(updatedNotebook?.description).toBe(updates.description);
      expect(currentUpdatedAt).toBeGreaterThan(originalUpdatedAt);

      // Update to null
      await new Promise(resolve => setTimeout(resolve, 50)); 
      updates = { description: null };
      updatedNotebook = await notebookModel.update(notebookToUpdate.id, updates);
      
      expect(updatedNotebook?.description).toBeNull();
      expect(updatedNotebook?.updatedAt).toBeGreaterThanOrEqual(currentUpdatedAt);
    });

    it('should return the current record and not change updated_at if no fields are provided for update', async () => {
      const noUpdates = {};
      const resultNotebook = await notebookModel.update(notebookToUpdate.id, noUpdates);

      expect(resultNotebook?.id).toBe(notebookToUpdate.id);
      expect(resultNotebook?.title).toBe('Original Title');
      expect(resultNotebook?.description).toBe('Original Description');
      // Because the model short-circuits, the UPDATE SQL is not run, so trigger doesn't fire.
      expect(resultNotebook?.updatedAt).toBe(originalUpdatedAt); 
    });

    it('should return null when trying to update a non-existent notebook', async () => {
      const nonExistentId = randomUUID();
      const result = await notebookModel.update(nonExistentId, { title: 'No Notebook Here' });
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an existing notebook and return true', async () => {
      const id = randomUUID();
      await notebookModel.create(id, 'Notebook To Delete', 'Description');
      
      const deleteResult = await notebookModel.delete(id);
      expect(deleteResult).toBe(true);

      const fetchedNotebook = await notebookModel.getById(id);
      expect(fetchedNotebook).toBeNull();
    });

    it('should return false when trying to delete a non-existent notebook', async () => {
      const nonExistentId = randomUUID();
      const deleteResult = await notebookModel.delete(nonExistentId);
      expect(deleteResult).toBe(false);
    });
  });

}); 