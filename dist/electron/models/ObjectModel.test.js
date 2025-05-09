"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const db_1 = require("./db"); // Import the refined initDb
const runMigrations_1 = __importDefault(require("./runMigrations")); // Import the refined runMigrations
const ObjectModel_1 = require("./ObjectModel"); // Import the CLASS
// Hold the test database instance
let testDb;
// Hold the test model instance
let testObjectModel;
// Sample data for testing
const sampleData1 = {
    objectType: 'bookmark',
    sourceUri: 'https://example.com/test1',
    title: 'Test Bookmark 1',
    status: 'new',
    rawContentRef: null,
    parsedContentJson: null,
    errorInfo: null,
};
const sampleData2 = {
    objectType: 'note',
    sourceUri: 'https://example.com/note1',
    title: 'Test Note 1',
    status: 'new',
    rawContentRef: 'local/ref',
    parsedContentJson: null,
    errorInfo: null,
};
(0, vitest_1.describe)('ObjectModel Integration Tests', () => {
    // Setup: Create in-memory DB and run migrations before all tests
    (0, vitest_1.beforeAll)(() => {
        try {
            testDb = (0, db_1.initDb)(':memory:'); // Initialize in-memory DB
            (0, runMigrations_1.default)(testDb); // Run migrations on the test DB
            testObjectModel = new ObjectModel_1.ObjectModel(testDb); // Instantiate model with test DB
            console.log('Test DB initialized and migrations run.');
        }
        catch (error) {
            console.error('Failed to initialize test database:', error);
            throw error; // Prevent tests from running if setup fails
        }
    });
    // Teardown: Close DB connection after all tests
    (0, vitest_1.afterAll)(() => {
        if (testDb && testDb.open) {
            testDb.close();
            console.log('Test DB closed.');
        }
    });
    // Cleanup: Delete all data before each test for isolation
    (0, vitest_1.beforeEach)(() => {
        try {
            testDb.exec('DELETE FROM embeddings;');
            testDb.exec('DELETE FROM chunks;');
            testDb.exec('DELETE FROM objects;');
        }
        catch (error) {
            console.error('Failed to clean test database tables:', error);
        }
    });
    // --- Test Cases ---
    (0, vitest_1.it)('should create a new object successfully with default status', async () => {
        // Create without explicitly setting status
        const data = { ...sampleData1 };
        // @ts-expect-error - Testing default status assignment
        delete data.status;
        const createdObject = await testObjectModel.create(data);
        (0, vitest_1.expect)(createdObject).toBeDefined();
        (0, vitest_1.expect)(createdObject.id).toMatch(/^[0-9a-f-]{36}$/);
        (0, vitest_1.expect)(createdObject.objectType).toBe(data.objectType);
        (0, vitest_1.expect)(createdObject.sourceUri).toBe(data.sourceUri);
        (0, vitest_1.expect)(createdObject.title).toBe(data.title);
        (0, vitest_1.expect)(createdObject.status).toBe('new'); // Should default to 'new'
        (0, vitest_1.expect)(createdObject.parsedContentJson).toBeNull();
        (0, vitest_1.expect)(createdObject.errorInfo).toBeNull();
        (0, vitest_1.expect)(createdObject.createdAt).toBeInstanceOf(Date);
        (0, vitest_1.expect)(createdObject.updatedAt).toBeInstanceOf(Date);
    });
    (0, vitest_1.it)('should create a new object successfully with provided status', async () => {
        const data = { ...sampleData2, status: 'fetched' };
        const createdObject = await testObjectModel.create(data);
        (0, vitest_1.expect)(createdObject.status).toBe('fetched');
        (0, vitest_1.expect)(createdObject.rawContentRef).toBe(data.rawContentRef);
    });
    (0, vitest_1.it)('should return the existing object when creating with a duplicate source_uri', async () => {
        const data1 = { ...sampleData1, sourceUri: 'https://example.com/duplicate' };
        const firstObject = await testObjectModel.create(data1);
        const data2 = { ...sampleData2, sourceUri: 'https://example.com/duplicate' }; // Different type, same URI
        const secondObject = await testObjectModel.create(data2); // Attempt duplicate
        (0, vitest_1.expect)(secondObject).toBeDefined();
        (0, vitest_1.expect)(secondObject.id).toBe(firstObject.id); // Should return the *first* object's ID
        (0, vitest_1.expect)(secondObject.title).toBe(firstObject.title);
        (0, vitest_1.expect)(secondObject.objectType).toBe(firstObject.objectType);
    });
    (0, vitest_1.it)('should get an object by ID', async () => {
        const created = await testObjectModel.create({ ...sampleData1, title: 'Get By ID Test' });
        const fetched = await testObjectModel.getById(created.id);
        (0, vitest_1.expect)(fetched).not.toBeNull();
        (0, vitest_1.expect)(fetched?.id).toBe(created.id);
        (0, vitest_1.expect)(fetched?.sourceUri).toBe(created.sourceUri);
        (0, vitest_1.expect)(fetched?.title).toBe('Get By ID Test');
        (0, vitest_1.expect)(fetched?.parsedContentJson).toBeNull();
        (0, vitest_1.expect)(fetched?.errorInfo).toBeNull();
    });
    (0, vitest_1.it)('should return null when getting a non-existent object by ID', async () => {
        const nonExistentId = '00000000-0000-0000-0000-000000000000';
        const fetched = await testObjectModel.getById(nonExistentId);
        (0, vitest_1.expect)(fetched).toBeNull();
    });
    (0, vitest_1.it)('should get an object by source URI', async () => {
        const uri = 'https://example.com/getByUri';
        const created = await testObjectModel.create({ ...sampleData2, sourceUri: uri });
        const fetched = await testObjectModel.getBySourceUri(uri);
        (0, vitest_1.expect)(fetched).not.toBeNull();
        (0, vitest_1.expect)(fetched?.id).toBe(created.id);
        (0, vitest_1.expect)(fetched?.sourceUri).toBe(uri);
    });
    (0, vitest_1.it)('should return null when getting by non-existent source URI', async () => {
        const fetched = await testObjectModel.getBySourceUri('https://example.com/not-here');
        (0, vitest_1.expect)(fetched).toBeNull();
    });
    (0, vitest_1.it)('should update status and parsedAt using updateStatus', async () => {
        const created = await testObjectModel.create({ ...sampleData1, status: 'fetched' });
        (0, vitest_1.expect)(created.status).toBe('fetched');
        const newStatus = 'parsed';
        const parsedAt = new Date();
        await testObjectModel.updateStatus(created.id, newStatus, parsedAt);
        const updated = await testObjectModel.getById(created.id);
        (0, vitest_1.expect)(updated).not.toBeNull();
        (0, vitest_1.expect)(updated?.status).toBe(newStatus);
        // Compare time ignoring milliseconds for potential slight differences
        (0, vitest_1.expect)(updated?.parsedAt?.toISOString().slice(0, -4)).toBe(parsedAt.toISOString().slice(0, -4));
        (0, vitest_1.expect)(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
        (0, vitest_1.expect)(updated?.errorInfo).toBeNull(); // Should clear error info
    });
    (0, vitest_1.it)('should update status and set errorInfo using updateStatus', async () => {
        const created = await testObjectModel.create(sampleData1);
        const newStatus = 'error';
        const errorMsg = 'Fetch failed: 404';
        await testObjectModel.updateStatus(created.id, newStatus, undefined, errorMsg);
        const updated = await testObjectModel.getById(created.id);
        (0, vitest_1.expect)(updated?.status).toBe(newStatus);
        (0, vitest_1.expect)(updated?.errorInfo).toBe(errorMsg);
        (0, vitest_1.expect)(updated?.parsedAt).toBeUndefined();
    });
    (0, vitest_1.it)('should clear errorInfo when updating status to non-error using updateStatus', async () => {
        const created = await testObjectModel.create({ ...sampleData1, status: 'error', errorInfo: 'Previous error' });
        (0, vitest_1.expect)(created.errorInfo).toBe('Previous error');
        await testObjectModel.updateStatus(created.id, 'fetched');
        const updated = await testObjectModel.getById(created.id);
        (0, vitest_1.expect)(updated?.status).toBe('fetched');
        (0, vitest_1.expect)(updated?.errorInfo).toBeNull(); // Error info should be cleared
    });
    (0, vitest_1.it)('should update multiple fields using the update method', async () => {
        const created = await testObjectModel.create(sampleData1);
        const updates = {
            title: 'Updated Title',
            status: 'parsed',
            parsedContentJson: '{"title": "Parsed"}',
            parsedAt: new Date(),
        };
        await testObjectModel.update(created.id, updates);
        const updated = await testObjectModel.getById(created.id);
        (0, vitest_1.expect)(updated?.title).toBe(updates.title);
        (0, vitest_1.expect)(updated?.status).toBe(updates.status);
        (0, vitest_1.expect)(updated?.parsedContentJson).toBe(updates.parsedContentJson);
        (0, vitest_1.expect)(updated?.parsedAt?.toISOString().slice(0, -4)).toBe(updates.parsedAt.toISOString().slice(0, -4));
        (0, vitest_1.expect)(updated?.errorInfo).toBeNull(); // Not updated, should remain null
        (0, vitest_1.expect)(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });
    (0, vitest_1.it)('should update only errorInfo using the update method', async () => {
        const created = await testObjectModel.create(sampleData1);
        const updates = {
            status: 'error',
            errorInfo: 'Specific update error',
        };
        await testObjectModel.update(created.id, updates);
        const updated = await testObjectModel.getById(created.id);
        (0, vitest_1.expect)(updated?.status).toBe('error');
        (0, vitest_1.expect)(updated?.errorInfo).toBe(updates.errorInfo);
        (0, vitest_1.expect)(updated?.title).toBe(sampleData1.title); // Title should be unchanged
    });
    (0, vitest_1.it)('should find objects by a single status using findByStatus', async () => {
        const o1 = await testObjectModel.create({ ...sampleData1, status: 'fetched' });
        const o2 = await testObjectModel.create({ ...sampleData2, status: 'fetched' });
        await testObjectModel.create({ ...sampleData1, sourceUri: 'uri3', status: 'new' });
        const fetched = await testObjectModel.findByStatus(['fetched']);
        (0, vitest_1.expect)(fetched).toHaveLength(2);
        (0, vitest_1.expect)(fetched.map(o => o.id)).toEqual(vitest_1.expect.arrayContaining([o1.id, o2.id]));
        (0, vitest_1.expect)(fetched.map(o => o.source_uri)).toEqual(vitest_1.expect.arrayContaining([o1.sourceUri, o2.sourceUri]));
    });
    (0, vitest_1.it)('should find objects by multiple statuses using findByStatus', async () => {
        const o1 = await testObjectModel.create({ ...sampleData1, status: 'new' });
        const o2 = await testObjectModel.create({ ...sampleData2, status: 'error', errorInfo: 'err' });
        await testObjectModel.create({ ...sampleData1, sourceUri: 'uri3', status: 'parsed' });
        const fetched = await testObjectModel.findByStatus(['new', 'error']);
        (0, vitest_1.expect)(fetched).toHaveLength(2);
        (0, vitest_1.expect)(fetched.map(o => o.id)).toEqual(vitest_1.expect.arrayContaining([o1.id, o2.id]));
    });
    (0, vitest_1.it)('should return empty array from findByStatus if no matches', async () => {
        await testObjectModel.create({ ...sampleData1, status: 'new' });
        const fetched = await testObjectModel.findByStatus(['parsed', 'embedded']);
        (0, vitest_1.expect)(fetched).toHaveLength(0);
    });
    (0, vitest_1.it)('should get processable objects (status = parsed)', async () => {
        const parsed1 = await testObjectModel.create({ ...sampleData1, sourceUri: 'p1', status: 'parsed', parsedContentJson: '{"a": 1}' });
        const parsed2 = await testObjectModel.create({ ...sampleData2, sourceUri: 'p2', status: 'parsed' });
        await testObjectModel.create({ ...sampleData1, sourceUri: 'n1', status: 'new' });
        await testObjectModel.create({ ...sampleData2, sourceUri: 'e1', status: 'embedded' });
        const processable = await testObjectModel.getProcessableObjects(5);
        (0, vitest_1.expect)(processable).toHaveLength(2);
        (0, vitest_1.expect)(processable.map(o => o.sourceUri)).toEqual(vitest_1.expect.arrayContaining(['p1', 'p2']));
        (0, vitest_1.expect)(processable.every(o => o.status === 'parsed')).toBe(true);
        // Check if parsedContentJson is retrieved
        const p1 = processable.find(o => o.sourceUri === 'p1');
        (0, vitest_1.expect)(p1?.parsedContentJson).toBe('{"a": 1}');
    });
    (0, vitest_1.it)('should delete an object by ID', async () => {
        const created = await testObjectModel.create({ ...sampleData1, sourceUri: 'https://delete.me' });
        let fetched = await testObjectModel.getById(created.id);
        (0, vitest_1.expect)(fetched).not.toBeNull();
        await testObjectModel.deleteById(created.id);
        fetched = await testObjectModel.getById(created.id);
        (0, vitest_1.expect)(fetched).toBeNull();
    });
});
//# sourceMappingURL=ObjectModel.test.js.map