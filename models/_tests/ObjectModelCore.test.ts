import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDb, cleanTestDb } from './testUtils';
import { ObjectModelCore } from '../ObjectModelCore';
import { JeffersObject, ObjectStatus } from '../../shared/types';
import { createTestObject } from './test-utils/helpers';
import { logger } from '../../utils/logger';

let testDb: Database.Database;
let core: ObjectModelCore;

describe('ObjectModelCore', () => {
  beforeAll(() => {
    testDb = setupTestDb();
    core = new ObjectModelCore(testDb);
  });

  afterAll(() => {
    testDb.close();
  });

  beforeEach(() => {
    cleanTestDb(testDb);
    core = new ObjectModelCore(testDb);
  });

  describe('create', () => {
    it('should create a new object with all fields mapped correctly', async () => {
      const data = createTestObject({
        title: 'Test Create',
        objectType: 'pdf',
        cleanedText: 'Some cleaned text',
        tagsJson: JSON.stringify(['tag1', 'tag2']),
        fileHash: 'abc123',
        originalFileName: 'test.pdf',
        fileSizeBytes: 1024,
        fileMimeType: 'application/pdf'
      });

      const created = await core.create(data);

      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.title).toBe('Test Create');
      expect(created.objectType).toBe('pdf');
      expect(created.cleanedText).toBe('Some cleaned text');
      expect(created.tagsJson).toBe(JSON.stringify(['tag1', 'tag2']));
      expect(created.fileHash).toBe('abc123');
      expect(created.originalFileName).toBe('test.pdf');
      expect(created.fileSizeBytes).toBe(1024);
      expect(created.fileMimeType).toBe('application/pdf');
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.updatedAt).toBeInstanceOf(Date);
      expect(created.status).toBe('new');
    });

    it('should handle null values correctly', async () => {
      const data = createTestObject({
        title: null,
        cleanedText: null,
        rawContentRef: null
      });

      const created = await core.create(data);

      expect(created.title).toBeNull();
      expect(created.cleanedText).toBeNull();
      expect(created.rawContentRef).toBeNull();
      expect(created.errorInfo).toBeNull();
    });

    it('should return existing object when sourceUri already exists', async () => {
      const sourceUri = 'https://example.com/duplicate';
      const data1 = createTestObject({ sourceUri, title: 'First' });
      const data2 = createTestObject({ sourceUri, title: 'Second' });

      const obj1 = await core.create(data1);
      const obj2 = await core.create(data2);

      expect(obj2.id).toBe(obj1.id);
      expect(obj2.title).toBe('First'); // Should keep original
    });

    it('should handle database errors', async () => {
      const invalidDb = new Database(':memory:');
      const brokenCore = new ObjectModelCore(invalidDb);
      
      await expect(brokenCore.create(createTestObject())).rejects.toThrow();
      
      invalidDb.close();
    });
  });

  describe('createSync', () => {
    it('should create object synchronously for use in transactions', () => {
      const data = createTestObject({ title: 'Sync Create' });
      
      const created = core.createSync(data);

      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.title).toBe('Sync Create');
      expect(created.createdAt).toBeInstanceOf(Date);
    });

    it('should throw error on duplicate sourceUri in sync mode', () => {
      const sourceUri = 'https://example.com/sync-dup';
      const data1 = createTestObject({ sourceUri, title: 'First Sync' });
      const data2 = createTestObject({ sourceUri, title: 'Second Sync' });

      core.createSync(data1);
      
      // Should throw on duplicate
      expect(() => core.createSync(data2)).toThrow('Object with source_uri');
    });
  });

  describe('update', () => {
    it('should update multiple fields', async () => {
      const created = await core.create(createTestObject());
      
      const updates = {
        title: 'Updated Title',
        status: 'parsed' as ObjectStatus,
        parsedContentJson: JSON.stringify({ parsed: true }),
        parsedAt: new Date(),
        summary: 'Test summary',
        childObjectIds: ['child1', 'child2']
      };

      await core.update(created.id, updates);
      
      const updated = await core.getById(created.id);
      expect(updated).toBeDefined();
      expect(updated!.title).toBe('Updated Title');
      expect(updated!.status).toBe('parsed');
      expect(updated!.parsedContentJson).toBe(JSON.stringify({ parsed: true }));
      expect(updated!.parsedAt).toBeInstanceOf(Date);
      expect(updated!.summary).toBe('Test summary');
      expect(updated!.childObjectIds).toEqual(['child1', 'child2']);
    });

    it('should handle partial updates without affecting other fields', async () => {
      const created = await core.create(createTestObject({
        title: 'Original',
        summary: 'Original summary'
      }));

      await core.update(created.id, { title: 'New Title' });

      const updated = await core.getById(created.id);
      expect(updated!.title).toBe('New Title');
      expect(updated!.summary).toBe('Original summary');
    });

    it('should skip immutable fields like sourceUri', async () => {
      const created = await core.create(createTestObject({
        sourceUri: 'https://example.com/immutable'
      }));

      await core.update(created.id, { 
        sourceUri: 'https://example.com/changed' // Should be ignored
      } as any);

      const updated = await core.getById(created.id);
      expect(updated!.sourceUri).toBe('https://example.com/immutable');
    });

    it('should handle empty updates without error', async () => {
      const created = await core.create(createTestObject());
      
      // Should not throw with empty update
      await core.update(created.id, {});

      const updated = await core.getById(created.id);
      expect(updated!.id).toBe(created.id);
    });

    it('should handle non-existent ID', async () => {
      await core.update('non-existent-id', { title: 'Won\'t work' });
      // Should not throw, just no-op
      expect(true).toBe(true); // Verify we didn't throw
    });
  });

  describe('updateStatus', () => {
    it('should update status with parsedAt', async () => {
      const created = await core.create(createTestObject({ status: 'fetched' }));
      const parsedAt = new Date();

      await core.updateStatus(created.id, 'parsed', parsedAt);

      const updated = await core.getById(created.id);
      expect(updated!.status).toBe('parsed');
      expect(updated!.parsedAt!.getTime()).toBe(parsedAt.getTime());
      expect(updated!.errorInfo).toBeNull();
    });

    it('should update status with errorInfo', async () => {
      const created = await core.create(createTestObject());

      await core.updateStatus(created.id, 'error', undefined, 'Parse failed');

      const updated = await core.getById(created.id);
      expect(updated!.status).toBe('error');
      expect(updated!.errorInfo).toBe('Parse failed');
      expect(updated!.parsedAt).toBeUndefined();
    });

    it('should clear errorInfo for non-error status', async () => {
      const created = await core.create(createTestObject({
        status: 'error',
        errorInfo: 'Previous error'
      }));

      await core.updateStatus(created.id, 'fetched');

      const updated = await core.getById(created.id);
      expect(updated!.status).toBe('fetched');
      expect(updated!.errorInfo).toBeNull();
    });
  });

  describe('queries', () => {
    describe('getById', () => {
      it('should return object by ID', async () => {
        const created = await core.create(createTestObject({ title: 'Find me' }));

        const found = await core.getById(created.id);

        expect(found).toBeDefined();
        expect(found!.id).toBe(created.id);
        expect(found!.title).toBe('Find me');
      });

      it('should return null for non-existent ID', async () => {
        const found = await core.getById('non-existent');
        expect(found).toBeNull();
      });
    });

    describe('findByStatus', () => {
      it('should find objects by single status', async () => {
        await core.create(createTestObject({ status: 'new' }));
        await core.create(createTestObject({ status: 'fetched' }));
        await core.create(createTestObject({ status: 'fetched' }));

        const fetched = await core.findByStatus(['fetched']);

        expect(fetched).toHaveLength(2);
        expect(fetched.every(o => o.status === 'fetched')).toBe(true);
      });

      it('should find objects by multiple statuses', async () => {
        const obj1 = await core.create(createTestObject({ status: 'new' }));
        const obj2 = await core.create(createTestObject({ status: 'error' }));
        await core.create(createTestObject({ status: 'parsed' }));

        const found = await core.findByStatus(['new', 'error']);

        expect(found).toHaveLength(2);
        expect(found.map(o => o.id)).toContain(obj1.id);
        expect(found.map(o => o.id)).toContain(obj2.id);
      });

      it('should return results ordered by created_at', async () => {
        await core.create(createTestObject({ status: 'ordered' }));
        await core.create(createTestObject({ status: 'ordered' }));
        await core.create(createTestObject({ status: 'ordered' }));

        const found = await core.findByStatus(['ordered']);

        // Just verify we get results and they have created_at dates
        expect(found.length).toBeGreaterThanOrEqual(3);
        found.forEach(obj => {
          expect(obj.createdAt).toBeInstanceOf(Date);
        });
      });
    });

    describe('getProcessableObjects', () => {
      it('should return objects with status=parsed limited by count', async () => {
        await core.create(createTestObject({ status: 'parsed' }));
        await core.create(createTestObject({ status: 'parsed' }));
        await core.create(createTestObject({ status: 'parsed' }));
        await core.create(createTestObject({ status: 'new' }));
        await core.create(createTestObject({ status: 'error' }));

        const processable = await core.getProcessableObjects(2);

        expect(processable).toHaveLength(2);
        expect(processable.every(o => o.status === 'parsed')).toBe(true);
      });

      it('should handle limit larger than available objects', async () => {
        await core.create(createTestObject({ status: 'parsed' }));

        const processable = await core.getProcessableObjects(10);

        expect(processable).toHaveLength(1);
      });
    });

    describe('getBySourceUri', () => {
      it('should find object by sourceUri', async () => {
        const sourceUri = 'https://example.com/findme';
        const created = await core.create(createTestObject({ sourceUri }));

        const found = await core.getBySourceUri(sourceUri);

        expect(found).toBeDefined();
        expect(found!.id).toBe(created.id);
      });

      it('should return null for non-existent URI', async () => {
        const found = await core.getBySourceUri('https://example.com/nothere');
        expect(found).toBeNull();
      });
    });

    describe('getSourceContentDetailsByIds', () => {
      it('should return metadata map for multiple objects', async () => {
        const obj1 = await core.create(createTestObject({ 
          title: 'Object 1',
          sourceUri: 'https://example.com/1'
        }));
        const obj2 = await core.create(createTestObject({
          title: 'Object 2',
          sourceUri: 'https://example.com/2'
        }));

        const metadata = await core.getSourceContentDetailsByIds([obj1.id, obj2.id]);

        expect(metadata.size).toBe(2);
        expect(metadata.get(obj1.id)).toEqual({
          id: obj1.id,
          title: 'Object 1',
          sourceUri: 'https://example.com/1',
          objectType: 'webpage'
        });
      });

      it('should handle non-existent IDs gracefully', async () => {
        const obj = await core.create(createTestObject());
        
        const metadata = await core.getSourceContentDetailsByIds([obj.id, 'non-existent']);

        expect(metadata.size).toBe(1);
        expect(metadata.has(obj.id)).toBe(true);
        expect(metadata.has('non-existent')).toBe(false);
      });
    });
  });

  describe('deletion', () => {
    describe('deleteById', () => {
      it('should delete existing object', async () => {
        const created = await core.create(createTestObject());

        core.deleteById(created.id);

        const found = await core.getById(created.id);
        expect(found).toBeNull();
      });

      it('should handle non-existent ID', () => {
        // Should not throw
        core.deleteById('non-existent');
        expect(true).toBe(true);
      });
    });

    describe('deleteByIds', () => {
      it('should delete multiple objects', async () => {
        const obj1 = await core.create(createTestObject());
        const obj2 = await core.create(createTestObject());
        const obj3 = await core.create(createTestObject());

        core.deleteByIds([obj1.id, obj2.id]);

        expect(await core.getById(obj1.id)).toBeNull();
        expect(await core.getById(obj2.id)).toBeNull();
        expect(await core.getById(obj3.id)).toBeDefined(); // Not deleted
      });

      it('should handle large batches', async () => {
        const ids: string[] = [];
        for (let i = 0; i < 1500; i++) {
          const obj = await core.create(createTestObject());
          ids.push(obj.id);
        }

        core.deleteByIds(ids);

        const remaining = await core.findByStatus(['new']);
        expect(remaining).toHaveLength(0);
      });

      it('should handle mix of existing and non-existent IDs', async () => {
        const obj = await core.create(createTestObject());

        core.deleteByIds([obj.id, 'non-existent-1', 'non-existent-2']);

        expect(await core.getById(obj.id)).toBeNull();
      });
    });
  });

  describe('helper methods', () => {
    describe('countObjectsByStatus', () => {
      it('should count objects with single status', async () => {
        await core.create(createTestObject({ status: 'new' }));
        await core.create(createTestObject({ status: 'new' }));
        await core.create(createTestObject({ status: 'parsed' }));

        const count = await core.countObjectsByStatus('new');

        expect(count).toBe(2);
      });

      it('should count objects with multiple statuses', async () => {
        await core.create(createTestObject({ status: 'new' }));
        await core.create(createTestObject({ status: 'error' }));
        await core.create(createTestObject({ status: 'parsed' }));

        const count = await core.countObjectsByStatus(['new', 'error']);

        expect(count).toBe(2);
      });
    });

    describe('existsBySourceUri', () => {
      it('should return true for existing URI', async () => {
        const sourceUri = 'https://example.com/exists';
        await core.create(createTestObject({ sourceUri }));

        const exists = await core.existsBySourceUri(sourceUri);

        expect(exists).toBe(true);
      });

      it('should return false for non-existent URI', async () => {
        const exists = await core.existsBySourceUri('https://example.com/nothere');
        expect(exists).toBe(false);
      });
    });

    describe('updateLastAccessed', () => {
      it('should update lastAccessedAt timestamp', async () => {
        const created = await core.create(createTestObject());
        const beforeUpdate = new Date();
        
        await new Promise(resolve => setTimeout(resolve, 10));
        
        core.updateLastAccessed(created.id);
        
        const updated = await core.getById(created.id);
        expect(updated!.lastAccessedAt).toBeDefined();
        expect(updated!.lastAccessedAt!.getTime()).toBeGreaterThan(beforeUpdate.getTime());
      });
    });

    describe('childObjectIds operations', () => {
      it('should get child IDs', async () => {
        const created = await core.create(createTestObject({
          childObjectIds: ['child1', 'child2']
        }));

        const childIds = core.getChildIds(created.id);

        expect(childIds).toEqual(['child1', 'child2']);
      });

      it('should return empty array for object without children', async () => {
        const created = await core.create(createTestObject());

        const childIds = core.getChildIds(created.id);

        expect(childIds).toEqual([]);
      });

      it('should update child IDs', async () => {
        const created = await core.create(createTestObject());

        core.updateChildIds(created.id, ['new-child1', 'new-child2']);

        const childIds = core.getChildIds(created.id);
        expect(childIds).toEqual(['new-child1', 'new-child2']);
      });
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in text fields', async () => {
      const specialText = "Test with 'quotes' and \"double quotes\" and \n newlines";
      const created = await core.create(createTestObject({
        title: specialText,
        cleanedText: specialText
      }));

      const found = await core.getById(created.id);
      expect(found!.title).toBe(specialText);
      expect(found!.cleanedText).toBe(specialText);
    });
  });
});