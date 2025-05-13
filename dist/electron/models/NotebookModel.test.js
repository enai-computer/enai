"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const db_1 = require("./db"); // Assuming db.ts is in the same directory for models
const runMigrations_1 = __importDefault(require("./runMigrations"));
const NotebookModel_1 = require("./NotebookModel");
const crypto_1 = require("crypto");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const testDbPath = ':memory:';
(0, vitest_1.describe)('NotebookModel Unit Tests', () => {
    let db;
    let notebookModel;
    (0, vitest_1.beforeEach)(() => {
        // Vitest typically runs tests in a way that might share context if not careful.
        // For better-sqlite3 in-memory, creating a new instance is the cleanest way.
        db = new better_sqlite3_1.default(testDbPath); // Create a new in-memory DB for each test
        (0, runMigrations_1.default)(db); // Apply migrations to this new DB instance
        notebookModel = new NotebookModel_1.NotebookModel(db);
    });
    (0, vitest_1.afterEach)(() => {
        if (db && db.open) {
            // It's important that the local 'db' instance for the test is closed if it's not the global one.
            // However, if beforeEach now sets the global instance, closeDb() handles it.
            // db.close(); // This would be for a purely local instance not affecting global.
        }
        (0, db_1.closeDb)(); // Ensure global singleton is closed and nullified.
    });
    (0, vitest_1.describe)('create', () => {
        (0, vitest_1.it)('should create a new notebook with title and description', async () => {
            const id = (0, crypto_1.randomUUID)();
            const title = 'Test Notebook';
            const description = 'This is a test description.';
            const objectId = (0, crypto_1.randomUUID)(); // Added dummy objectId
            const createdNotebook = await notebookModel.create(id, title, objectId, description);
            (0, vitest_1.expect)(createdNotebook).toBeDefined();
            (0, vitest_1.expect)(createdNotebook.id).toBe(id);
            (0, vitest_1.expect)(createdNotebook.title).toBe(title);
            (0, vitest_1.expect)(createdNotebook.description).toBe(description);
            (0, vitest_1.expect)(createdNotebook.objectId).toBe(objectId); // Verify objectId
            (0, vitest_1.expect)(createdNotebook.createdAt).toEqual(vitest_1.expect.any(Number));
            (0, vitest_1.expect)(createdNotebook.updatedAt).toEqual(vitest_1.expect.any(Number));
            (0, vitest_1.expect)(createdNotebook.createdAt).toBe(createdNotebook.updatedAt);
            // Verify in DB
            const dbRecord = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id);
            (0, vitest_1.expect)(dbRecord).toBeDefined();
            (0, vitest_1.expect)(dbRecord.title).toBe(title);
            (0, vitest_1.expect)(dbRecord.description).toBe(description);
            (0, vitest_1.expect)(dbRecord.object_id).toBe(objectId); // Verify object_id in DB
        });
        (0, vitest_1.it)('should create a new notebook with title and null description', async () => {
            const id = (0, crypto_1.randomUUID)();
            const title = 'Test Notebook No Desc';
            const objectId = (0, crypto_1.randomUUID)(); // Added dummy objectId
            const createdNotebook = await notebookModel.create(id, title, objectId, null);
            (0, vitest_1.expect)(createdNotebook.id).toBe(id);
            (0, vitest_1.expect)(createdNotebook.title).toBe(title);
            (0, vitest_1.expect)(createdNotebook.description).toBeNull();
            (0, vitest_1.expect)(createdNotebook.objectId).toBe(objectId); // Verify objectId
            const dbRecord = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id);
            (0, vitest_1.expect)(dbRecord.description).toBeNull();
            (0, vitest_1.expect)(dbRecord.object_id).toBe(objectId); // Verify object_id in DB
        });
        (0, vitest_1.it)('should create a new notebook with title and undefined description (becomes null)', async () => {
            const id = (0, crypto_1.randomUUID)();
            const title = 'Test Notebook Undef Desc';
            const objectId = (0, crypto_1.randomUUID)(); // Added dummy objectId
            const createdNotebook = await notebookModel.create(id, title, objectId); // Undefined description
            (0, vitest_1.expect)(createdNotebook.id).toBe(id);
            (0, vitest_1.expect)(createdNotebook.title).toBe(title);
            (0, vitest_1.expect)(createdNotebook.description).toBeNull();
            (0, vitest_1.expect)(createdNotebook.objectId).toBe(objectId); // Verify objectId
            const dbRecord = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id);
            (0, vitest_1.expect)(dbRecord.description).toBeNull();
            (0, vitest_1.expect)(dbRecord.object_id).toBe(objectId); // Verify object_id in DB
        });
        (0, vitest_1.it)('should throw an error if trying to create a notebook with an existing ID', async () => {
            const id = (0, crypto_1.randomUUID)();
            const objectId1 = (0, crypto_1.randomUUID)();
            const objectId2 = (0, crypto_1.randomUUID)();
            await notebookModel.create(id, 'First Notebook', objectId1, 'Desc1');
            await (0, vitest_1.expect)(notebookModel.create(id, 'Second Notebook Same ID', objectId2, 'Desc2'))
                .rejects
                .toThrow(vitest_1.expect.objectContaining({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })); // Or SQLITE_CONSTRAINT_UNIQUE
        });
    });
    (0, vitest_1.describe)('getById', () => {
        (0, vitest_1.it)('should retrieve an existing notebook by its ID', async () => {
            const id = (0, crypto_1.randomUUID)();
            const title = 'Notebook to Get';
            const objectId = (0, crypto_1.randomUUID)(); // Added dummy objectId
            await notebookModel.create(id, title, objectId, 'Some description');
            const fetchedNotebook = await notebookModel.getById(id);
            (0, vitest_1.expect)(fetchedNotebook).toBeDefined();
            (0, vitest_1.expect)(fetchedNotebook?.id).toBe(id);
            (0, vitest_1.expect)(fetchedNotebook?.title).toBe(title);
            (0, vitest_1.expect)(fetchedNotebook?.description).toBe('Some description');
            (0, vitest_1.expect)(fetchedNotebook?.objectId).toBe(objectId); // Verify objectId
        });
        (0, vitest_1.it)('should return null if no notebook exists with the given ID', async () => {
            const nonExistentId = (0, crypto_1.randomUUID)();
            const fetchedNotebook = await notebookModel.getById(nonExistentId);
            (0, vitest_1.expect)(fetchedNotebook).toBeNull();
        });
    });
    (0, vitest_1.describe)('getAll', () => {
        (0, vitest_1.it)('should return an empty array if no notebooks exist', async () => {
            const allNotebooks = await notebookModel.getAll();
            (0, vitest_1.expect)(allNotebooks).toEqual([]);
        });
        (0, vitest_1.it)('should retrieve all notebooks ordered by title ascending', async () => {
            // Create notebooks out of alphabetical order to test sorting
            await notebookModel.create((0, crypto_1.randomUUID)(), 'Charlie Notebook', (0, crypto_1.randomUUID)(), 'Desc C');
            await notebookModel.create((0, crypto_1.randomUUID)(), 'Alpha Notebook', (0, crypto_1.randomUUID)(), 'Desc A');
            await notebookModel.create((0, crypto_1.randomUUID)(), 'Bravo Notebook', (0, crypto_1.randomUUID)(), 'Desc B');
            const allNotebooks = await notebookModel.getAll();
            (0, vitest_1.expect)(allNotebooks.length).toBe(3);
            (0, vitest_1.expect)(allNotebooks[0].title).toBe('Alpha Notebook');
            (0, vitest_1.expect)(allNotebooks[1].title).toBe('Bravo Notebook');
            (0, vitest_1.expect)(allNotebooks[2].title).toBe('Charlie Notebook');
        });
        (0, vitest_1.it)('should return multiple notebooks with correct data', async () => {
            const id1 = (0, crypto_1.randomUUID)();
            const id2 = (0, crypto_1.randomUUID)();
            const objectId1 = (0, crypto_1.randomUUID)();
            const objectId2 = (0, crypto_1.randomUUID)();
            await notebookModel.create(id1, 'Notebook One', objectId1, 'Desc1');
            await notebookModel.create(id2, 'Notebook Two', objectId2, 'Desc2');
            const allNotebooks = await notebookModel.getAll();
            (0, vitest_1.expect)(allNotebooks.length).toBe(2);
            const nb1 = allNotebooks.find(nb => nb.id === id1);
            const nb2 = allNotebooks.find(nb => nb.id === id2);
            (0, vitest_1.expect)(nb1).toBeDefined();
            (0, vitest_1.expect)(nb1?.title).toBe('Notebook One');
            (0, vitest_1.expect)(nb1?.objectId).toBe(objectId1); // Verify objectId
            (0, vitest_1.expect)(nb2).toBeDefined();
            (0, vitest_1.expect)(nb2?.title).toBe('Notebook Two');
            (0, vitest_1.expect)(nb2?.objectId).toBe(objectId2); // Verify objectId
        });
    });
    (0, vitest_1.describe)('update', () => {
        let notebookToUpdate;
        let originalUpdatedAt;
        let originalObjectId; // Store original objectId
        (0, vitest_1.beforeEach)(async () => {
            const id = (0, crypto_1.randomUUID)();
            originalObjectId = (0, crypto_1.randomUUID)(); // Assign an objectId during creation
            notebookToUpdate = await notebookModel.create(id, 'Original Title', originalObjectId, 'Original Description');
            originalUpdatedAt = notebookToUpdate.updatedAt;
            // Ensure a small delay so that a subsequent update can have a different timestamp
            await new Promise(resolve => setTimeout(resolve, 1001));
        });
        (0, vitest_1.it)('should update the title and description of an existing notebook', async () => {
            const updates = { title: 'Updated Title', description: 'Updated Description' };
            const updatedNotebook = await notebookModel.update(notebookToUpdate.id, updates);
            (0, vitest_1.expect)(updatedNotebook).toBeDefined();
            (0, vitest_1.expect)(updatedNotebook?.id).toBe(notebookToUpdate.id);
            (0, vitest_1.expect)(updatedNotebook?.title).toBe(updates.title);
            (0, vitest_1.expect)(updatedNotebook?.description).toBe(updates.description);
            (0, vitest_1.expect)(updatedNotebook?.objectId).toBe(originalObjectId); // ObjectId should not change on update
            (0, vitest_1.expect)(updatedNotebook?.updatedAt).toBeGreaterThan(originalUpdatedAt);
            const dbRecord = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(notebookToUpdate.id);
            (0, vitest_1.expect)(dbRecord.title).toBe(updates.title);
            (0, vitest_1.expect)(dbRecord.description).toBe(updates.description);
            (0, vitest_1.expect)(dbRecord.object_id).toBe(originalObjectId); // Verify object_id in DB
            (0, vitest_1.expect)(dbRecord.updated_at).toBeGreaterThan(originalUpdatedAt);
        });
        (0, vitest_1.it)('should update only the title', async () => {
            const updates = { title: 'New Title Only' };
            const updatedNotebook = await notebookModel.update(notebookToUpdate.id, updates);
            (0, vitest_1.expect)(updatedNotebook?.title).toBe(updates.title);
            (0, vitest_1.expect)(updatedNotebook?.description).toBe('Original Description');
            (0, vitest_1.expect)(updatedNotebook?.objectId).toBe(originalObjectId); // ObjectId should not change on update
            (0, vitest_1.expect)(updatedNotebook?.updatedAt).toBeGreaterThan(originalUpdatedAt);
        });
        (0, vitest_1.it)('should update only the description (to new value and to null)', async () => {
            let updates = { description: 'New Description Only' };
            let updatedNotebook = await notebookModel.update(notebookToUpdate.id, updates);
            let currentUpdatedAt = updatedNotebook.updatedAt;
            (0, vitest_1.expect)(updatedNotebook?.title).toBe('Original Title');
            (0, vitest_1.expect)(updatedNotebook?.description).toBe(updates.description);
            (0, vitest_1.expect)(updatedNotebook?.objectId).toBe(originalObjectId); // ObjectId should not change on update
            (0, vitest_1.expect)(currentUpdatedAt).toBeGreaterThan(originalUpdatedAt);
            // Update to null
            await new Promise(resolve => setTimeout(resolve, 50));
            updates = { description: null };
            updatedNotebook = await notebookModel.update(notebookToUpdate.id, updates);
            (0, vitest_1.expect)(updatedNotebook?.description).toBeNull();
            (0, vitest_1.expect)(updatedNotebook?.objectId).toBe(originalObjectId); // ObjectId should not change on update
            (0, vitest_1.expect)(updatedNotebook?.updatedAt).toBeGreaterThanOrEqual(currentUpdatedAt);
        });
        (0, vitest_1.it)('should return the current record and not change updated_at if no fields are provided for update', async () => {
            const noUpdates = {};
            const resultNotebook = await notebookModel.update(notebookToUpdate.id, noUpdates);
            (0, vitest_1.expect)(resultNotebook?.id).toBe(notebookToUpdate.id);
            (0, vitest_1.expect)(resultNotebook?.title).toBe('Original Title');
            (0, vitest_1.expect)(resultNotebook?.description).toBe('Original Description');
            (0, vitest_1.expect)(resultNotebook?.objectId).toBe(originalObjectId); // ObjectId should still be there
            // Because the model short-circuits, the UPDATE SQL is not run, so trigger doesn't fire.
            (0, vitest_1.expect)(resultNotebook?.updatedAt).toBe(originalUpdatedAt);
        });
        (0, vitest_1.it)('should return null when trying to update a non-existent notebook', async () => {
            const nonExistentId = (0, crypto_1.randomUUID)();
            const result = await notebookModel.update(nonExistentId, { title: 'No Notebook Here' });
            (0, vitest_1.expect)(result).toBeNull();
        });
    });
    (0, vitest_1.describe)('delete', () => {
        (0, vitest_1.it)('should delete an existing notebook and return true', async () => {
            const id = (0, crypto_1.randomUUID)();
            await notebookModel.create(id, 'Notebook To Delete', (0, crypto_1.randomUUID)(), 'Description');
            const deleteResult = await notebookModel.delete(id);
            (0, vitest_1.expect)(deleteResult).toBe(true);
            const fetchedNotebook = await notebookModel.getById(id);
            (0, vitest_1.expect)(fetchedNotebook).toBeNull();
        });
        (0, vitest_1.it)('should return false when trying to delete a non-existent notebook', async () => {
            const nonExistentId = (0, crypto_1.randomUUID)();
            const deleteResult = await notebookModel.delete(nonExistentId);
            (0, vitest_1.expect)(deleteResult).toBe(false);
        });
    });
});
//# sourceMappingURL=NotebookModel.test.js.map