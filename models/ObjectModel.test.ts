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
            // Reset sequence for autoincrement IDs if needed (not strictly necessary for objects)
        } catch (error) {
            console.error('Failed to clean test database tables:', error);
            // Decide if tests should stop if cleanup fails
        }
    });

    // --- Test Cases ---

    it('should create a new object successfully', async () => {
        const data = {
            objectType: 'bookmark',
            sourceUri: 'https://example.com/test1',
            title: 'Test Bookmark 1',
            rawContentRef: null,
        };
        // We need to tell TS that objectModel methods are async, even if they don't use await internally
        // because they return Promise<...> in the class definition
        const createdObject = await testObjectModel.create(data);

        expect(createdObject).toBeDefined();
        expect(createdObject.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format check
        expect(createdObject.objectType).toBe(data.objectType);
        expect(createdObject.sourceUri).toBe(data.sourceUri);
        expect(createdObject.title).toBe(data.title);
        expect(createdObject.status).toBe('new'); // Default status
        expect(createdObject.createdAt).toBeInstanceOf(Date);
        expect(createdObject.updatedAt).toBeInstanceOf(Date);
    });

    it('should return the existing object when creating with a duplicate source_uri', async () => {
        const data1 = { objectType: 'bookmark', sourceUri: 'https://example.com/duplicate', title: 'Duplicate 1', rawContentRef: null };
        const firstObject = await testObjectModel.create(data1);

        const data2 = { objectType: 'note', sourceUri: 'https://example.com/duplicate', title: 'Duplicate 2', rawContentRef: null };
        const secondObject = await testObjectModel.create(data2); // Attempt duplicate

        expect(secondObject).toBeDefined();
        expect(secondObject.id).toBe(firstObject.id); // Should return the *first* object's ID
        expect(secondObject.title).toBe(firstObject.title); // Should have the first object's title
        expect(secondObject.objectType).toBe(firstObject.objectType); // Should have the first object's type
    });


    it('should get an object by ID', async () => {
        const created = await testObjectModel.create({ objectType: 'note', sourceUri: 'https://example.com/getById', title: null, rawContentRef: null });
        const fetched = await testObjectModel.getById(created.id);

        expect(fetched).not.toBeNull();
        expect(fetched?.id).toBe(created.id);
        expect(fetched?.sourceUri).toBe(created.sourceUri);
    });

    it('should return null when getting a non-existent object by ID', async () => {
        const nonExistentId = '00000000-0000-0000-0000-000000000000';
        const fetched = await testObjectModel.getById(nonExistentId);
        expect(fetched).toBeNull();
    });

    it('should get an object by source URI', async () => {
        const uri = 'https://example.com/getByUri';
        const created = await testObjectModel.create({ objectType: 'bookmark', sourceUri: uri, title: null, rawContentRef: null });
        const fetched = await testObjectModel.getBySourceUri(uri);

        expect(fetched).not.toBeNull();
        expect(fetched?.id).toBe(created.id);
        expect(fetched?.sourceUri).toBe(uri);
    });

     it('should return null when getting by non-existent source URI', async () => {
        const fetched = await testObjectModel.getBySourceUri('https://example.com/not-here');
        expect(fetched).toBeNull();
    });

    it('should update the status of an object', async () => {
        const created = await testObjectModel.create({ objectType: 'test', sourceUri: 'https://example.com/updateStatus', title: null, rawContentRef: null });
        expect(created.status).toBe('new');

        const newStatus: ObjectStatus = 'parsed';
        const parsedAt = new Date();
        await testObjectModel.updateStatus(created.id, newStatus, parsedAt);

        const updated = await testObjectModel.getById(created.id);
        expect(updated).not.toBeNull();
        expect(updated?.status).toBe(newStatus);
        // Compare time ignoring milliseconds for potential slight differences
        expect(updated?.parsedAt?.toISOString().slice(0, -4)).toBe(parsedAt.toISOString().slice(0, -4));
        // Check if updated_at changed - need to compare date objects properly
        expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });

    it('should get processable objects (status = parsed)', async () => {
        await testObjectModel.create({ objectType: 'p1', sourceUri: 'https://p1', status: 'parsed', title: null, rawContentRef: null });
        await testObjectModel.create({ objectType: 'p2', sourceUri: 'https://p2', status: 'parsed', title: null, rawContentRef: null });
        await testObjectModel.create({ objectType: 'n1', sourceUri: 'https://n1', status: 'new', title: null, rawContentRef: null });
        await testObjectModel.create({ objectType: 'e1', sourceUri: 'https://e1', status: 'embedded', title: null, rawContentRef: null });

        const processable = await testObjectModel.getProcessableObjects(5);

        expect(processable).toHaveLength(2);
        expect(processable.map(o => o.objectType)).toContain('p1');
        expect(processable.map(o => o.objectType)).toContain('p2');
        expect(processable.every(o => o.status === 'parsed')).toBe(true);
    });

    it('should delete an object by ID', async () => {
        const created = await testObjectModel.create({ objectType: 'delete', sourceUri: 'https://delete.me', title: null, rawContentRef: null });
        let fetched = await testObjectModel.getById(created.id);
        expect(fetched).not.toBeNull();

        await testObjectModel.deleteById(created.id);

        fetched = await testObjectModel.getById(created.id);
        expect(fetched).toBeNull();
    });

}); 