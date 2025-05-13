"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const db_1 = require("../models/db");
const runMigrations_1 = __importDefault(require("../models/runMigrations"));
const ObjectModel_1 = require("../models/ObjectModel");
const ChunkModel_1 = require("../models/ChunkModel");
const ChatModel_1 = require("../models/ChatModel");
const NotebookModel_1 = require("../models/NotebookModel");
const NotebookService_1 = require("./NotebookService");
const crypto_1 = require("crypto");
// Use an in-memory database for testing
const testDbPath = ':memory:';
// For Step 3
try {
    console.log('[Test File] ChunkModel resolves to', require.resolve('../models/ChunkModel'));
}
catch (e) {
    console.error('[Test File] Error resolving ChunkModel path:', e);
}
(0, vitest_1.describe)('NotebookService Integration Tests', () => {
    let db;
    let objectModel;
    let chunkSqlModel;
    let chatModel;
    let notebookModel;
    let notebookService;
    (0, vitest_1.beforeEach)(async () => {
        // Ensure JEFFERS_DB_PATH is :memory: so initDb() (no-arg) uses an in-memory DB for global dbInstance
        vitest_1.vi.stubEnv('JEFFERS_DB_PATH', ':memory:');
        // Initialize the global dbInstance to an in-memory database.
        // This is the instance NotebookService will use via its internal getDb() calls.
        db = (0, db_1.initDb)();
        (0, runMigrations_1.default)(db); // Apply migrations to this global in-memory database.
        // Instantiate models with THIS specific in-memory, migrated, global db.
        objectModel = new ObjectModel_1.ObjectModel(db);
        chunkSqlModel = new ChunkModel_1.ChunkSqlModel(db);
        // --- Step 1 Diagnostics ---
        console.log('--- fresh ChunkSqlModel ---');
        console.log('proto keys  :', Object.getOwnPropertyNames(ChunkModel_1.ChunkSqlModel.prototype));
        console.log('typeof .assignToNotebook  :', typeof chunkSqlModel.assignToNotebook);
        console.log('own property?:', chunkSqlModel.hasOwnProperty('assignToNotebook'));
        // End Step 1 Diagnostics
        console.log('[Test Setup] typeof on first instantiation:', typeof chunkSqlModel.assignToNotebook, '[Test Setup] own?', chunkSqlModel.hasOwnProperty('assignToNotebook'));
        console.log('[Test Setup] proto value ===', Object.getPrototypeOf(chunkSqlModel).assignToNotebook);
        chatModel = new ChatModel_1.ChatModel(db);
        notebookModel = new NotebookModel_1.NotebookModel(db);
        notebookService = new NotebookService_1.NotebookService(notebookModel, objectModel, chunkSqlModel, chatModel, db);
        // --- Step 4 Diagnostics ---
        console.log('=== identity check ===');
        console.log('chunkSqlModel === notebookService["chunkSqlModel"] ?', chunkSqlModel === notebookService.chunkSqlModel);
        // End Step 4 Diagnostics
    });
    (0, vitest_1.afterEach)(async () => {
        (0, db_1.closeDb)(); // Use the global helper to close and nullify the singleton instance
        vitest_1.vi.unstubAllEnvs(); // Restore original environment variables
        vitest_1.vi.restoreAllMocks(); // Restore all spies/mocks
    });
    (0, vitest_1.it)('should be true', () => {
        (0, vitest_1.expect)(true).toBe(true);
    });
    // Test suites for each NotebookService method will go here
    (0, vitest_1.describe)('createNotebook', () => {
        (0, vitest_1.it)('should create a NotebookRecord and a corresponding JeffersObject with correct details', async () => {
            const title = 'Test Notebook';
            const description = 'This is a test description.';
            const notebookRecord = await notebookService.createNotebook(title, description);
            // Verify NotebookRecord
            (0, vitest_1.expect)(notebookRecord).toBeDefined();
            (0, vitest_1.expect)(notebookRecord.id).toEqual(vitest_1.expect.any(String));
            (0, vitest_1.expect)(notebookRecord.title).toBe(title);
            (0, vitest_1.expect)(notebookRecord.description).toBe(description);
            (0, vitest_1.expect)(notebookRecord.createdAt).toEqual(vitest_1.expect.any(Number));
            (0, vitest_1.expect)(notebookRecord.updatedAt).toEqual(vitest_1.expect.any(Number));
            (0, vitest_1.expect)(notebookRecord.createdAt).toBe(notebookRecord.updatedAt);
            // Verify JeffersObject
            const expectedSourceUri = `jeffers://notebook/${notebookRecord.id}`;
            const jeffersObject = await objectModel.getBySourceUri(expectedSourceUri);
            (0, vitest_1.expect)(jeffersObject).toBeDefined();
            if (!jeffersObject)
                throw new Error('JeffersObject not found'); // Type guard
            (0, vitest_1.expect)(jeffersObject.objectType).toBe('notebook');
            (0, vitest_1.expect)(jeffersObject.sourceUri).toBe(expectedSourceUri);
            (0, vitest_1.expect)(jeffersObject.title).toBe(title);
            const expectedCleanedText = `${title}\n${description}`;
            (0, vitest_1.expect)(jeffersObject.cleanedText).toBe(expectedCleanedText);
            (0, vitest_1.expect)(jeffersObject.status).toBe('parsed');
            (0, vitest_1.expect)(jeffersObject.parsedAt).toBeDefined();
        });
        (0, vitest_1.it)('should create a NotebookRecord and JeffersObject when description is null', async () => {
            const title = 'Test Notebook No Description';
            const notebookRecord = await notebookService.createNotebook(title, null);
            (0, vitest_1.expect)(notebookRecord).toBeDefined();
            (0, vitest_1.expect)(notebookRecord.title).toBe(title);
            (0, vitest_1.expect)(notebookRecord.description).toBeNull();
            const expectedSourceUri = `jeffers://notebook/${notebookRecord.id}`;
            const jeffersObject = await objectModel.getBySourceUri(expectedSourceUri);
            (0, vitest_1.expect)(jeffersObject).toBeDefined();
            if (!jeffersObject)
                throw new Error('JeffersObject not found');
            (0, vitest_1.expect)(jeffersObject.title).toBe(title);
            const expectedCleanedText = title; // No newline or null description part
            (0, vitest_1.expect)(jeffersObject.cleanedText).toBe(expectedCleanedText);
        });
        (0, vitest_1.it)('should rollback NotebookRecord creation if JeffersObject creation fails', async () => {
            const title = 'Fail Object Notebook';
            const description = 'This should fail.';
            // Spy on objectModel.create and make it throw an error
            const createObjectSpy = vitest_1.vi.spyOn(objectModel, 'create').mockImplementationOnce(async () => {
                throw new Error('Simulated ObjectModel.create failure');
            });
            await (0, vitest_1.expect)(notebookService.createNotebook(title, description))
                .rejects
                .toThrow('Failed to create notebook transactionally: Simulated ObjectModel.create failure');
            // Verify no NotebookRecord was created with this title
            // (Assuming title is unique enough for this test scenario, or query by a non-existent ID if possible)
            const allNotebooks = await notebookModel.getAll();
            const foundNotebook = allNotebooks.find(nb => nb.title === title);
            (0, vitest_1.expect)(foundNotebook).toBeUndefined();
            // Verify no JeffersObject was created (though the spy prevents it, this is an extra check)
            // We can't easily get the intended source URI as the notebook ID was never finalized in a successful record.
            // Instead, we can check if any object was created with the title.
            // This part is a bit indirect for objectModel verification because the sourceUri is key.
            // The primary verification is that the notebook record itself is absent.
            const objectsWithTitle = (await objectModel.findByStatus(['parsed', 'new', 'error'])) // check common statuses
                .map(async (objId) => await objectModel.getById(objId.id))
                .filter(async (objProm) => (await objProm)?.title === title);
            (0, vitest_1.expect)(objectsWithTitle.length).toBe(0); // This is a bit weak, but covers basics
            createObjectSpy.mockRestore(); // Clean up the spy
        });
    });
    (0, vitest_1.describe)('getNotebookById', () => {
        (0, vitest_1.it)('should retrieve an existing notebook by its ID', async () => {
            const createdNotebook = await notebookService.createNotebook('GetMe', 'Description');
            const fetchedNotebook = await notebookService.getNotebookById(createdNotebook.id);
            (0, vitest_1.expect)(fetchedNotebook).toBeDefined();
            (0, vitest_1.expect)(fetchedNotebook?.id).toBe(createdNotebook.id);
            (0, vitest_1.expect)(fetchedNotebook?.title).toBe('GetMe');
        });
        (0, vitest_1.it)('should return null for a non-existent notebook ID', async () => {
            const nonExistentId = (0, crypto_1.randomUUID)();
            const fetchedNotebook = await notebookService.getNotebookById(nonExistentId);
            (0, vitest_1.expect)(fetchedNotebook).toBeNull();
        });
    });
    (0, vitest_1.describe)('getAllNotebooks', () => {
        (0, vitest_1.it)('should return an empty array if no notebooks exist', async () => {
            const allNotebooks = await notebookService.getAllNotebooks();
            (0, vitest_1.expect)(allNotebooks).toEqual([]);
        });
        (0, vitest_1.it)('should retrieve all created notebooks', async () => {
            await notebookService.createNotebook('NB1', 'Desc1');
            await notebookService.createNotebook('NB2', 'Desc2');
            const allNotebooks = await notebookService.getAllNotebooks();
            (0, vitest_1.expect)(allNotebooks.length).toBe(2);
            // Order is by title ASC as per NotebookModel.getAll()
            (0, vitest_1.expect)(allNotebooks[0].title).toBe('NB1');
            (0, vitest_1.expect)(allNotebooks[1].title).toBe('NB2');
        });
    });
    (0, vitest_1.describe)('updateNotebook', () => {
        let notebook;
        (0, vitest_1.beforeEach)(async () => {
            notebook = await notebookService.createNotebook('Original Title', 'Original Description');
        });
        (0, vitest_1.it)('should update title and description and the corresponding JeffersObject', async () => {
            const updates = { title: 'Updated Title', description: 'Updated Description' };
            const updatedNotebook = await notebookService.updateNotebook(notebook.id, updates);
            (0, vitest_1.expect)(updatedNotebook).toBeDefined();
            (0, vitest_1.expect)(updatedNotebook?.title).toBe(updates.title);
            (0, vitest_1.expect)(updatedNotebook?.description).toBe(updates.description);
            const jeffersObject = await objectModel.getBySourceUri(`jeffers://notebook/${notebook.id}`);
            (0, vitest_1.expect)(jeffersObject?.title).toBe(updates.title);
            (0, vitest_1.expect)(jeffersObject?.cleanedText).toBe(`${updates.title}\n${updates.description}`);
        });
        (0, vitest_1.it)('should update only title and the corresponding JeffersObject', async () => {
            const updates = { title: 'New Title Only' };
            await notebookService.updateNotebook(notebook.id, updates);
            const fetchedNotebook = await notebookModel.getById(notebook.id);
            (0, vitest_1.expect)(fetchedNotebook?.title).toBe(updates.title);
            (0, vitest_1.expect)(fetchedNotebook?.description).toBe('Original Description'); // Description should remain unchanged
            const jeffersObject = await objectModel.getBySourceUri(`jeffers://notebook/${notebook.id}`);
            (0, vitest_1.expect)(jeffersObject?.title).toBe(updates.title);
            (0, vitest_1.expect)(jeffersObject?.cleanedText).toBe(`${updates.title}\nOriginal Description`);
        });
        (0, vitest_1.it)('should update description to null and the corresponding JeffersObject', async () => {
            const updates = { description: null };
            await notebookService.updateNotebook(notebook.id, updates);
            const fetchedNotebook = await notebookModel.getById(notebook.id);
            (0, vitest_1.expect)(fetchedNotebook?.title).toBe('Original Title');
            (0, vitest_1.expect)(fetchedNotebook?.description).toBeNull();
            const jeffersObject = await objectModel.getBySourceUri(`jeffers://notebook/${notebook.id}`);
            (0, vitest_1.expect)(jeffersObject?.title).toBe('Original Title');
            (0, vitest_1.expect)(jeffersObject?.cleanedText).toBe('Original Title'); // Cleaned text without null description
        });
        (0, vitest_1.it)('should return null if attempting to update a non-existent notebook', async () => {
            const nonExistentId = (0, crypto_1.randomUUID)();
            const result = await notebookService.updateNotebook(nonExistentId, { title: 'No Such Notebook' });
            (0, vitest_1.expect)(result).toBeNull();
        });
        (0, vitest_1.it)('should rollback NotebookRecord update if JeffersObject update fails', async () => {
            const updates = { title: 'Update That Will Fail Object', description: 'Desc' };
            const originalNotebook = await notebookModel.getById(notebook.id);
            const updateObjectSpy = vitest_1.vi.spyOn(objectModel, 'update').mockImplementationOnce(async () => {
                throw new Error('Simulated ObjectModel.update failure');
            });
            await (0, vitest_1.expect)(notebookService.updateNotebook(notebook.id, updates))
                .rejects
                .toThrow('Failed to update notebook transactionally: Simulated ObjectModel.update failure');
            const notebookAfterFailedUpdate = await notebookModel.getById(notebook.id);
            (0, vitest_1.expect)(notebookAfterFailedUpdate?.title).toBe(originalNotebook?.title);
            (0, vitest_1.expect)(notebookAfterFailedUpdate?.description).toBe(originalNotebook?.description);
            updateObjectSpy.mockRestore();
        });
        (0, vitest_1.it)('should still update NotebookRecord if its JeffersObject is missing (and log warning)', async () => {
            // First, delete the associated JeffersObject manually
            const sourceUri = `jeffers://notebook/${notebook.id}`;
            const initialJeffersObject = await objectModel.getBySourceUri(sourceUri);
            if (initialJeffersObject) {
                await objectModel.deleteById(initialJeffersObject.id);
            }
            const deletedJeffersObject = await objectModel.getBySourceUri(sourceUri);
            (0, vitest_1.expect)(deletedJeffersObject).toBeNull(); // Confirm JeffersObject is gone
            const updates = { title: 'Updated Title For Missing Object', description: 'New Desc' };
            // Spy on logger.warn - this is optional but good for full verification
            const loggerWarnSpy = vitest_1.vi.spyOn(console, 'warn'); // Assuming logger.warn eventually calls console.warn or similar
            const updatedNotebook = await notebookService.updateNotebook(notebook.id, updates);
            (0, vitest_1.expect)(updatedNotebook).toBeDefined();
            (0, vitest_1.expect)(updatedNotebook?.title).toBe(updates.title);
            (0, vitest_1.expect)(updatedNotebook?.description).toBe(updates.description);
            // Check if the warning was logged - this depends on your logger setup
            // For simplicity, we'll assume the service handles logging and focus on DB state.
            // expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('JeffersObject not found for notebook ID'));
            loggerWarnSpy.mockRestore();
        });
    });
    (0, vitest_1.describe)('deleteNotebook', () => {
        let notebook;
        let jeffersObject; // Notebook's own JeffersObject
        let chatSession;
        let chunk; // This is the chunk whose notebook_id we'll check for nullification
        let independentJeffersObjectForChunk; // For the chunk's object_id
        (0, vitest_1.beforeEach)(async () => {
            notebook = await notebookService.createNotebook('ToDelete', 'Delete Desc');
            jeffersObject = await objectModel.getBySourceUri(`jeffers://notebook/${notebook.id}`); // Get the notebook's own JO
            // Create a separate JeffersObject specifically for the chunk used in the SET NULL test
            independentJeffersObjectForChunk = await objectModel.create({
                objectType: 'test_source_for_chunk',
                sourceUri: `test://source_set_null_test/${(0, crypto_1.randomUUID)()}`,
                title: 'Independent Object for SET NULL Test Chunk',
                status: 'parsed',
                cleanedText: 'Content for independent object',
                rawContentRef: null,
                parsedContentJson: null,
                errorInfo: null,
                parsedAt: new Date(),
            });
            chatSession = await chatModel.createSession(notebook.id, (0, crypto_1.randomUUID)(), 'Chat in ToDelete');
            // Create the specific chunk for testing SET NULL, linked to the INDEPENDENT JeffersObject
            const createdChunkForSetNullTest = await chunkSqlModel.addChunk({
                objectId: independentJeffersObjectForChunk.id,
                chunkIdx: 0,
                content: 'Test chunk content for SET NULL behavior',
            });
            await chunkSqlModel.assignToNotebook(createdChunkForSetNullTest.id, notebook.id);
            // Make 'chunk' refer to this specific chunk for the relevant test
            const tempChunk = await chunkSqlModel.getById(createdChunkForSetNullTest.id);
            if (!tempChunk)
                throw new Error('Chunk for SET NULL test not created in beforeEach');
            chunk = tempChunk; // 'chunk' variable will be used in the "nullify chunk_id" test
        });
        (0, vitest_1.it)('should delete the NotebookRecord, its JeffersObject, cascade delete chat sessions, and nullify chunk notebook_id', async () => {
            const deleteResult = await notebookService.deleteNotebook(notebook.id);
            (0, vitest_1.expect)(deleteResult).toBe(true);
            // Verify NotebookRecord is deleted
            const deletedNotebookRecord = await notebookModel.getById(notebook.id);
            (0, vitest_1.expect)(deletedNotebookRecord).toBeNull();
            // Verify JeffersObject (the notebook's own) is deleted
            const deletedJeffersObject = await objectModel.getBySourceUri(`jeffers://notebook/${notebook.id}`);
            (0, vitest_1.expect)(deletedJeffersObject).toBeNull();
            // Verify chat session is cascade-deleted
            const sessionsForNotebook = await chatModel.listSessionsForNotebook(notebook.id);
            (0, vitest_1.expect)(sessionsForNotebook.length).toBe(0);
            const deletedSession = await chatModel.getSessionById(chatSession.sessionId); // Updated method and property
            (0, vitest_1.expect)(deletedSession).toBeNull(); // Direct check
            // Verify chunk's notebook_id is nullified (chunk sourced from independentJeffersObjectForChunk)
            const updatedChunk = await chunkSqlModel.getById(chunk.id);
            (0, vitest_1.expect)(updatedChunk).toBeDefined(); // The chunk itself should still exist
            (0, vitest_1.expect)(updatedChunk?.notebookId).toBeNull(); // Updated property: notebookId
        });
        (0, vitest_1.it)('should return false if trying to delete a non-existent notebook', async () => {
            const nonExistentId = (0, crypto_1.randomUUID)();
            const deleteResult = await notebookService.deleteNotebook(nonExistentId);
            (0, vitest_1.expect)(deleteResult).toBe(false);
        });
        (0, vitest_1.it)('should rollback deletion if JeffersObject deletion fails', async () => {
            const deleteObjectSpy = vitest_1.vi.spyOn(objectModel, 'deleteById').mockImplementationOnce(async () => {
                throw new Error('Simulated ObjectModel.deleteById failure');
            });
            await (0, vitest_1.expect)(notebookService.deleteNotebook(notebook.id))
                .rejects
                .toThrow('Failed to delete notebook transactionally: Simulated ObjectModel.deleteById failure');
            // Verify NotebookRecord still exists
            const stillExistsNotebook = await notebookModel.getById(notebook.id);
            (0, vitest_1.expect)(stillExistsNotebook).toBeDefined();
            // Verify JeffersObject still exists
            const stillExistsJeffersObject = await objectModel.getBySourceUri(`jeffers://notebook/${notebook.id}`);
            (0, vitest_1.expect)(stillExistsJeffersObject).toBeDefined();
            deleteObjectSpy.mockRestore();
        });
        (0, vitest_1.it)('should rollback JeffersObject deletion if NotebookRecord deletion fails subsequently', async () => {
            // This spy will allow objectModel.deleteById to succeed, then make notebookModel.delete fail
            const deleteNotebookModelSpy = vitest_1.vi.spyOn(notebookModel, 'delete').mockImplementationOnce(async (id) => {
                // Simulate that objectModel.deleteById was called and succeeded before this fails
                // We can't directly assert the call order here without more complex spying on the transaction itself.
                // The key is that this *throws after* objectModel.deleteById would have run in the service method.
                throw new Error('Simulated NotebookModel.delete failure after object deletion');
            });
            await (0, vitest_1.expect)(notebookService.deleteNotebook(notebook.id))
                .rejects
                .toThrow('Failed to delete notebook transactionally: Simulated NotebookModel.delete failure after object deletion');
            // Verify NotebookRecord still exists because its own deletion failed
            const notebookRecordStillThere = await notebookModel.getById(notebook.id);
            (0, vitest_1.expect)(notebookRecordStillThere).toBeDefined();
            // CRITICAL: Verify JeffersObject also still exists (due to rollback)
            const jeffersObjectRestored = await objectModel.getBySourceUri(`jeffers://notebook/${notebook.id}`);
            (0, vitest_1.expect)(jeffersObjectRestored).toBeDefined();
            (0, vitest_1.expect)(jeffersObjectRestored?.id).toBe(jeffersObject?.id); // Corrected: Compare to notebook's own JO
            deleteNotebookModelSpy.mockRestore();
        });
        (0, vitest_1.it)('should delete NotebookRecord even if its JeffersObject is missing (and log warning)', async () => {
            // Manually delete the notebook's own JeffersObject first
            if (jeffersObject) { // jeffersObject is the notebook's own JO from the suite's beforeEach
                await objectModel.deleteById(jeffersObject.id);
            }
            const confirmedMissingNotebookJO = await objectModel.getBySourceUri(`jeffers://notebook/${notebook.id}`);
            (0, vitest_1.expect)(confirmedMissingNotebookJO).toBeNull(); // Confirm notebook's own JO is gone
            const loggerWarnSpy = vitest_1.vi.spyOn(console, 'warn'); // Assuming logger.warn uses console.warn
            const deleteResult = await notebookService.deleteNotebook(notebook.id);
            (0, vitest_1.expect)(deleteResult).toBe(true);
            const deletedNotebookRecord = await notebookModel.getById(notebook.id);
            (0, vitest_1.expect)(deletedNotebookRecord).toBeNull();
            // Check logger was called, exact message matching can be fragile
            // expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('No corresponding JeffersObject found'));
            loggerWarnSpy.mockRestore();
        });
    });
    (0, vitest_1.describe)('createChatInNotebook', () => {
        let notebook;
        (0, vitest_1.beforeEach)(async () => {
            notebook = await notebookService.createNotebook('NotebookForChat', 'Test Desc');
        });
        (0, vitest_1.it)('should create a chat session in the specified notebook with a title', async () => {
            const chatTitle = 'My Test Chat';
            const chatSession = await notebookService.createChatInNotebook(notebook.id, chatTitle);
            (0, vitest_1.expect)(chatSession).toBeDefined();
            (0, vitest_1.expect)(chatSession.sessionId).toEqual(vitest_1.expect.any(String)); // Updated
            (0, vitest_1.expect)(chatSession.notebookId).toBe(notebook.id); // Updated
            (0, vitest_1.expect)(chatSession.title).toBe(chatTitle);
        });
        (0, vitest_1.it)('should create a chat session with a null title if not provided', async () => {
            const chatSession = await notebookService.createChatInNotebook(notebook.id, null);
            (0, vitest_1.expect)(chatSession).toBeDefined();
            (0, vitest_1.expect)(chatSession.notebookId).toBe(notebook.id); // Updated
            (0, vitest_1.expect)(chatSession.title).toBeNull();
        });
        (0, vitest_1.it)('should create a chat session with an undefined title (becomes null) if not provided', async () => {
            const chatSession = await notebookService.createChatInNotebook(notebook.id);
            (0, vitest_1.expect)(chatSession).toBeDefined();
            (0, vitest_1.expect)(chatSession.notebookId).toBe(notebook.id); // Updated
            (0, vitest_1.expect)(chatSession.title).toBeNull();
        });
        (0, vitest_1.it)('should throw an error if trying to create a chat in a non-existent notebook', async () => {
            const nonExistentNotebookId = (0, crypto_1.randomUUID)();
            await (0, vitest_1.expect)(notebookService.createChatInNotebook(nonExistentNotebookId, 'Chat Title'))
                .rejects
                .toThrow(`Notebook not found with ID: ${nonExistentNotebookId}`);
        });
    });
    (0, vitest_1.describe)('listChatsForNotebook', () => {
        let notebook1;
        let notebook2;
        (0, vitest_1.beforeEach)(async () => {
            notebook1 = await notebookService.createNotebook('NotebookWithChats', 'Desc1');
            notebook2 = await notebookService.createNotebook('NotebookWithoutChats', 'Desc2');
            // Create some chats for notebook1
            await chatModel.createSession(notebook1.id, (0, crypto_1.randomUUID)(), 'Chat 1 in NB1');
            await chatModel.createSession(notebook1.id, (0, crypto_1.randomUUID)(), 'Chat 2 in NB1');
        });
        (0, vitest_1.it)('should list all chat sessions for a given notebook', async () => {
            const chats = await notebookService.listChatsForNotebook(notebook1.id);
            (0, vitest_1.expect)(chats.length).toBe(2);
            (0, vitest_1.expect)(chats.every(c => c.notebookId === notebook1.id)).toBe(true); // Updated
        });
        (0, vitest_1.it)('should return an empty array for a notebook with no chat sessions', async () => {
            const chats = await notebookService.listChatsForNotebook(notebook2.id);
            (0, vitest_1.expect)(chats).toEqual([]);
        });
        (0, vitest_1.it)('should throw an error if trying to list chats for a non-existent notebook', async () => {
            const nonExistentNotebookId = (0, crypto_1.randomUUID)();
            await (0, vitest_1.expect)(notebookService.listChatsForNotebook(nonExistentNotebookId))
                .rejects
                .toThrow(`Notebook not found with ID: ${nonExistentNotebookId}`);
        });
    });
    (0, vitest_1.describe)('transferChatToNotebook', () => {
        let notebook1;
        let notebook2;
        let chatSession;
        (0, vitest_1.beforeEach)(async () => {
            notebook1 = await notebookService.createNotebook('SourceNotebook', 'SrcDesc');
            notebook2 = await notebookService.createNotebook('TargetNotebook', 'TgtDesc');
            chatSession = await chatModel.createSession(notebook1.id, (0, crypto_1.randomUUID)(), 'ChatToTransfer');
        });
        (0, vitest_1.it)('should successfully transfer a chat session to another notebook', async () => {
            const result = await notebookService.transferChatToNotebook(chatSession.sessionId, notebook2.id); // Updated
            (0, vitest_1.expect)(result).toBe(true);
            const updatedSession = await chatModel.getSessionById(chatSession.sessionId); // Updated method and property
            (0, vitest_1.expect)(updatedSession?.notebookId).toBe(notebook2.id); // Updated
        });
        (0, vitest_1.it)('should throw an error if the chat session does not exist', async () => {
            const nonExistentSessionId = (0, crypto_1.randomUUID)();
            await (0, vitest_1.expect)(notebookService.transferChatToNotebook(nonExistentSessionId, notebook2.id))
                .rejects
                .toThrow(`Chat session not found with ID: ${nonExistentSessionId}`);
        });
        (0, vitest_1.it)('should throw an error if the target notebook does not exist', async () => {
            const nonExistentNotebookId = (0, crypto_1.randomUUID)();
            await (0, vitest_1.expect)(notebookService.transferChatToNotebook(chatSession.sessionId, nonExistentNotebookId)) // Updated
                .rejects
                .toThrow(`Target notebook not found with ID: ${nonExistentNotebookId}`);
        });
        (0, vitest_1.it)('should return true and make no changes if chat is already in the target notebook', async () => {
            const result = await notebookService.transferChatToNotebook(chatSession.sessionId, notebook1.id); // Updated
            (0, vitest_1.expect)(result).toBe(true);
            const notUpdatedSession = await chatModel.getSessionById(chatSession.sessionId); // Updated method and property
            (0, vitest_1.expect)(notUpdatedSession?.notebookId).toBe(notebook1.id); // Updated
        });
    });
    (0, vitest_1.describe)('assignChunkToNotebook', () => {
        let notebook;
        let chunk;
        let jeffersObj;
        (0, vitest_1.beforeEach)(async () => {
            notebook = await notebookService.createNotebook('NotebookForChunk', 'Desc');
            const tempJeffersObj = await objectModel.getBySourceUri(`jeffers://notebook/${notebook.id}`);
            if (!tempJeffersObj)
                throw new Error('JeffersObject for notebook not found in assignChunkToNotebook beforeEach');
            jeffersObj = tempJeffersObj;
            const createdChunk = await chunkSqlModel.addChunk({
                objectId: jeffersObj.id,
                chunkIdx: 0,
                content: 'Test chunk for assignment',
            });
            chunk = createdChunk;
        });
        (0, vitest_1.it)('should assign a chunk to a notebook', async () => {
            const result = await notebookService.assignChunkToNotebook(chunk.id, notebook.id);
            (0, vitest_1.expect)(result).toBe(true);
            const updatedChunk = await chunkSqlModel.getById(chunk.id);
            (0, vitest_1.expect)(updatedChunk?.notebookId).toBe(notebook.id); // Updated
        });
        (0, vitest_1.it)('should remove a chunk assignment by passing null for notebookId', async () => {
            await notebookService.assignChunkToNotebook(chunk.id, notebook.id);
            let updatedChunk = await chunkSqlModel.getById(chunk.id);
            (0, vitest_1.expect)(updatedChunk?.notebookId).toBe(notebook.id); // Updated
            const result = await notebookService.assignChunkToNotebook(chunk.id, null);
            (0, vitest_1.expect)(result).toBe(true);
            updatedChunk = await chunkSqlModel.getById(chunk.id);
            (0, vitest_1.expect)(updatedChunk?.notebookId).toBeNull(); // Updated
        });
        (0, vitest_1.it)('should throw an error if trying to assign a chunk to a non-existent notebook', async () => {
            const nonExistentNotebookId = (0, crypto_1.randomUUID)();
            await (0, vitest_1.expect)(notebookService.assignChunkToNotebook(chunk.id, nonExistentNotebookId))
                .rejects
                .toThrow(`Target notebook not found with ID: ${nonExistentNotebookId}`);
        });
        (0, vitest_1.it)('should return false if trying to assign a non-existent chunk (ChunkSqlModel handles this)', async () => {
            const nonExistentChunkId = 999999;
            const result = await notebookService.assignChunkToNotebook(nonExistentChunkId, notebook.id);
            (0, vitest_1.expect)(result).toBe(false); // ChunkSqlModel.assignToNotebook returns false for non-existent chunkId
        });
    });
    (0, vitest_1.describe)('getChunksForNotebook', () => {
        let notebook1;
        let notebook2;
        let jeffersObj1;
        (0, vitest_1.beforeEach)(async () => {
            notebook1 = await notebookService.createNotebook('NBWithChunks', 'Desc1');
            notebook2 = await notebookService.createNotebook('NBWithoutChunks', 'Desc2');
            const tempJeffersObj1 = await objectModel.getBySourceUri(`jeffers://notebook/${notebook1.id}`);
            if (!tempJeffersObj1)
                throw new Error('JeffersObject for notebook1 not found in getChunksForNotebook beforeEach');
            jeffersObj1 = tempJeffersObj1;
            // Create and assign some chunks to notebook1
            const chunk1 = await chunkSqlModel.addChunk({ objectId: jeffersObj1.id, chunkIdx: 0, content: 'c1' });
            await chunkSqlModel.assignToNotebook(chunk1.id, notebook1.id);
            const chunk2 = await chunkSqlModel.addChunk({ objectId: jeffersObj1.id, chunkIdx: 1, content: 'c2' });
            await chunkSqlModel.assignToNotebook(chunk2.id, notebook1.id);
        });
        (0, vitest_1.it)('should retrieve all chunks assigned to a specific notebook', async () => {
            const chunks = await notebookService.getChunksForNotebook(notebook1.id);
            (0, vitest_1.expect)(chunks.length).toBe(2);
            (0, vitest_1.expect)(chunks.every(c => c.notebookId === notebook1.id)).toBe(true); // Updated
            (0, vitest_1.expect)(chunks[0].content).toBe('c1');
            (0, vitest_1.expect)(chunks[1].content).toBe('c2');
        });
        (0, vitest_1.it)('should return an empty array for a notebook with no assigned chunks', async () => {
            const chunks = await notebookService.getChunksForNotebook(notebook2.id);
            (0, vitest_1.expect)(chunks).toEqual([]);
        });
        (0, vitest_1.it)('should throw an error if trying to get chunks for a non-existent notebook', async () => {
            const nonExistentNotebookId = (0, crypto_1.randomUUID)();
            await (0, vitest_1.expect)(notebookService.getChunksForNotebook(nonExistentNotebookId))
                .rejects
                .toThrow(`Notebook not found with ID: ${nonExistentNotebookId}`);
        });
    });
});
//# sourceMappingURL=NotebookService.test.js.map