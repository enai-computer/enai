import { describe, beforeAll, afterAll, beforeEach, expect, it, vi, afterEach } from 'vitest';
import { setupTestDb, cleanTestDb } from './testUtils';
import { NotebookModel } from '../NotebookModel';
import { NotebookRecord } from '../../shared/types';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';

describe('NotebookModel Unit Tests', () => {
  let db: Database.Database;
  let notebookModel: NotebookModel;

  beforeAll(() => {
    db = setupTestDb();
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    cleanTestDb(db);
    notebookModel = new NotebookModel(db);
  });

  // Helper function to create test notebooks
  const createTestNotebook = (id: string = randomUUID()): string => {
    db.prepare(`
      INSERT INTO notebooks (id, title, object_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, 'Test Notebook', null, Date.now(), Date.now());
    return id;
  };

  // Helper function to create test objects
  const createTestObject = (id: string = randomUUID()): string => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO objects (id, object_type, status, created_at, updated_at, object_bio, object_relationships)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, 'webpage', 'new', now, now, '{"createdAt":"' + now + '","events":[]}', '{"related":[]}');
    return id;
  };

  describe('create', () => {
    it('should create a new notebook with title and description', async () => {
      const id = randomUUID();
      const title = 'Test Notebook';
      const description = 'This is a test description.';
      // object_id can be null for notebooks
      
      const createdNotebook = await notebookModel.create(id, title, null, description);

      expect(createdNotebook).toBeDefined();
      expect(createdNotebook.id).toBe(id);
      expect(createdNotebook.title).toBe(title);
      expect(createdNotebook.description).toBe(description);
      expect(createdNotebook.objectId).toBe(""); // Verify objectId
      expect(createdNotebook.createdAt).toEqual(expect.any(Number));
      expect(createdNotebook.updatedAt).toEqual(expect.any(Number));
      expect(createdNotebook.createdAt).toBe(createdNotebook.updatedAt);

      // Verify in DB
      const dbRecord = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as any;
      expect(dbRecord).toBeDefined();
      expect(dbRecord.title).toBe(title);
      expect(dbRecord.description).toBe(description);
      expect(dbRecord.object_id).toBeNull(); // Verify object_id in DB
    });

    it('should create a new notebook with title and null description', async () => {
      const id = randomUUID();
      const title = 'Test Notebook No Desc';
      // object_id can be null for notebooks
      
      const createdNotebook = await notebookModel.create(id, title, null, null);

      expect(createdNotebook.id).toBe(id);
      expect(createdNotebook.title).toBe(title);
      expect(createdNotebook.description).toBeNull();
      expect(createdNotebook.objectId).toBe(""); // Verify objectId

      const dbRecord = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as any;
      expect(dbRecord.description).toBeNull();
      expect(dbRecord.object_id).toBeNull(); // Verify object_id in DB
    });

    it('should create a new notebook with title and undefined description (becomes null)', async () => {
        const id = randomUUID();
        const title = 'Test Notebook Undef Desc';
        // object_id can be null for notebooks
        
        const createdNotebook = await notebookModel.create(id, title, null); // Undefined description
  
        expect(createdNotebook.id).toBe(id);
        expect(createdNotebook.title).toBe(title);
        expect(createdNotebook.description).toBeNull();
        expect(createdNotebook.objectId).toBe(""); // Verify objectId
  
        const dbRecord = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as any;
        expect(dbRecord.description).toBeNull();
        expect(dbRecord.object_id).toBeNull(); // Verify object_id in DB
      });

    it('should throw an error if trying to create a notebook with an existing ID', async () => {
      const id = randomUUID();
      // Use null for object_id
      // No need for objectId2
      await notebookModel.create(id, 'First Notebook', null, 'Desc1');
      
      await expect(notebookModel.create(id, 'Second Notebook Same ID', null, 'Desc2'))
        .rejects
        .toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })); // Or SQLITE_CONSTRAINT_UNIQUE
    });
  });

  describe('getById', () => {
    it('should retrieve an existing notebook by its ID', async () => {
      const id = randomUUID();
      const title = 'Notebook to Get';
      // object_id can be null for notebooks
      await notebookModel.create(id, title, null, 'Some description');
      
      const fetchedNotebook = await notebookModel.getById(id);
      
      expect(fetchedNotebook).toBeDefined();
      expect(fetchedNotebook?.id).toBe(id);
      expect(fetchedNotebook?.title).toBe(title);
      expect(fetchedNotebook?.description).toBe('Some description');
      expect(fetchedNotebook?.objectId).toBe(""); // Verify objectId
    });

    it('should return null if no notebook exists with the given ID', async () => {
      const nonExistentId = randomUUID();
      const fetchedNotebook = await notebookModel.getById(nonExistentId);
      expect(fetchedNotebook).toBeNull();
    });
  });

  describe('getAll', () => {
    it('should return only the default notebook cover if no other notebooks exist', async () => {
      const allNotebooks = await notebookModel.getAll();
      // Migration creates a default notebook cover, so we expect 1 item
      expect(allNotebooks.length).toBe(1);
      expect(allNotebooks[0].id).toBe('cover-default_user');
      expect(allNotebooks[0].title).toBe('Homepage Conversations');
    });

    it('should retrieve all notebooks ordered by title ascending', async () => {
      // Create notebooks out of alphabetical order to test sorting
      await notebookModel.create(randomUUID(), 'Charlie Notebook', null, 'Desc C');
      await notebookModel.create(randomUUID(), 'Alpha Notebook', null, 'Desc A');
      await notebookModel.create(randomUUID(), 'Bravo Notebook', null, 'Desc B');

      const allNotebooks = await notebookModel.getAll();

      // We expect 4 notebooks: 3 created + 1 default notebook cover
      expect(allNotebooks.length).toBe(4);
      // The notebooks are sorted by title, so check our created ones
      expect(allNotebooks[0].title).toBe('Alpha Notebook');
      expect(allNotebooks[1].title).toBe('Bravo Notebook');
      expect(allNotebooks[2].title).toBe('Charlie Notebook');
      expect(allNotebooks[3].title).toBe('Homepage Conversations'); // The default cover
    });

    it('should return multiple notebooks with correct data', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      // Use null for object_id
      // No need for objectId2
      await notebookModel.create(id1, 'Notebook One', null, 'Desc1');
      await notebookModel.create(id2, 'Notebook Two', null, 'Desc2');

      const allNotebooks = await notebookModel.getAll();
      expect(allNotebooks.length).toBe(3); // 2 created + 1 default notebook cover

      const nb1 = allNotebooks.find(nb => nb.id === id1);
      const nb2 = allNotebooks.find(nb => nb.id === id2);

      expect(nb1).toBeDefined();
      expect(nb1?.title).toBe('Notebook One');
      expect(nb1?.objectId).toBe(""); // Notebooks without objects have empty string
      expect(nb2).toBeDefined();
      expect(nb2?.title).toBe('Notebook Two');
      expect(nb2?.objectId).toBe(""); // Notebooks without objects have empty string
    });
  });

  describe('update', () => {
    let notebookToUpdate: NotebookRecord;
    let originalUpdatedAt: number;
    beforeEach(async () => {
      const id = randomUUID();
      notebookToUpdate = await notebookModel.create(id, 'Original Title', null, 'Original Description');
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
      expect(updatedNotebook?.objectId).toBe(""); // ObjectId should not change on update
      expect(updatedNotebook?.updatedAt).toBeGreaterThan(originalUpdatedAt);

      const dbRecord = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(notebookToUpdate.id) as any;
      expect(dbRecord.title).toBe(updates.title);
      expect(dbRecord.description).toBe(updates.description);
      expect(dbRecord.object_id).toBeNull(); // Verify object_id in DB
      expect(dbRecord.updated_at).toBeGreaterThan(originalUpdatedAt);
    });

    it('should update only the title', async () => {
      const updates = { title: 'New Title Only' };
      const updatedNotebook = await notebookModel.update(notebookToUpdate.id, updates);

      expect(updatedNotebook?.title).toBe(updates.title);
      expect(updatedNotebook?.description).toBe('Original Description');
      expect(updatedNotebook?.objectId).toBe(""); // ObjectId should not change on update
      expect(updatedNotebook?.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });

    it('should update only the description (to new value and to null)', async () => {
      let updates: Partial<Pick<NotebookRecord, 'title' | 'description'>> = { description: 'New Description Only' };
      let updatedNotebook = await notebookModel.update(notebookToUpdate.id, updates);
      let currentUpdatedAt = updatedNotebook!.updatedAt;

      expect(updatedNotebook?.title).toBe('Original Title');
      expect(updatedNotebook?.description).toBe(updates.description);
      expect(updatedNotebook?.objectId).toBe(""); // ObjectId should not change on update
      expect(currentUpdatedAt).toBeGreaterThan(originalUpdatedAt);

      // Update to null
      await new Promise(resolve => setTimeout(resolve, 50)); 
      updates = { description: null };
      updatedNotebook = await notebookModel.update(notebookToUpdate.id, updates);
      
      expect(updatedNotebook?.description).toBeNull();
      expect(updatedNotebook?.objectId).toBe(""); // ObjectId should not change on update
      expect(updatedNotebook?.updatedAt).toBeGreaterThanOrEqual(currentUpdatedAt);
    });

    it('should return the current record and not change updated_at if no fields are provided for update', async () => {
      const noUpdates = {};
      const resultNotebook = await notebookModel.update(notebookToUpdate.id, noUpdates);

      expect(resultNotebook?.id).toBe(notebookToUpdate.id);
      expect(resultNotebook?.title).toBe('Original Title');
      expect(resultNotebook?.description).toBe('Original Description');
      expect(resultNotebook?.objectId).toBe(""); // ObjectId should be empty string
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
      await notebookModel.create(id, 'Notebook To Delete', null, 'Description');
      
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

  describe('junction table methods', () => {
    it('should get object IDs for a notebook', () => {
      const notebookId = randomUUID();
      const objectId1 = randomUUID();
      const objectId2 = randomUUID();
      
      // Create notebook first
      db.prepare(`
        INSERT INTO notebooks (id, title, object_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(notebookId, 'Test Notebook', null, Date.now(), Date.now());
      
      // Create objects
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO objects (id, object_type, status, created_at, updated_at, object_bio, object_relationships)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(objectId1, 'webpage', 'new', now, now, '{"createdAt":"' + now + '","events":[]}', '{"related":[]}');
      
      db.prepare(`
        INSERT INTO objects (id, object_type, status, created_at, updated_at, object_bio, object_relationships)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(objectId2, 'webpage', 'new', now, now, '{"createdAt":"' + now + '","events":[]}', '{"related":[]}');
      
      // Now insert into junction table
      db.prepare(`
        INSERT INTO notebook_objects (notebook_id, object_id) 
        VALUES (?, ?)
      `).run(notebookId, objectId1);
      
      db.prepare(`
        INSERT INTO notebook_objects (notebook_id, object_id) 
        VALUES (?, ?)
      `).run(notebookId, objectId2);
      
      const objectIds = notebookModel.getObjectIdsForNotebook(notebookId);
      
      expect(objectIds).toHaveLength(2);
      expect(objectIds).toContain(objectId1);
      expect(objectIds).toContain(objectId2);
    });

    it('should get notebook IDs for an object', () => {
      const objectId = randomUUID();
      const notebookId1 = randomUUID();
      const notebookId2 = randomUUID();
      
      // Manually insert into junction table for testing
      db.prepare(`
        INSERT INTO notebook_objects (notebook_id, object_id) 
        VALUES (?, ?)
      `).run(notebookId1, objectId);
      
      db.prepare(`
        INSERT INTO notebook_objects (notebook_id, object_id) 
        VALUES (?, ?)
      `).run(notebookId2, objectId);
      
      const notebookIds = notebookModel.getNotebookIdsForObject(objectId);
      
      expect(notebookIds).toHaveLength(2);
      expect(notebookIds).toContain(notebookId1);
      expect(notebookIds).toContain(notebookId2);
    });

    it('should check if object is in notebook', () => {
      const notebookId = randomUUID();
      const objectId = randomUUID();
      const otherObjectId = randomUUID();
      
      // Insert one association
      db.prepare(`
        INSERT INTO notebook_objects (notebook_id, object_id) 
        VALUES (?, ?)
      `).run(notebookId, objectId);
      
      expect(notebookModel.isObjectInNotebook(notebookId, objectId)).toBe(true);
      expect(notebookModel.isObjectInNotebook(notebookId, otherObjectId)).toBe(false);
    });

    it('should get object count for notebook', () => {
      const notebookId = randomUUID();
      const emptyNotebookId = randomUUID();
      
      // Insert multiple objects
      for (let i = 0; i < 5; i++) {
        db.prepare(`
          INSERT INTO notebook_objects (notebook_id, object_id) 
          VALUES (?, ?)
        `).run(notebookId, randomUUID());
      }
      
      expect(notebookModel.getObjectCountForNotebook(notebookId)).toBe(5);
      expect(notebookModel.getObjectCountForNotebook(emptyNotebookId)).toBe(0);
    });

    it('should return empty arrays for non-existent IDs', () => {
      const nonExistentId = randomUUID();
      
      expect(notebookModel.getObjectIdsForNotebook(nonExistentId)).toEqual([]);
      expect(notebookModel.getNotebookIdsForObject(nonExistentId)).toEqual([]);
    });
  });

}); 