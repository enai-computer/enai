"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const db_1 = require("./db");
const runMigrations_1 = __importDefault(require("./runMigrations"));
// Import ONLY the class
const ChatModel_1 = require("./ChatModel");
const NotebookModel_1 = require("./NotebookModel"); // Needed for creating prerequisite notebooks
const crypto_1 = require("crypto");
// Top-level declarations for DB and model instances
let db;
let chatModel;
let notebookModel;
let testNotebook; // A default notebook for most tests
const testDbPath = ':memory:';
(0, vitest_1.describe)('ChatModel Unit Tests', () => {
    // Setup: Create dedicated in-memory DB, run migrations, instantiate models before each test.
    (0, vitest_1.beforeEach)(async () => {
        // For better-sqlite3 in-memory, creating a new instance is the cleanest way.
        db = new better_sqlite3_1.default(testDbPath);
        (0, runMigrations_1.default)(db);
        chatModel = new ChatModel_1.ChatModel(db);
        notebookModel = new NotebookModel_1.NotebookModel(db);
        // Create a default notebook for tests that need a valid notebook_id
        const notebookId = (0, crypto_1.randomUUID)();
        testNotebook = await notebookModel.create(notebookId, 'Test Default Notebook', 'For chat tests');
    });
    // Teardown: Close DB connection after each test
    (0, vitest_1.afterEach)(() => {
        (0, db_1.closeDb)();
    });
    // --- Original Test Cases (Now Nested and Using Correct Scoped Variables) ---
    (0, vitest_1.describe)('Legacy Core Functionality (createSession, addMessage, getMessages)', () => {
        (0, vitest_1.it)('should create a session, add messages, and retrieve them', async () => {
            const newSession = await chatModel.createSession(testNotebook.id);
            const sessionId = newSession.session_id;
            (0, vitest_1.expect)(sessionId).toBeDefined();
            (0, vitest_1.expect)(sessionId).toMatch(/^[0-9a-f\-]{36}$/i);
            const sessionRow = db.prepare('SELECT * FROM chat_sessions WHERE session_id = ?').get(sessionId);
            (0, vitest_1.expect)(sessionRow).toBeDefined();
            (0, vitest_1.expect)(sessionRow.title).toBeNull();
            const userMessageData = {
                session_id: sessionId,
                role: 'user',
                content: 'Hello, assistant!',
                metadata: null // Corrected metadata
            };
            const userMessage = await chatModel.addMessage(userMessageData);
            (0, vitest_1.expect)(userMessage.message_id).toMatch(/^[0-9a-f\-]{36}$/i);
            (0, vitest_1.expect)(userMessage.session_id).toBe(sessionId);
            (0, vitest_1.expect)(userMessage.role).toBe('user');
            (0, vitest_1.expect)(userMessage.content).toBe(userMessageData.content);
            (0, vitest_1.expect)(userMessage.metadata).toBeNull();
            await new Promise(resolve => setTimeout(resolve, 5));
            const assistantMessageData = {
                session_id: sessionId,
                role: 'assistant',
                content: 'Hello, user! How can I help?',
                // metadata will be undefined, thus stored as null by ChatModel
            };
            const assistantMessage = await chatModel.addMessage(assistantMessageData);
            (0, vitest_1.expect)(assistantMessage.message_id).toMatch(/^[0-9a-f\-]{36}$/i);
            (0, vitest_1.expect)(assistantMessage.metadata).toBeNull();
            const messagesFromDb = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);
            (0, vitest_1.expect)(messagesFromDb).toHaveLength(2);
            (0, vitest_1.expect)(messagesFromDb[0].role).toBe('user');
            (0, vitest_1.expect)(messagesFromDb[0].content).toBe(userMessageData.content);
            (0, vitest_1.expect)(messagesFromDb[0].metadata).toBeNull();
            (0, vitest_1.expect)(messagesFromDb[1].role).toBe('assistant');
            (0, vitest_1.expect)(messagesFromDb[1].content).toBe(assistantMessageData.content);
            (0, vitest_1.expect)(messagesFromDb[1].metadata).toBeNull();
            const retrievedMessages = await chatModel.getMessages(sessionId);
            (0, vitest_1.expect)(retrievedMessages).toBeDefined();
            (0, vitest_1.expect)(retrievedMessages).toBeInstanceOf(Array);
            (0, vitest_1.expect)(retrievedMessages).toHaveLength(2);
            (0, vitest_1.expect)(retrievedMessages[0].message_id).toBe(userMessage.message_id);
            (0, vitest_1.expect)(retrievedMessages[1].message_id).toBe(assistantMessage.message_id);
            (0, vitest_1.expect)(retrievedMessages[0].role).toBe('user');
            (0, vitest_1.expect)(retrievedMessages[1].role).toBe('assistant');
            (0, vitest_1.expect)(retrievedMessages[0].metadata).toBeNull();
            (0, vitest_1.expect)(retrievedMessages[1].metadata).toBeNull();
        });
        (0, vitest_1.it)('should update a session title (legacy test structure)', async () => {
            const newSession = await chatModel.createSession(testNotebook.id);
            const sessionId = newSession.session_id;
            const newTitle = "Updated Session Title";
            await chatModel.updateSessionTitle(sessionId, newTitle);
            const sessionRow = db.prepare('SELECT title, updated_at FROM chat_sessions WHERE session_id = ?').get(sessionId);
            (0, vitest_1.expect)(sessionRow).toBeDefined();
            (0, vitest_1.expect)(sessionRow.title).toBe(newTitle);
            const createdAt = new Date(newSession.created_at).getTime();
            const updatedAt = new Date(sessionRow.updated_at).getTime();
            (0, vitest_1.expect)(updatedAt).toBeGreaterThanOrEqual(createdAt);
        });
        (0, vitest_1.it)('should list sessions ordered by updated_at descending (legacy test structure)', async () => {
            const session1 = await chatModel.createSession(testNotebook.id);
            await new Promise(resolve => setTimeout(resolve, 10));
            const session2 = await chatModel.createSession(testNotebook.id);
            await new Promise(resolve => setTimeout(resolve, 10));
            await chatModel.addMessage({ session_id: session1.session_id, role: 'user', content: 'Update S1', metadata: null });
            const sessions = await chatModel.listSessions();
            (0, vitest_1.expect)(sessions).toHaveLength(2);
            // S1 was updated last because of the message, so it should appear first
            (0, vitest_1.expect)(sessions[0].session_id).toBe(session1.session_id);
            (0, vitest_1.expect)(sessions[1].session_id).toBe(session2.session_id);
        });
        (0, vitest_1.it)('should get messages with limit (legacy test structure)', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            await chatModel.addMessage({ session_id: session.session_id, role: 'user', content: 'Msg 1', metadata: null });
            await new Promise(resolve => setTimeout(resolve, 5));
            const msg2 = await chatModel.addMessage({ session_id: session.session_id, role: 'assistant', content: 'Msg 2', metadata: null });
            await new Promise(resolve => setTimeout(resolve, 5));
            const msg3 = await chatModel.addMessage({ session_id: session.session_id, role: 'user', content: 'Msg 3', metadata: null });
            const messages = await chatModel.getMessages(session.session_id, 2);
            (0, vitest_1.expect)(messages).toHaveLength(2);
            (0, vitest_1.expect)(messages[0].message_id).toBe(msg2.message_id);
            (0, vitest_1.expect)(messages[1].message_id).toBe(msg3.message_id);
        });
        (0, vitest_1.it)('should get messages before a timestamp (legacy test structure)', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            const msg1 = await chatModel.addMessage({ session_id: session.session_id, role: 'user', content: 'Msg 1', metadata: null });
            await new Promise(resolve => setTimeout(resolve, 5));
            const msg2 = await chatModel.addMessage({ session_id: session.session_id, role: 'assistant', content: 'Msg 2', metadata: null });
            await new Promise(resolve => setTimeout(resolve, 5));
            await chatModel.addMessage({ session_id: session.session_id, role: 'user', content: 'Msg 3', metadata: null });
            const messages = await chatModel.getMessages(session.session_id, undefined, msg2.timestamp);
            (0, vitest_1.expect)(messages).toHaveLength(1);
            (0, vitest_1.expect)(messages[0].message_id).toBe(msg1.message_id);
        });
        (0, vitest_1.it)('should delete a session and its messages (legacy test structure)', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            await chatModel.addMessage({ session_id: session.session_id, role: 'user', content: 'Hello', metadata: null });
            await chatModel.deleteSession(session.session_id);
            const deletedSession = await chatModel.getSession(session.session_id);
            (0, vitest_1.expect)(deletedSession).toBeNull();
            const deletedMessages = await chatModel.getMessages(session.session_id);
            (0, vitest_1.expect)(deletedMessages).toHaveLength(0);
            const sessionRow = db.prepare('SELECT 1 FROM chat_sessions WHERE session_id = ?').get(session.session_id);
            (0, vitest_1.expect)(sessionRow).toBeUndefined();
            const messageRows = db.prepare('SELECT 1 FROM chat_messages WHERE session_id = ?').all(session.session_id);
            (0, vitest_1.expect)(messageRows).toHaveLength(0);
        });
    });
    (0, vitest_1.describe)('createSession', () => {
        (0, vitest_1.it)('should create a new chat session with a notebookId and title', async () => {
            const title = 'My Test Session';
            const session = await chatModel.createSession(testNotebook.id, undefined, title);
            (0, vitest_1.expect)(session).toBeDefined();
            (0, vitest_1.expect)(session.notebook_id).toBe(testNotebook.id);
            (0, vitest_1.expect)(session.title).toBe(title);
            (0, vitest_1.expect)(new Date(session.created_at).getTime()).toBeLessThanOrEqual(Date.now());
            (0, vitest_1.expect)(session.created_at).toBe(session.updated_at);
        });
        (0, vitest_1.it)('should create a new chat session with notebookId and null title if not provided', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            (0, vitest_1.expect)(session.title).toBeNull();
        });
        (0, vitest_1.it)('should create a new chat session with a provided sessionId', async () => {
            const explicitSessionId = (0, crypto_1.randomUUID)();
            const title = 'Explicit ID Session';
            const session = await chatModel.createSession(testNotebook.id, explicitSessionId, title);
            (0, vitest_1.expect)(session.session_id).toBe(explicitSessionId);
        });
        (0, vitest_1.it)('should return the existing session if creating with an existing sessionId for the SAME notebookId', async () => {
            const explicitSessionId = (0, crypto_1.randomUUID)();
            const firstSession = await chatModel.createSession(testNotebook.id, explicitSessionId, 'First');
            const secondAttempt = await chatModel.createSession(testNotebook.id, explicitSessionId, 'Second Attempt Title (should be ignored)');
            (0, vitest_1.expect)(secondAttempt.session_id).toBe(firstSession.session_id);
            (0, vitest_1.expect)(secondAttempt.title).toBe('First');
        });
        (0, vitest_1.it)('should throw an error if creating with an existing sessionId but for a DIFFERENT notebookId', async () => {
            const explicitSessionId = (0, crypto_1.randomUUID)();
            await chatModel.createSession(testNotebook.id, explicitSessionId, 'Original Session');
            const anotherNotebook = await notebookModel.create((0, crypto_1.randomUUID)(), 'Another Notebook', 'Desc');
            await (0, vitest_1.expect)(chatModel.createSession(anotherNotebook.id, explicitSessionId, 'Conflicting Session'))
                .rejects
                .toThrow(`Session ID ${explicitSessionId} conflict: already exists in a different notebook.`);
        });
        (0, vitest_1.it)('should throw an error if notebookId does not exist (FOREIGN KEY constraint)', async () => {
            const nonExistentNotebookId = (0, crypto_1.randomUUID)();
            await (0, vitest_1.expect)(chatModel.createSession(nonExistentNotebookId, undefined, 'Session for invalid NB'))
                .rejects
                .toThrow(`Failed to create chat session: Invalid notebook ID ${nonExistentNotebookId}.`);
        });
    });
    (0, vitest_1.describe)('getSession', () => {
        (0, vitest_1.it)('should retrieve an existing session by its ID', async () => {
            const createdSession = await chatModel.createSession(testNotebook.id, undefined, 'SessionToGet');
            const fetchedSession = await chatModel.getSession(createdSession.session_id);
            (0, vitest_1.expect)(fetchedSession).toBeDefined();
            (0, vitest_1.expect)(fetchedSession?.session_id).toBe(createdSession.session_id);
            (0, vitest_1.expect)(fetchedSession?.title).toBe('SessionToGet');
            (0, vitest_1.expect)(fetchedSession?.notebook_id).toBe(testNotebook.id);
        });
        (0, vitest_1.it)('should return null if no session exists with the given ID', async () => {
            const nonExistentSessionId = (0, crypto_1.randomUUID)();
            const fetchedSession = await chatModel.getSession(nonExistentSessionId);
            (0, vitest_1.expect)(fetchedSession).toBeNull();
        });
    });
    (0, vitest_1.describe)('updateSessionTitle', () => {
        (0, vitest_1.it)('should update the title and updated_at timestamp of an existing session', async () => {
            const session = await chatModel.createSession(testNotebook.id, undefined, 'Original Title');
            const originalUpdatedAt = new Date(session.updated_at).getTime();
            const newTitle = "New Awesome Title";
            await new Promise(resolve => setTimeout(resolve, 50));
            await chatModel.updateSessionTitle(session.session_id, newTitle);
            const updatedSession = await chatModel.getSession(session.session_id);
            (0, vitest_1.expect)(updatedSession?.title).toBe(newTitle);
            (0, vitest_1.expect)(new Date(updatedSession.updated_at).getTime()).toBeGreaterThan(originalUpdatedAt);
        });
        (0, vitest_1.it)('should not throw when updating title of a non-existent session (no rows affected)', async () => {
            const nonExistentSessionId = (0, crypto_1.randomUUID)();
            await (0, vitest_1.expect)(chatModel.updateSessionTitle(nonExistentSessionId, 'No Session Here')).resolves.not.toThrow();
            const attemptToFetch = await chatModel.getSession(nonExistentSessionId);
            (0, vitest_1.expect)(attemptToFetch).toBeNull();
        });
    });
    (0, vitest_1.describe)('listSessions (Newer tests, ensuring proper isolation)', () => {
        (0, vitest_1.it)('should return an empty array if no sessions exist', async () => {
            // beforeEach already cleans and sets up one testNotebook. Delete its sessions if any.
            const sessionsFromDefaultNB = await chatModel.listSessionsForNotebook(testNotebook.id);
            for (const s of sessionsFromDefaultNB)
                await chatModel.deleteSession(s.session_id);
            // Ensure all sessions are gone from all notebooks before testing listSessions
            db.exec('DELETE FROM chat_sessions;');
            const sessions = await chatModel.listSessions();
            (0, vitest_1.expect)(sessions).toEqual([]);
        });
        // The existing test 'should list sessions ordered by updated_at descending (legacy test structure)' 
        // in the 'Legacy Core Functionality' block already covers the non-empty case.
    });
    (0, vitest_1.describe)('listSessionsForNotebook', () => {
        let notebook2;
        (0, vitest_1.beforeEach)(async () => {
            // This beforeEach is nested, so it runs AFTER the top-level beforeEach.
            // testNotebook is already created.
            notebook2 = await notebookModel.create((0, crypto_1.randomUUID)(), 'Notebook Two', 'For specific listing');
            // Create sessions for testNotebook (default)
            await chatModel.createSession(testNotebook.id, undefined, 'Chat 1 NB1');
            // Create a session for notebook2
            await chatModel.createSession(notebook2.id, undefined, 'Chat 1 NB2');
            // Create another session for testNotebook to test listing multiple from one NB
            await chatModel.createSession(testNotebook.id, undefined, 'Chat 2 NB1');
        });
        (0, vitest_1.it)('should list all sessions for a specific notebook', async () => {
            const sessionsForNb1 = await chatModel.listSessionsForNotebook(testNotebook.id);
            (0, vitest_1.expect)(sessionsForNb1.length).toBe(2); // testNotebook should have 2 sessions now
            sessionsForNb1.forEach(s => (0, vitest_1.expect)(s.notebook_id).toBe(testNotebook.id));
            const sessionsForNb2 = await chatModel.listSessionsForNotebook(notebook2.id);
            (0, vitest_1.expect)(sessionsForNb2.length).toBe(1);
            (0, vitest_1.expect)(sessionsForNb2[0].notebook_id).toBe(notebook2.id);
            (0, vitest_1.expect)(sessionsForNb2[0].title).toBe('Chat 1 NB2');
        });
        (0, vitest_1.it)('should return an empty array for a notebook with no sessions', async () => {
            const notebook3 = await notebookModel.create((0, crypto_1.randomUUID)(), 'Notebook Three (No Chats)', 'Desc');
            const sessions = await chatModel.listSessionsForNotebook(notebook3.id);
            (0, vitest_1.expect)(sessions).toEqual([]);
        });
        (0, vitest_1.it)('should return an empty array for a non-existent notebook ID (no error thrown by model)', async () => {
            const nonExistentNotebookId = (0, crypto_1.randomUUID)();
            const sessions = await chatModel.listSessionsForNotebook(nonExistentNotebookId);
            (0, vitest_1.expect)(sessions).toEqual([]);
        });
    });
    (0, vitest_1.describe)('updateChatNotebook', () => {
        let sessionToMove;
        let targetNotebook;
        (0, vitest_1.beforeEach)(async () => {
            sessionToMove = await chatModel.createSession(testNotebook.id, undefined, 'Session to be Moved');
            targetNotebook = await notebookModel.create((0, crypto_1.randomUUID)(), 'Target Notebook', 'For session transfer');
        });
        (0, vitest_1.it)('should update the notebook_id and updated_at for a session', async () => {
            const originalUpdatedAt = new Date(sessionToMove.updated_at).getTime();
            await new Promise(resolve => setTimeout(resolve, 50)); // Ensure time passes
            const result = await chatModel.updateChatNotebook(sessionToMove.session_id, targetNotebook.id);
            (0, vitest_1.expect)(result).toBe(true);
            const updatedSession = await chatModel.getSession(sessionToMove.session_id);
            (0, vitest_1.expect)(updatedSession?.notebook_id).toBe(targetNotebook.id);
            (0, vitest_1.expect)(new Date(updatedSession.updated_at).getTime()).toBeGreaterThan(originalUpdatedAt);
        });
        (0, vitest_1.it)('should return false if the session ID does not exist', async () => {
            const nonExistentSessionId = (0, crypto_1.randomUUID)();
            const result = await chatModel.updateChatNotebook(nonExistentSessionId, targetNotebook.id);
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should throw an error if the target notebook ID does not exist (FOREIGN KEY constraint)', async () => {
            const nonExistentNotebookId = (0, crypto_1.randomUUID)();
            await (0, vitest_1.expect)(chatModel.updateChatNotebook(sessionToMove.session_id, nonExistentNotebookId))
                .rejects
                .toThrow(); // The model actually throws: 'FOREIGN KEY constraint failed' or a wrapped one
        });
    });
    // --- AddMessage specific tests ---
    (0, vitest_1.describe)('addMessage', () => {
        let sessionId;
        (0, vitest_1.beforeEach)(async () => {
            const session = await chatModel.createSession(testNotebook.id);
            sessionId = session.session_id;
        });
        (0, vitest_1.it)('should add a message with valid ChatMessageSourceMetadata', async () => {
            const metadata = { sourceChunkIds: [10, 20] };
            const message = await chatModel.addMessage({ session_id: sessionId, role: 'user', content: 'With metadata', metadata });
            (0, vitest_1.expect)(message.message_id).toEqual(vitest_1.expect.any(String));
            (0, vitest_1.expect)(message.timestamp).toEqual(vitest_1.expect.any(String));
            (0, vitest_1.expect)(message.metadata).toBe(JSON.stringify(metadata));
            const dbSession = await chatModel.getSession(sessionId);
            // Check if session's updated_at matches the message timestamp (or is very close)
            // This relies on the transaction behavior in addMessage
            (0, vitest_1.expect)(new Date(dbSession.updated_at).getTime()).toBeCloseTo(new Date(message.timestamp).getTime(), 5);
        });
        (0, vitest_1.it)('should add a message with null metadata', async () => {
            const message = await chatModel.addMessage({ session_id: sessionId, role: 'assistant', content: 'No metadata', metadata: null });
            (0, vitest_1.expect)(message.metadata).toBeNull();
        });
        (0, vitest_1.it)('should add a message with undefined metadata (becomes null in DB)', async () => {
            const message = await chatModel.addMessage({ session_id: sessionId, role: 'user', content: 'Undefined metadata' }); // metadata is undefined
            (0, vitest_1.expect)(message.metadata).toBeNull();
        });
        (0, vitest_1.it)('should update the session updated_at timestamp when a message is added', async () => {
            const session = await chatModel.getSession(sessionId);
            const initialSessionUpdate = new Date(session.updated_at).getTime();
            await new Promise(resolve => setTimeout(resolve, 50));
            const newMessage = await chatModel.addMessage({ session_id: sessionId, role: 'user', content: 'Test message for timestamp' });
            const updatedSession = await chatModel.getSession(sessionId);
            const messageTimestamp = new Date(newMessage.timestamp).getTime();
            const finalSessionUpdate = new Date(updatedSession.updated_at).getTime();
            (0, vitest_1.expect)(finalSessionUpdate).toBeGreaterThan(initialSessionUpdate);
            // The session update should ideally match the message timestamp due to the transaction
            (0, vitest_1.expect)(finalSessionUpdate).toBeCloseTo(messageTimestamp);
        });
        (0, vitest_1.it)('should throw an error if trying to add a message to a non-existent session', async () => {
            const nonExistentSessionId = (0, crypto_1.randomUUID)();
            await (0, vitest_1.expect)(chatModel.addMessage({ session_id: nonExistentSessionId, role: 'user', content: 'msg' }))
                .rejects.toThrow(); // FOREIGN KEY constraint
        });
    });
    // --- GetMessages specific tests ---
    (0, vitest_1.describe)('getMessages', () => {
        let sessionId;
        let msg1, msg2, msg3;
        let msgWithMeta;
        (0, vitest_1.beforeEach)(async () => {
            const session = await chatModel.createSession(testNotebook.id);
            sessionId = session.session_id;
            msg1 = await chatModel.addMessage({ session_id: sessionId, role: 'user', content: 'Message 1' });
            await new Promise(resolve => setTimeout(resolve, 5));
            msgWithMeta = await chatModel.addMessage({
                session_id: sessionId,
                role: 'assistant',
                content: 'Message 2 with Meta',
                metadata: { sourceChunkIds: [5] }
            });
            await new Promise(resolve => setTimeout(resolve, 5));
            msg2 = msgWithMeta; // Alias for some tests
            msg3 = await chatModel.addMessage({ session_id: sessionId, role: 'user', content: 'Message 3' });
        });
        (0, vitest_1.it)('should retrieve all messages for a session in ascending order', async () => {
            const messages = await chatModel.getMessages(sessionId);
            (0, vitest_1.expect)(messages.length).toBe(3);
            (0, vitest_1.expect)(messages[0].message_id).toBe(msg1.message_id);
            (0, vitest_1.expect)(messages[1].message_id).toBe(msgWithMeta.message_id);
            (0, vitest_1.expect)(messages[2].message_id).toBe(msg3.message_id);
        });
        (0, vitest_1.it)('should retrieve messages with limit (most recent if default DESC then reversed)', async () => {
            const messages = await chatModel.getMessages(sessionId, 2);
            (0, vitest_1.expect)(messages.length).toBe(2);
            // Model fetches DESC then reverses, so limit 2 = last 2 ([msg3, msgWithMeta]), then reversed = [msgWithMeta, msg3]
            (0, vitest_1.expect)(messages[0].message_id).toBe(msgWithMeta.message_id);
            (0, vitest_1.expect)(messages[1].message_id).toBe(msg3.message_id);
        });
        (0, vitest_1.it)('should retrieve messages before a timestamp', async () => {
            const messages = await chatModel.getMessages(sessionId, undefined, msgWithMeta.timestamp); // Before msgWithMeta
            (0, vitest_1.expect)(messages).toHaveLength(1);
            (0, vitest_1.expect)(messages[0].message_id).toBe(msg1.message_id);
        });
        (0, vitest_1.it)('should retrieve messages with limit and before a timestamp', async () => {
            // Insert msg0 directly with an older timestamp
            const olderTimestamp = new Date(new Date(msg1.timestamp).getTime() - 1000).toISOString();
            const insertStmt = db.prepare(`INSERT INTO chat_messages (message_id, session_id, timestamp, role, content, metadata)
                                           VALUES (?, ?, ?, ?, ?, ?)`);
            const msg0_id = (0, crypto_1.randomUUID)();
            insertStmt.run(msg0_id, sessionId, olderTimestamp, 'user', 'Message 0', null);
            // Get 1 message before msgWithMeta.timestamp
            const messages = await chatModel.getMessages(sessionId, 1, msgWithMeta.timestamp);
            (0, vitest_1.expect)(messages.length).toBe(1);
            // The latest message before msgWithMeta is msg1
            (0, vitest_1.expect)(messages[0].message_id).toBe(msg1.message_id);
        });
        (0, vitest_1.it)('should return empty array for a session with no messages', async () => {
            const newSession = await chatModel.createSession(testNotebook.id);
            const messages = await chatModel.getMessages(newSession.session_id);
            (0, vitest_1.expect)(messages).toEqual([]);
        });
        (0, vitest_1.it)('should return messages with metadata as JSON string or null', async () => {
            const messages = await chatModel.getMessages(sessionId);
            const message1 = messages.find(m => m.message_id === msg1.message_id);
            const messageWithMeta = messages.find(m => m.message_id === msgWithMeta.message_id);
            (0, vitest_1.expect)(message1?.metadata).toBeNull();
            (0, vitest_1.expect)(messageWithMeta?.metadata).toBe(JSON.stringify({ sourceChunkIds: [5] }));
        });
    });
    // --- DeleteSession specific tests ---
    (0, vitest_1.describe)('deleteSession', () => {
        (0, vitest_1.it)('should delete a session and all its associated messages (CASCADE)', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            await chatModel.addMessage({ session_id: session.session_id, role: 'user', content: 'Message to be deleted' });
            const msgId = (await chatModel.getMessages(session.session_id))[0].message_id;
            // Verify message exists before delete
            const msgBefore = db.prepare('SELECT 1 FROM chat_messages WHERE message_id = ?').get(msgId);
            (0, vitest_1.expect)(msgBefore).toBeDefined();
            await chatModel.deleteSession(session.session_id);
            const deletedSession = await chatModel.getSession(session.session_id);
            (0, vitest_1.expect)(deletedSession).toBeNull();
            const messagesAfter = await chatModel.getMessages(session.session_id);
            (0, vitest_1.expect)(messagesAfter.length).toBe(0);
            // Verify message is gone from DB due to cascade
            const msgAfter = db.prepare('SELECT 1 FROM chat_messages WHERE message_id = ?').get(msgId);
            (0, vitest_1.expect)(msgAfter).toBeUndefined();
        });
        (0, vitest_1.it)('should not throw when deleting a non-existent session', async () => {
            await (0, vitest_1.expect)(chatModel.deleteSession((0, crypto_1.randomUUID)())).resolves.not.toThrow();
        });
    });
});
//# sourceMappingURL=ChatModel.test.js.map