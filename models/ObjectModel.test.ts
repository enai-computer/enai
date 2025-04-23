import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from './db'; // Import the refined initDb
import runMigrations from './runMigrations'; // Import the refined runMigrations
import { ObjectModel } from './ObjectModel'; // Import the CLASS
import { JeffersObject, ObjectStatus } from '../shared/types';

// Hold the test database instance
let testDb: Database.Database;
// Hold the test model instance
let testObjectModel: ObjectModel;

// Sample data for testing
const sampleData1: Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'> = {
    objectType: 'bookmark',
    sourceUri: 'https://example.com/test1',
    title: 'Test Bookmark 1',
    status: 'new',
    rawContentRef: null,
    parsedContentJson: null,
    errorInfo: null,
};

const sampleData2: Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'> = {
    objectType: 'note',
    sourceUri: 'https://example.com/note1',
    title: 'Test Note 1',
    status: 'new',
    rawContentRef: 'local/ref',
    parsedContentJson: null,
    errorInfo: null,
};

describe('ObjectModel Integration Tests', () => {
    // Setup: Create in-memory DB and run migrations before all tests
    beforeAll(() => {
        try {
            testDb = initDb(':memory:'); // Initialize in-memory DB
            runMigrations(testDb); // Run migrations on the test DB
            testObjectModel = new ObjectModel(testDb); // Instantiate model with test DB
            console.log('Test DB initialized and migrations run.');
        } catch (error) {
            console.error('Failed to initialize test database:', error);
            throw error; // Prevent tests from running if setup fails
        }
    });

    // Teardown: Close DB connection after all tests
    afterAll(() => {
        if (testDb && testDb.open) {
            testDb.close();
            console.log('Test DB closed.');
        }
    });

    // Cleanup: Delete all data before each test for isolation
    beforeEach(() => {
        try {
            testDb.exec('DELETE FROM embeddings;');
            testDb.exec('DELETE FROM chunks;');
            testDb.exec('DELETE FROM objects;');
        } catch (error) {
            console.error('Failed to clean test database tables:', error);
        }
    });

    // --- Test Cases ---

    it('should create a new object successfully with default status', async () => {
        // Create without explicitly setting status
        const data = { ...sampleData1 };
        // @ts-expect-error - Testing default status assignment
        delete data.status; 
        const createdObject = await testObjectModel.create(data);

        expect(createdObject).toBeDefined();
        expect(createdObject.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(createdObject.objectType).toBe(data.objectType);
        expect(createdObject.sourceUri).toBe(data.sourceUri);
        expect(createdObject.title).toBe(data.title);
        expect(createdObject.status).toBe('new'); // Should default to 'new'
        expect(createdObject.parsedContentJson).toBeNull();
        expect(createdObject.errorInfo).toBeNull();
        expect(createdObject.createdAt).toBeInstanceOf(Date);
        expect(createdObject.updatedAt).toBeInstanceOf(Date);
    });

    it('should create a new object successfully with provided status', async () => {
        const data = { ...sampleData2, status: 'fetched' as ObjectStatus };
        const createdObject = await testObjectModel.create(data);

        expect(createdObject.status).toBe('fetched');
        expect(createdObject.rawContentRef).toBe(data.rawContentRef);
    });

    it('should return the existing object when creating with a duplicate source_uri', async () => {
        const data1 = { ...sampleData1, sourceUri: 'https://example.com/duplicate' };
        const firstObject = await testObjectModel.create(data1);

        const data2 = { ...sampleData2, sourceUri: 'https://example.com/duplicate' }; // Different type, same URI
        const secondObject = await testObjectModel.create(data2); // Attempt duplicate

        expect(secondObject).toBeDefined();
        expect(secondObject.id).toBe(firstObject.id); // Should return the *first* object's ID
        expect(secondObject.title).toBe(firstObject.title);
        expect(secondObject.objectType).toBe(firstObject.objectType);
    });

    it('should get an object by ID', async () => {
        const created = await testObjectModel.create({ ...sampleData1, title: 'Get By ID Test' });
        const fetched = await testObjectModel.getById(created.id);

        expect(fetched).not.toBeNull();
        expect(fetched?.id).toBe(created.id);
        expect(fetched?.sourceUri).toBe(created.sourceUri);
        expect(fetched?.title).toBe('Get By ID Test');
        expect(fetched?.parsedContentJson).toBeNull();
        expect(fetched?.errorInfo).toBeNull();
    });

    it('should return null when getting a non-existent object by ID', async () => {
        const nonExistentId = '00000000-0000-0000-0000-000000000000';
        const fetched = await testObjectModel.getById(nonExistentId);
        expect(fetched).toBeNull();
    });

    it('should get an object by source URI', async () => {
        const uri = 'https://example.com/getByUri';
        const created = await testObjectModel.create({ ...sampleData2, sourceUri: uri });
        const fetched = await testObjectModel.getBySourceUri(uri);

        expect(fetched).not.toBeNull();
        expect(fetched?.id).toBe(created.id);
        expect(fetched?.sourceUri).toBe(uri);
    });

     it('should return null when getting by non-existent source URI', async () => {
        const fetched = await testObjectModel.getBySourceUri('https://example.com/not-here');
        expect(fetched).toBeNull();
    });

    it('should update status and parsedAt using updateStatus', async () => {
        const created = await testObjectModel.create({ ...sampleData1, status: 'fetched' });
        expect(created.status).toBe('fetched');

        const newStatus: ObjectStatus = 'parsed';
        const parsedAt = new Date();
        await testObjectModel.updateStatus(created.id, newStatus, parsedAt);

        const updated = await testObjectModel.getById(created.id);
        expect(updated).not.toBeNull();
        expect(updated?.status).toBe(newStatus);
        // Compare time ignoring milliseconds for potential slight differences
        expect(updated?.parsedAt?.toISOString().slice(0, -4)).toBe(parsedAt.toISOString().slice(0, -4));
        expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
        expect(updated?.errorInfo).toBeNull(); // Should clear error info
    });

    it('should update status and set errorInfo using updateStatus', async () => {
        const created = await testObjectModel.create(sampleData1);
        const newStatus: ObjectStatus = 'error';
        const errorMsg = 'Fetch failed: 404';
        await testObjectModel.updateStatus(created.id, newStatus, undefined, errorMsg);

        const updated = await testObjectModel.getById(created.id);
        expect(updated?.status).toBe(newStatus);
        expect(updated?.errorInfo).toBe(errorMsg);
        expect(updated?.parsedAt).toBeUndefined();
    });

    it('should clear errorInfo when updating status to non-error using updateStatus', async () => {
        const created = await testObjectModel.create({ ...sampleData1, status: 'error', errorInfo: 'Previous error' });
        expect(created.errorInfo).toBe('Previous error');

        await testObjectModel.updateStatus(created.id, 'fetched');

        const updated = await testObjectModel.getById(created.id);
        expect(updated?.status).toBe('fetched');
        expect(updated?.errorInfo).toBeNull(); // Error info should be cleared
    });

    it('should update multiple fields using the update method', async () => {
        const created = await testObjectModel.create(sampleData1);
        const updates = {
            title: 'Updated Title',
            status: 'parsed' as ObjectStatus,
            parsedContentJson: '{"title": "Parsed"}',
            parsedAt: new Date(),
        };

        await testObjectModel.update(created.id, updates);
        const updated = await testObjectModel.getById(created.id);

        expect(updated?.title).toBe(updates.title);
        expect(updated?.status).toBe(updates.status);
        expect(updated?.parsedContentJson).toBe(updates.parsedContentJson);
        expect(updated?.parsedAt?.toISOString().slice(0, -4)).toBe(updates.parsedAt.toISOString().slice(0, -4));
        expect(updated?.errorInfo).toBeNull(); // Not updated, should remain null
        expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });

    it('should update only errorInfo using the update method', async () => {
        const created = await testObjectModel.create(sampleData1);
        const updates = {
            status: 'error' as ObjectStatus,
            errorInfo: 'Specific update error',
        };
        await testObjectModel.update(created.id, updates);
        const updated = await testObjectModel.getById(created.id);

        expect(updated?.status).toBe('error');
        expect(updated?.errorInfo).toBe(updates.errorInfo);
        expect(updated?.title).toBe(sampleData1.title); // Title should be unchanged
    });

    it('should find objects by a single status using findByStatus', async () => {
        const o1 = await testObjectModel.create({ ...sampleData1, status: 'fetched' });
        const o2 = await testObjectModel.create({ ...sampleData2, status: 'fetched' });
        await testObjectModel.create({ ...sampleData1, sourceUri: 'uri3', status: 'new' });

        const fetched = await testObjectModel.findByStatus(['fetched']);

        expect(fetched).toHaveLength(2);
        expect(fetched.map(o => o.id)).toEqual(expect.arrayContaining([o1.id, o2.id]));
        expect(fetched.map(o => o.source_uri)).toEqual(expect.arrayContaining([o1.sourceUri, o2.sourceUri]));
    });

    it('should find objects by multiple statuses using findByStatus', async () => {
        const o1 = await testObjectModel.create({ ...sampleData1, status: 'new' });
        const o2 = await testObjectModel.create({ ...sampleData2, status: 'error', errorInfo: 'err' });
        await testObjectModel.create({ ...sampleData1, sourceUri: 'uri3', status: 'parsed' });

        const fetched = await testObjectModel.findByStatus(['new', 'error']);

        expect(fetched).toHaveLength(2);
        expect(fetched.map(o => o.id)).toEqual(expect.arrayContaining([o1.id, o2.id]));
    });

     it('should return empty array from findByStatus if no matches', async () => {
        await testObjectModel.create({ ...sampleData1, status: 'new' });
        const fetched = await testObjectModel.findByStatus(['parsed', 'embedded']);
        expect(fetched).toHaveLength(0);
    });

    it('should get processable objects (status = parsed)', async () => {
        const parsed1 = await testObjectModel.create({ ...sampleData1, sourceUri: 'p1', status: 'parsed', parsedContentJson: '{"a": 1}' });
        const parsed2 = await testObjectModel.create({ ...sampleData2, sourceUri: 'p2', status: 'parsed' });
        await testObjectModel.create({ ...sampleData1, sourceUri: 'n1', status: 'new' });
        await testObjectModel.create({ ...sampleData2, sourceUri: 'e1', status: 'embedded' });

        const processable = await testObjectModel.getProcessableObjects(5);

        expect(processable).toHaveLength(2);
        expect(processable.map(o => o.sourceUri)).toEqual(expect.arrayContaining(['p1', 'p2']));
        expect(processable.every(o => o.status === 'parsed')).toBe(true);
        // Check if parsedContentJson is retrieved
        const p1 = processable.find(o => o.sourceUri === 'p1');
        expect(p1?.parsedContentJson).toBe('{"a": 1}');
    });

    it('should delete an object by ID', async () => {
        const created = await testObjectModel.create({ ...sampleData1, sourceUri: 'https://delete.me' });
        let fetched = await testObjectModel.getById(created.id);
        expect(fetched).not.toBeNull();

        await testObjectModel.deleteById(created.id);

        fetched = await testObjectModel.getById(created.id);
        expect(fetched).toBeNull();
    });

}); 