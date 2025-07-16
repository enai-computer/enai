import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDb, cleanTestDb } from './testUtils';
import { ObjectAssociationModel } from '../ObjectAssociationModel';
import { ObjectModelCore } from '../ObjectModelCore';
import { createTestObject, createTestNotebook } from './test-utils/helpers';

let testDb: Database.Database;
let association: ObjectAssociationModel;
let core: ObjectModelCore;

describe('ObjectAssociationModel', () => {
  beforeAll(() => {
    testDb = setupTestDb();
    association = new ObjectAssociationModel(testDb);
    core = new ObjectModelCore(testDb);
  });

  afterAll(() => {
    testDb.close();
  });

  beforeEach(() => {
    cleanTestDb(testDb);
    association = new ObjectAssociationModel(testDb);
    core = new ObjectModelCore(testDb);
  });

  describe('addToNotebook', () => {
    it('should add object to notebook', async () => {
      const obj = await core.create(createTestObject());
      const notebookId = 'notebook-123';
      createTestNotebook(testDb, notebookId);

      await association.addToNotebook(obj.id, notebookId);

      const notebookIds = association.getNotebookIdsForObject(obj.id);
      expect(notebookIds).toContain(notebookId);
    });

    it('should handle duplicate additions gracefully', async () => {
      const obj = await core.create(createTestObject());
      const notebookId = 'notebook-456';
      createTestNotebook(testDb, notebookId);

      await association.addToNotebook(obj.id, notebookId);
      await association.addToNotebook(obj.id, notebookId); // Duplicate

      const notebookIds = association.getNotebookIdsForObject(obj.id);
      expect(notebookIds).toHaveLength(1);
      expect(notebookIds[0]).toBe(notebookId);
    });

    it('should add object to multiple notebooks', async () => {
      const obj = await core.create(createTestObject());
      const notebook1 = 'notebook-1';
      const notebook2 = 'notebook-2';
      const notebook3 = 'notebook-3';
      
      createTestNotebook(testDb, notebook1);
      createTestNotebook(testDb, notebook2);
      createTestNotebook(testDb, notebook3);

      await association.addToNotebook(obj.id, notebook1);
      await association.addToNotebook(obj.id, notebook2);
      await association.addToNotebook(obj.id, notebook3);

      const notebookIds = association.getNotebookIdsForObject(obj.id);
      expect(notebookIds).toHaveLength(3);
      expect(notebookIds).toContain(notebook1);
      expect(notebookIds).toContain(notebook2);
      expect(notebookIds).toContain(notebook3);
    });

    it('should track added_at timestamp', async () => {
      const obj = await core.create(createTestObject());
      const notebookId = 'notebook-timestamp';
      createTestNotebook(testDb, notebookId);

      await association.addToNotebook(obj.id, notebookId);

      const addedAt = association.getAddedAt(obj.id, notebookId);
      expect(addedAt).toBeInstanceOf(Date);
    });
  });

  describe('removeFromNotebook', () => {
    it('should remove existing association', async () => {
      const obj = await core.create(createTestObject());
      const notebookId = 'notebook-remove';
      createTestNotebook(testDb, notebookId);

      await association.addToNotebook(obj.id, notebookId);
      await association.removeFromNotebook(obj.id, notebookId);

      const notebookIds = association.getNotebookIdsForObject(obj.id);
      expect(notebookIds).not.toContain(notebookId);
      expect(notebookIds).toHaveLength(0);
    });

    it('should handle removing non-existent association', async () => {
      const obj = await core.create(createTestObject());
      const notebookId = 'notebook-not-associated';
      createTestNotebook(testDb, notebookId);

      // Should not throw
      await association.removeFromNotebook(obj.id, notebookId);

      const notebookIds = association.getNotebookIdsForObject(obj.id);
      expect(notebookIds).toHaveLength(0);
    });

    it('should only remove specified association', async () => {
      const obj = await core.create(createTestObject());
      const notebook1 = 'notebook-keep';
      const notebook2 = 'notebook-remove';
      const notebook3 = 'notebook-also-keep';
      
      createTestNotebook(testDb, notebook1);
      createTestNotebook(testDb, notebook2);
      createTestNotebook(testDb, notebook3);

      await association.addToNotebook(obj.id, notebook1);
      await association.addToNotebook(obj.id, notebook2);
      await association.addToNotebook(obj.id, notebook3);

      await association.removeFromNotebook(obj.id, notebook2);

      const notebookIds = association.getNotebookIdsForObject(obj.id);
      expect(notebookIds).toHaveLength(2);
      expect(notebookIds).toContain(notebook1);
      expect(notebookIds).toContain(notebook3);
      expect(notebookIds).not.toContain(notebook2);
    });
  });

  describe('getNotebookIdsForObject', () => {
    it('should return empty array for object with no notebooks', async () => {
      const obj = await core.create(createTestObject());
      
      const notebookIds = association.getNotebookIdsForObject(obj.id);
      
      expect(notebookIds).toEqual([]);
    });

    it('should return notebook IDs sorted by added_at DESC', async () => {
      const obj = await core.create(createTestObject());
      const notebook1 = 'notebook-first';
      const notebook2 = 'notebook-second';
      const notebook3 = 'notebook-third';
      
      createTestNotebook(testDb, notebook1);
      createTestNotebook(testDb, notebook2);
      createTestNotebook(testDb, notebook3);

      // Add with explicit timestamps using SQL to ensure different values
      const stmt = testDb.prepare(`
        INSERT INTO notebook_objects (notebook_id, object_id, added_at) 
        VALUES (?, ?, ?)
      `);
      
      stmt.run(notebook1, obj.id, '2023-01-01T10:00:00.000Z');
      stmt.run(notebook2, obj.id, '2023-01-01T10:00:01.000Z');
      stmt.run(notebook3, obj.id, '2023-01-01T10:00:02.000Z');

      const notebookIds = association.getNotebookIdsForObject(obj.id);
      
      // Most recent first
      expect(notebookIds[0]).toBe(notebook3);
      expect(notebookIds[1]).toBe(notebook2);
      expect(notebookIds[2]).toBe(notebook1);
    });

    it('should handle non-existent object ID', () => {
      const notebookIds = association.getNotebookIdsForObject('non-existent-object');
      expect(notebookIds).toEqual([]);
    });
  });

  describe('getObjectIdsForNotebook', () => {
    it('should return empty array for notebook with no objects', () => {
      const notebookId = 'empty-notebook';
      createTestNotebook(testDb, notebookId);
      
      const objectIds = association.getObjectIdsForNotebook(notebookId);
      
      expect(objectIds).toEqual([]);
    });

    it('should return object IDs for notebook', async () => {
      const obj1 = await core.create(createTestObject());
      const obj2 = await core.create(createTestObject());
      const obj3 = await core.create(createTestObject());
      const notebookId = 'notebook-with-objects';
      createTestNotebook(testDb, notebookId);

      await association.addToNotebook(obj1.id, notebookId);
      await association.addToNotebook(obj2.id, notebookId);
      await association.addToNotebook(obj3.id, notebookId);

      const objectIds = association.getObjectIdsForNotebook(notebookId);
      
      expect(objectIds).toHaveLength(3);
      expect(objectIds).toContain(obj1.id);
      expect(objectIds).toContain(obj2.id);
      expect(objectIds).toContain(obj3.id);
    });

    it('should return object IDs sorted by added_at DESC', async () => {
      const obj1 = await core.create(createTestObject());
      const obj2 = await core.create(createTestObject());
      const obj3 = await core.create(createTestObject());
      const notebookId = 'notebook-sorted';
      createTestNotebook(testDb, notebookId);

      // Add with explicit timestamps using SQL to ensure different values
      const stmt = testDb.prepare(`
        INSERT INTO notebook_objects (notebook_id, object_id, added_at) 
        VALUES (?, ?, ?)
      `);
      
      stmt.run(notebookId, obj1.id, '2023-01-01T10:00:00.000Z');
      stmt.run(notebookId, obj2.id, '2023-01-01T10:00:01.000Z');
      stmt.run(notebookId, obj3.id, '2023-01-01T10:00:02.000Z');

      const objectIds = association.getObjectIdsForNotebook(notebookId);
      
      // Most recent first
      expect(objectIds[0]).toBe(obj3.id);
      expect(objectIds[1]).toBe(obj2.id);
      expect(objectIds[2]).toBe(obj1.id);
    });

    it('should handle non-existent notebook ID', () => {
      const objectIds = association.getObjectIdsForNotebook('non-existent-notebook');
      expect(objectIds).toEqual([]);
    });
  });

  describe('hasAssociation', () => {
    it('should return true for existing association', async () => {
      const obj = await core.create(createTestObject());
      const notebookId = 'notebook-has';
      createTestNotebook(testDb, notebookId);

      await association.addToNotebook(obj.id, notebookId);

      const hasAssoc = association.hasAssociation(obj.id, notebookId);
      expect(hasAssoc).toBe(true);
    });

    it('should return false for non-existent association', async () => {
      const obj = await core.create(createTestObject());
      const notebookId = 'notebook-no-assoc';
      createTestNotebook(testDb, notebookId);

      const hasAssoc = association.hasAssociation(obj.id, notebookId);
      expect(hasAssoc).toBe(false);
    });

    it('should return false for non-existent object', () => {
      const notebookId = 'some-notebook';
      createTestNotebook(testDb, notebookId);

      const hasAssoc = association.hasAssociation('non-existent-object', notebookId);
      expect(hasAssoc).toBe(false);
    });

    it('should return false for non-existent notebook', async () => {
      const obj = await core.create(createTestObject());

      const hasAssoc = association.hasAssociation(obj.id, 'non-existent-notebook');
      expect(hasAssoc).toBe(false);
    });
  });

  describe('getAddedAt', () => {
    it('should return timestamp for existing association', async () => {
      const obj = await core.create(createTestObject());
      const notebookId = 'notebook-timestamp-test';
      createTestNotebook(testDb, notebookId);

      await association.addToNotebook(obj.id, notebookId);

      const addedAt = association.getAddedAt(obj.id, notebookId);
      expect(addedAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent association', async () => {
      const obj = await core.create(createTestObject());
      const notebookId = 'notebook-no-timestamp';
      createTestNotebook(testDb, notebookId);

      const addedAt = association.getAddedAt(obj.id, notebookId);
      expect(addedAt).toBeNull();
    });
  });

  describe('removeAllAssociationsForObject', () => {
    it('should remove all notebook associations for an object', async () => {
      const obj = await core.create(createTestObject());
      const notebook1 = 'notebook-bulk-1';
      const notebook2 = 'notebook-bulk-2';
      const notebook3 = 'notebook-bulk-3';
      
      createTestNotebook(testDb, notebook1);
      createTestNotebook(testDb, notebook2);
      createTestNotebook(testDb, notebook3);

      await association.addToNotebook(obj.id, notebook1);
      await association.addToNotebook(obj.id, notebook2);
      await association.addToNotebook(obj.id, notebook3);

      const removed = association.removeAllAssociationsForObject(obj.id);

      expect(removed).toBe(3);
      expect(association.getNotebookIdsForObject(obj.id)).toHaveLength(0);
    });

    it('should return 0 for object with no associations', async () => {
      const obj = await core.create(createTestObject());

      const removed = association.removeAllAssociationsForObject(obj.id);

      expect(removed).toBe(0);
    });

    it('should only remove associations for specified object', async () => {
      const obj1 = await core.create(createTestObject());
      const obj2 = await core.create(createTestObject());
      const notebookId = 'shared-notebook';
      createTestNotebook(testDb, notebookId);

      await association.addToNotebook(obj1.id, notebookId);
      await association.addToNotebook(obj2.id, notebookId);

      association.removeAllAssociationsForObject(obj1.id);

      expect(association.getNotebookIdsForObject(obj1.id)).toHaveLength(0);
      expect(association.getNotebookIdsForObject(obj2.id)).toHaveLength(1);
    });
  });

  describe('removeAllAssociationsForNotebook', () => {
    it('should remove all object associations for a notebook', async () => {
      const obj1 = await core.create(createTestObject());
      const obj2 = await core.create(createTestObject());
      const obj3 = await core.create(createTestObject());
      const notebookId = 'notebook-bulk-remove';
      createTestNotebook(testDb, notebookId);

      await association.addToNotebook(obj1.id, notebookId);
      await association.addToNotebook(obj2.id, notebookId);
      await association.addToNotebook(obj3.id, notebookId);

      const removed = association.removeAllAssociationsForNotebook(notebookId);

      expect(removed).toBe(3);
      expect(association.getObjectIdsForNotebook(notebookId)).toHaveLength(0);
    });

    it('should return 0 for notebook with no associations', () => {
      const notebookId = 'empty-notebook-remove';
      createTestNotebook(testDb, notebookId);

      const removed = association.removeAllAssociationsForNotebook(notebookId);

      expect(removed).toBe(0);
    });

    it('should only remove associations for specified notebook', async () => {
      const obj = await core.create(createTestObject());
      const notebook1 = 'notebook-keep-assoc';
      const notebook2 = 'notebook-remove-assoc';
      
      createTestNotebook(testDb, notebook1);
      createTestNotebook(testDb, notebook2);

      await association.addToNotebook(obj.id, notebook1);
      await association.addToNotebook(obj.id, notebook2);

      association.removeAllAssociationsForNotebook(notebook2);

      expect(association.getNotebookIdsForObject(obj.id)).toHaveLength(1);
      expect(association.getNotebookIdsForObject(obj.id)[0]).toBe(notebook1);
    });
  });

  describe('foreign key constraints', () => {
    it('should fail when adding non-existent object', async () => {
      const notebookId = 'notebook-fk-test';
      createTestNotebook(testDb, notebookId);

      await expect(association.addToNotebook('non-existent-object', notebookId))
        .rejects.toThrow();
    });
  });
});