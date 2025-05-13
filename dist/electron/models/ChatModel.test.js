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
            const sessionId = newSession.sessionId;
            (0, vitest_1.expect)(sessionId).toBeDefined();
            (0, vitest_1.expect)(sessionId).toMatch(/^[0-9a-f\-]{36}$/i);
            const sessionRow = db.prepare('SELECT * FROM chat_sessions WHERE session_id = ?').get(sessionId);
            (0, vitest_1.expect)(sessionRow).toBeDefined();
            (0, vitest_1.expect)(sessionRow.title).toBeNull();
            const userMessageData = {
                sessionId: sessionId,
                role: 'user',
                content: 'Hello, assistant!',
                metadata: null
            };
            const userMessage = await chatModel.addMessage(userMessageData);
            (0, vitest_1.expect)(userMessage.messageId).toMatch(/^[0-9a-f\-]{36}$/i);
            (0, vitest_1.expect)(userMessage.sessionId).toBe(sessionId);
            (0, vitest_1.expect)(userMessage.role).toBe('user');
            (0, vitest_1.expect)(userMessage.content).toBe(userMessageData.content);
            (0, vitest_1.expect)(userMessage.metadata).toBeNull();
            await new Promise(resolve => setTimeout(resolve, 5));
            const assistantMessageData = {
                sessionId: sessionId,
                role: 'assistant',
                content: 'Hello, user! How can I help?',
            };
            const assistantMessage = await chatModel.addMessage(assistantMessageData);
            (0, vitest_1.expect)(assistantMessage.messageId).toMatch(/^[0-9a-f\-]{36}$/i);
            (0, vitest_1.expect)(assistantMessage.metadata).toBeNull();
            const messagesFromDb = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);
            (0, vitest_1.expect)(messagesFromDb).toHaveLength(2);
            (0, vitest_1.expect)(messagesFromDb[0].role).toBe('user');
            (0, vitest_1.expect)(messagesFromDb[0].content).toBe(userMessageData.content);
            (0, vitest_1.expect)(messagesFromDb[0].metadata).toBeNull();
            (0, vitest_1.expect)(messagesFromDb[1].role).toBe('assistant');
            (0, vitest_1.expect)(messagesFromDb[1].content).toBe(assistantMessageData.content);
            (0, vitest_1.expect)(messagesFromDb[1].metadata).toBeNull();
            const retrievedMessages = await chatModel.getMessagesBySessionId(sessionId);
            (0, vitest_1.expect)(retrievedMessages).toBeDefined();
            (0, vitest_1.expect)(retrievedMessages).toBeInstanceOf(Array);
            (0, vitest_1.expect)(retrievedMessages).toHaveLength(2);
            (0, vitest_1.expect)(retrievedMessages[0].messageId).toBe(userMessage.messageId);
            (0, vitest_1.expect)(retrievedMessages[1].messageId).toBe(assistantMessage.messageId);
            (0, vitest_1.expect)(retrievedMessages[0].role).toBe('user');
            (0, vitest_1.expect)(retrievedMessages[1].role).toBe('assistant');
            (0, vitest_1.expect)(retrievedMessages[0].metadata).toBeNull();
            (0, vitest_1.expect)(retrievedMessages[1].metadata).toBeNull();
        });
        (0, vitest_1.it)('should update a session title (legacy test structure)', async () => {
            const newSession = await chatModel.createSession(testNotebook.id);
            const sessionId = newSession.sessionId;
            const newTitle = "Updated Session Title";
            await chatModel.updateSessionTitle(sessionId, newTitle);
            const sessionRow = db.prepare('SELECT title, updated_at FROM chat_sessions WHERE session_id = ?').get(sessionId);
            (0, vitest_1.expect)(sessionRow).toBeDefined();
            (0, vitest_1.expect)(sessionRow.title).toBe(newTitle);
            const createdAt = new Date(newSession.createdAt).getTime();
            const updatedAt = new Date(sessionRow.updated_at).getTime();
            (0, vitest_1.expect)(updatedAt).toBeGreaterThanOrEqual(createdAt);
        });
        (0, vitest_1.it)('should list sessions ordered by updated_at descending (legacy test structure)', async () => {
            const session1 = await chatModel.createSession(testNotebook.id);
            await new Promise(resolve => setTimeout(resolve, 10));
            const session2 = await chatModel.createSession(testNotebook.id);
            await new Promise(resolve => setTimeout(resolve, 10));
            await chatModel.addMessage({ sessionId: session1.sessionId, role: 'user', content: 'Update S1', metadata: null });
            const sessions = await chatModel.listSessions();
            (0, vitest_1.expect)(sessions).toHaveLength(2);
            // S1 was updated last because of the message, so it should appear first
            (0, vitest_1.expect)(sessions[0].sessionId).toBe(session1.sessionId);
            (0, vitest_1.expect)(sessions[1].sessionId).toBe(session2.sessionId);
        });
        (0, vitest_1.it)('should get messages with limit (legacy test structure)', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            await chatModel.addMessage({ sessionId: session.sessionId, role: 'user', content: 'Msg 1', metadata: null });
            await new Promise(resolve => setTimeout(resolve, 5));
            const msg2 = await chatModel.addMessage({ sessionId: session.sessionId, role: 'assistant', content: 'Msg 2', metadata: null });
            await new Promise(resolve => setTimeout(resolve, 5));
            const msg3 = await chatModel.addMessage({ sessionId: session.sessionId, role: 'user', content: 'Msg 3', metadata: null });
            const messages = await chatModel.getMessagesBySessionId(session.sessionId, 2);
            (0, vitest_1.expect)(messages).toHaveLength(2);
            (0, vitest_1.expect)(messages[0].messageId).toBe(msg2.messageId);
            (0, vitest_1.expect)(messages[1].messageId).toBe(msg3.messageId);
        });
        (0, vitest_1.it)('should get messages before a timestamp (legacy test structure)', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            const msg1 = await chatModel.addMessage({ sessionId: session.sessionId, role: 'user', content: 'Msg 1', metadata: null });
            await new Promise(resolve => setTimeout(resolve, 5));
            const msg2 = await chatModel.addMessage({ sessionId: session.sessionId, role: 'assistant', content: 'Msg 2', metadata: null });
            await new Promise(resolve => setTimeout(resolve, 5));
            await chatModel.addMessage({ sessionId: session.sessionId, role: 'user', content: 'Msg 3', metadata: null });
            const messages = await chatModel.getMessagesBySessionId(session.sessionId, undefined, msg2.timestamp);
            (0, vitest_1.expect)(messages).toHaveLength(1);
            (0, vitest_1.expect)(messages[0].messageId).toBe(msg1.messageId);
        });
        (0, vitest_1.it)('should delete a session and its messages (legacy test structure)', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            await chatModel.addMessage({ sessionId: session.sessionId, role: 'user', content: 'Hello', metadata: null });
            await chatModel.deleteSession(session.sessionId);
            const deletedSession = await chatModel.getSessionById(session.sessionId);
            (0, vitest_1.expect)(deletedSession).toBeNull();
            const deletedMessages = await chatModel.getMessagesBySessionId(session.sessionId);
            (0, vitest_1.expect)(deletedMessages).toHaveLength(0);
            const sessionRow = db.prepare('SELECT 1 FROM chat_sessions WHERE session_id = ?').get(session.sessionId);
            (0, vitest_1.expect)(sessionRow).toBeUndefined();
            const messageRows = db.prepare('SELECT 1 FROM chat_messages WHERE session_id = ?').all(session.sessionId);
            (0, vitest_1.expect)(messageRows).toHaveLength(0);
        });
    });
    (0, vitest_1.describe)('createSession', () => {
        (0, vitest_1.it)('should create a new chat session with a notebookId and title', async () => {
            const title = 'My Test Session';
            const session = await chatModel.createSession(testNotebook.id, undefined, title);
            (0, vitest_1.expect)(session).toBeDefined();
            (0, vitest_1.expect)(session.notebookId).toBe(testNotebook.id);
            (0, vitest_1.expect)(session.title).toBe(title);
            (0, vitest_1.expect)(session.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
            (0, vitest_1.expect)(session.createdAt.getTime()).toBe(session.updatedAt.getTime());
        });
        (0, vitest_1.it)('should create a new chat session with notebookId and null title if not provided', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            (0, vitest_1.expect)(session.title).toBeNull();
        });
        (0, vitest_1.it)('should create a new chat session with a provided sessionId', async () => {
            const explicitSessionId = (0, crypto_1.randomUUID)();
            const title = 'Explicit ID Session';
            const session = await chatModel.createSession(testNotebook.id, explicitSessionId, title);
            (0, vitest_1.expect)(session.sessionId).toBe(explicitSessionId);
        });
        (0, vitest_1.it)('should return the existing session if creating with an existing sessionId for the SAME notebookId', async () => {
            const explicitSessionId = (0, crypto_1.randomUUID)();
            const firstSession = await chatModel.createSession(testNotebook.id, explicitSessionId, 'First');
            const secondAttempt = await chatModel.createSession(testNotebook.id, explicitSessionId, 'Second Attempt Title (should be ignored)');
            (0, vitest_1.expect)(secondAttempt.sessionId).toBe(firstSession.sessionId);
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
    (0, vitest_1.describe)('getSessionById', () => {
        (0, vitest_1.it)('should retrieve an existing session by its ID', async () => {
            const createdSession = await chatModel.createSession(testNotebook.id, undefined, 'SessionToGet');
            const fetchedSession = await chatModel.getSessionById(createdSession.sessionId);
            (0, vitest_1.expect)(fetchedSession).toBeDefined();
            (0, vitest_1.expect)(fetchedSession?.sessionId).toBe(createdSession.sessionId);
            (0, vitest_1.expect)(fetchedSession?.title).toBe('SessionToGet');
            (0, vitest_1.expect)(fetchedSession?.notebookId).toBe(testNotebook.id);
        });
        (0, vitest_1.it)('should return null if no session exists with the given ID', async () => {
            const nonExistentSessionId = (0, crypto_1.randomUUID)();
            const fetchedSession = await chatModel.getSessionById(nonExistentSessionId);
            (0, vitest_1.expect)(fetchedSession).toBeNull();
        });
    });
    (0, vitest_1.describe)('updateSessionTitle', () => {
        (0, vitest_1.it)('should update the title and updated_at timestamp of an existing session', async () => {
            const session = await chatModel.createSession(testNotebook.id, undefined, 'Original Title');
            const originalUpdatedAt = session.updatedAt.getTime();
            const newTitle = "New Awesome Title";
            await new Promise(resolve => setTimeout(resolve, 50));
            const updatedSessionResult = await chatModel.updateSessionTitle(session.sessionId, newTitle);
            (0, vitest_1.expect)(updatedSessionResult).toBeDefined();
            (0, vitest_1.expect)(updatedSessionResult?.title).toBe(newTitle);
            (0, vitest_1.expect)(updatedSessionResult.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt);
        });
        (0, vitest_1.it)('should not throw when updating title of a non-existent session (no rows affected)', async () => {
            const nonExistentSessionId = (0, crypto_1.randomUUID)();
            const result = await chatModel.updateSessionTitle(nonExistentSessionId, 'No Session Here');
            (0, vitest_1.expect)(result).toBeNull();
            const attemptToFetch = await chatModel.getSessionById(nonExistentSessionId);
            (0, vitest_1.expect)(attemptToFetch).toBeNull();
        });
    });
    (0, vitest_1.describe)('listSessions (Newer tests, ensuring proper isolation)', () => {
        (0, vitest_1.it)('should return an empty array if no sessions exist', async () => {
            const sessionsFromDefaultNB = await chatModel.listSessionsForNotebook(testNotebook.id);
            for (const s of sessionsFromDefaultNB)
                await chatModel.deleteSession(s.sessionId);
            db.exec('DELETE FROM chat_sessions;');
            const sessions = await chatModel.listSessions();
            (0, vitest_1.expect)(sessions).toEqual([]);
        });
    });
    (0, vitest_1.describe)('listSessionsForNotebook', () => {
        let notebook2;
        (0, vitest_1.beforeEach)(async () => {
            notebook2 = await notebookModel.create((0, crypto_1.randomUUID)(), 'Notebook Two', 'For specific listing');
            await chatModel.createSession(testNotebook.id, undefined, 'Chat 1 NB1');
            await chatModel.createSession(notebook2.id, undefined, 'Chat 1 NB2');
            await chatModel.createSession(testNotebook.id, undefined, 'Chat 2 NB1');
        });
        (0, vitest_1.it)('should list all sessions for a specific notebook', async () => {
            const sessionsForNb1 = await chatModel.listSessionsForNotebook(testNotebook.id);
            (0, vitest_1.expect)(sessionsForNb1.length).toBe(2);
            sessionsForNb1.forEach(s => (0, vitest_1.expect)(s.notebookId).toBe(testNotebook.id));
            const sessionsForNb2 = await chatModel.listSessionsForNotebook(notebook2.id);
            (0, vitest_1.expect)(sessionsForNb2.length).toBe(1);
            (0, vitest_1.expect)(sessionsForNb2[0].notebookId).toBe(notebook2.id);
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
            const originalUpdatedAt = sessionToMove.updatedAt.getTime();
            await new Promise(resolve => setTimeout(resolve, 50));
            const result = await chatModel.updateChatNotebook(sessionToMove.sessionId, targetNotebook.id);
            (0, vitest_1.expect)(result).toBe(true);
            const updatedSession = await chatModel.getSessionById(sessionToMove.sessionId);
            (0, vitest_1.expect)(updatedSession?.notebookId).toBe(targetNotebook.id);
            (0, vitest_1.expect)(updatedSession.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt);
        });
        (0, vitest_1.it)('should return false if the session ID does not exist', async () => {
            const nonExistentSessionId = (0, crypto_1.randomUUID)();
            const result = await chatModel.updateChatNotebook(nonExistentSessionId, targetNotebook.id);
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should throw an error if the target notebook ID does not exist (FOREIGN KEY constraint)', async () => {
            const nonExistentNotebookId = (0, crypto_1.randomUUID)();
            await (0, vitest_1.expect)(chatModel.updateChatNotebook(sessionToMove.sessionId, nonExistentNotebookId))
                .rejects
                .toThrow();
        });
    });
    (0, vitest_1.describe)('addMessage', () => {
        let sessionId;
        (0, vitest_1.beforeEach)(async () => {
            const session = await chatModel.createSession(testNotebook.id);
            sessionId = session.sessionId;
        });
        (0, vitest_1.it)('should add a message with valid ChatMessageSourceMetadata', async () => {
            const metadata = { sourceChunkIds: [10, 20] };
            const message = await chatModel.addMessage({ sessionId: sessionId, role: 'user', content: 'With metadata', metadata });
            (0, vitest_1.expect)(message.messageId).toEqual(vitest_1.expect.any(String));
            (0, vitest_1.expect)(message.timestamp).toEqual(vitest_1.expect.any(Date));
            (0, vitest_1.expect)(message.metadata).toBe(JSON.stringify(metadata));
            const dbSession = await chatModel.getSessionById(sessionId);
            (0, vitest_1.expect)(dbSession.updatedAt.getTime()).toBeCloseTo(message.timestamp.getTime(), 50);
        });
        (0, vitest_1.it)('should add a message with null metadata', async () => {
            const message = await chatModel.addMessage({ sessionId: sessionId, role: 'assistant', content: 'No metadata', metadata: null });
            (0, vitest_1.expect)(message.metadata).toBeNull();
        });
        (0, vitest_1.it)('should add a message with undefined metadata (becomes null in DB)', async () => {
            const message = await chatModel.addMessage({ sessionId: sessionId, role: 'user', content: 'Undefined metadata' });
            (0, vitest_1.expect)(message.metadata).toBeNull();
        });
        (0, vitest_1.it)('should update the session updated_at timestamp when a message is added', async () => {
            const session = await chatModel.getSessionById(sessionId);
            const initialSessionUpdate = session.updatedAt.getTime();
            await new Promise(resolve => setTimeout(resolve, 50));
            const newMessage = await chatModel.addMessage({ sessionId: sessionId, role: 'user', content: 'Test message for timestamp' });
            const updatedSession = await chatModel.getSessionById(sessionId);
            const messageTimestamp = newMessage.timestamp.getTime();
            const finalSessionUpdate = updatedSession.updatedAt.getTime();
            (0, vitest_1.expect)(finalSessionUpdate).toBeGreaterThan(initialSessionUpdate);
            (0, vitest_1.expect)(finalSessionUpdate).toBeCloseTo(messageTimestamp, 50);
        });
        (0, vitest_1.it)('should throw an error if trying to add a message to a non-existent session', async () => {
            const nonExistentSessionId = (0, crypto_1.randomUUID)();
            await (0, vitest_1.expect)(chatModel.addMessage({ sessionId: nonExistentSessionId, role: 'user', content: 'msg' }))
                .rejects.toThrow();
        });
    });
    (0, vitest_1.describe)('getMessagesBySessionId', () => {
        let sessionId;
        let msg1, msg2, msg3;
        let msgWithMeta;
        (0, vitest_1.beforeEach)(async () => {
            const session = await chatModel.createSession(testNotebook.id);
            sessionId = session.sessionId;
            msg1 = await chatModel.addMessage({ sessionId: sessionId, role: 'user', content: 'Message 1' });
            await new Promise(resolve => setTimeout(resolve, 5));
            msgWithMeta = await chatModel.addMessage({
                sessionId: sessionId,
                role: 'assistant',
                content: 'Message 2 with Meta',
                metadata: { sourceChunkIds: [5] }
            });
            await new Promise(resolve => setTimeout(resolve, 5));
            msg2 = msgWithMeta;
            msg3 = await chatModel.addMessage({ sessionId: sessionId, role: 'user', content: 'Message 3' });
        });
        (0, vitest_1.it)('should retrieve all messages for a session in ascending order', async () => {
            const messages = await chatModel.getMessagesBySessionId(sessionId);
            (0, vitest_1.expect)(messages.length).toBe(3);
            (0, vitest_1.expect)(messages[0].messageId).toBe(msg1.messageId);
            (0, vitest_1.expect)(messages[1].messageId).toBe(msgWithMeta.messageId);
            (0, vitest_1.expect)(messages[2].messageId).toBe(msg3.messageId);
        });
        (0, vitest_1.it)('should retrieve messages with limit (most recent if default DESC then reversed)', async () => {
            const messages = await chatModel.getMessagesBySessionId(sessionId, 2);
            (0, vitest_1.expect)(messages.length).toBe(2);
            (0, vitest_1.expect)(messages[0].messageId).toBe(msgWithMeta.messageId);
            (0, vitest_1.expect)(messages[1].messageId).toBe(msg3.messageId);
        });
        (0, vitest_1.it)('should retrieve messages before a timestamp', async () => {
            const messages = await chatModel.getMessagesBySessionId(sessionId, undefined, msgWithMeta.timestamp);
            (0, vitest_1.expect)(messages).toHaveLength(1);
            (0, vitest_1.expect)(messages[0].messageId).toBe(msg1.messageId);
        });
        (0, vitest_1.it)('should retrieve messages with limit and before a timestamp', async () => {
            const olderTimestamp = new Date(msg1.timestamp.getTime() - 1000).toISOString();
            const insertStmt = db.prepare(`INSERT INTO chat_messages (message_id, session_id, timestamp, role, content, metadata)
                                           VALUES (?, ?, ?, ?, ?, ?)`);
            const msg0_id = (0, crypto_1.randomUUID)();
            insertStmt.run(msg0_id, sessionId, olderTimestamp, 'user', 'Message 0', null);
            const msg1TimestampAsDate = msg1.timestamp;
            const messages = await chatModel.getMessagesBySessionId(sessionId, 1, msgWithMeta.timestamp);
            (0, vitest_1.expect)(messages.length).toBe(1);
            (0, vitest_1.expect)(messages[0].messageId).toBe(msg1.messageId);
        });
        (0, vitest_1.it)('should return empty array for a session with no messages', async () => {
            const newSession = await chatModel.createSession(testNotebook.id);
            const messages = await chatModel.getMessagesBySessionId(newSession.sessionId);
            (0, vitest_1.expect)(messages).toEqual([]);
        });
        (0, vitest_1.it)('should return messages with metadata as JSON string or null', async () => {
            const messages = await chatModel.getMessagesBySessionId(sessionId);
            const message1 = messages.find(m => m.messageId === msg1.messageId);
            const messageWithMeta = messages.find(m => m.messageId === msgWithMeta.messageId);
            (0, vitest_1.expect)(message1?.metadata).toBeNull();
            (0, vitest_1.expect)(messageWithMeta?.metadata).toBe(JSON.stringify({ sourceChunkIds: [5] }));
        });
    });
    (0, vitest_1.describe)('deleteSession', () => {
        (0, vitest_1.it)('should delete a session and all its associated messages (CASCADE)', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            await chatModel.addMessage({ sessionId: session.sessionId, role: 'user', content: 'Message to be deleted' });
            const msgId = (await chatModel.getMessagesBySessionId(session.sessionId))[0].messageId;
            const msgBefore = db.prepare('SELECT 1 FROM chat_messages WHERE message_id = ?').get(msgId);
            (0, vitest_1.expect)(msgBefore).toBeDefined();
            await chatModel.deleteSession(session.sessionId);
            const deletedSession = await chatModel.getSessionById(session.sessionId);
            (0, vitest_1.expect)(deletedSession).toBeNull();
            const messagesAfter = await chatModel.getMessagesBySessionId(session.sessionId);
            (0, vitest_1.expect)(messagesAfter.length).toBe(0);
            const msgAfter = db.prepare('SELECT 1 FROM chat_messages WHERE message_id = ?').get(msgId);
            (0, vitest_1.expect)(msgAfter).toBeUndefined();
        });
        (0, vitest_1.it)('should not throw when deleting a non-existent session', async () => {
            await (0, vitest_1.expect)(chatModel.deleteSession((0, crypto_1.randomUUID)())).resolves.not.toThrow();
        });
    });
});
//# sourceMappingURL=ChatModel.test.js.map