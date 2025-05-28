import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb, closeDb } from './db';
import runMigrations from './runMigrations';
// Import ONLY the class
import { ChatModel } from './ChatModel'; 
import { IChatMessage, IChatSession, ChatMessageRole, /* AddMessageInput potentially if needed */ } from '../shared/types.d'; // Adjust type imports as needed
import { NotebookModel } from './NotebookModel'; // Needed for creating prerequisite notebooks
import { NotebookRecord } from '../shared/types';
import { randomUUID } from 'crypto';
import { ChatMessageSourceMetadata } from '../shared/types.d'; // Ensure ChatMessageSourceMetadata is imported

// Top-level declarations for DB and model instances
let db: Database.Database;
let chatModel: ChatModel;
let notebookModel: NotebookModel;
let testNotebook: NotebookRecord; // A default notebook for most tests

const testDbPath = ':memory:';

describe('ChatModel Unit Tests', () => {

    // Setup: Create dedicated in-memory DB, run migrations, instantiate models before each test.
    beforeEach(async () => { 
        // For better-sqlite3 in-memory, creating a new instance is the cleanest way.
        db = new Database(testDbPath); 
        runMigrations(db); 
        
        chatModel = new ChatModel(db); 
        notebookModel = new NotebookModel(db);

        // Create a default notebook for tests that need a valid notebook_id
        const notebookId = randomUUID();
        testNotebook = await notebookModel.create(notebookId, 'Test Default Notebook', 'For chat tests');
    });

    // Teardown: Close DB connection after each test
    afterEach(() => {
        closeDb();
    });

    // --- Original Test Cases (Now Nested and Using Correct Scoped Variables) ---
    describe('Legacy Core Functionality (createSession, addMessage, getMessages)', () => {
    it('should create a session, add messages, and retrieve them', async () => {
            const newSession: IChatSession = await chatModel.createSession(testNotebook.id); 
        const sessionId = newSession.sessionId;
        expect(sessionId).toBeDefined();
        expect(sessionId).toMatch(/^[0-9a-f\-]{36}$/i); 

            const sessionRow = db.prepare('SELECT * FROM chat_sessions WHERE session_id = ?').get(sessionId);
        expect(sessionRow).toBeDefined();
        expect((sessionRow as any).title).toBeNull(); 

        const userMessageData = {
            sessionId: sessionId,
            role: 'user' as ChatMessageRole,
            content: 'Hello, assistant!',
                metadata: null
        };
            const userMessage: IChatMessage = await chatModel.addMessage(userMessageData);
        expect(userMessage.messageId).toMatch(/^[0-9a-f\-]{36}$/i);
        expect(userMessage.sessionId).toBe(sessionId);
        expect(userMessage.role).toBe('user');
        expect(userMessage.content).toBe(userMessageData.content);
            expect(userMessage.metadata).toBeNull(); 

        await new Promise(resolve => setTimeout(resolve, 5));

        const assistantMessageData = {
            sessionId: sessionId,
            role: 'assistant' as ChatMessageRole,
            content: 'Hello, user! How can I help?',
        };
            const assistantMessage: IChatMessage = await chatModel.addMessage(assistantMessageData);
        expect(assistantMessage.messageId).toMatch(/^[0-9a-f\-]{36}$/i);
        expect(assistantMessage.metadata).toBeNull(); 

            const messagesFromDb = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);
        expect(messagesFromDb).toHaveLength(2);
        expect((messagesFromDb[0] as any).role).toBe('user');
        expect((messagesFromDb[0] as any).content).toBe(userMessageData.content);
            expect((messagesFromDb[0] as any).metadata).toBeNull(); 
        expect((messagesFromDb[1] as any).role).toBe('assistant');
        expect((messagesFromDb[1] as any).content).toBe(assistantMessageData.content);
        expect((messagesFromDb[1] as any).metadata).toBeNull(); 

            const retrievedMessages: IChatMessage[] = await chatModel.getMessages(sessionId);
        expect(retrievedMessages).toBeDefined();
        expect(retrievedMessages).toBeInstanceOf(Array);
        expect(retrievedMessages).toHaveLength(2);
        expect(retrievedMessages[0].messageId).toBe(userMessage.messageId);
        expect(retrievedMessages[1].messageId).toBe(assistantMessage.messageId);
        expect(retrievedMessages[0].role).toBe('user');
        expect(retrievedMessages[1].role).toBe('assistant');
            expect(retrievedMessages[0].metadata).toBeNull();
        expect(retrievedMessages[1].metadata).toBeNull();
    });

        it('should update a session title (legacy test structure)', async () => {
            const newSession = await chatModel.createSession(testNotebook.id);
        const sessionId = newSession.sessionId;
        const newTitle = "Updated Session Title";

            await chatModel.updateSessionTitle(sessionId, newTitle);

            const sessionRow = db.prepare('SELECT title, updated_at FROM chat_sessions WHERE session_id = ?').get(sessionId) as any;
        expect(sessionRow).toBeDefined();
        expect(sessionRow.title).toBe(newTitle);
        const createdAt = new Date(newSession.createdAt).getTime();
        const updatedAt = new Date(sessionRow.updated_at).getTime();
        expect(updatedAt).toBeGreaterThanOrEqual(createdAt);
    });

        it('should list sessions ordered by updated_at descending (legacy test structure)', async () => {
            const session1 = await chatModel.createSession(testNotebook.id);
        await new Promise(resolve => setTimeout(resolve, 10)); 
            const session2 = await chatModel.createSession(testNotebook.id);
        await new Promise(resolve => setTimeout(resolve, 10));
            await chatModel.addMessage({ sessionId: session1.sessionId, role: 'user', content: 'Update S1', metadata: null });

            const sessions = await chatModel.listSessions();
        expect(sessions).toHaveLength(2);
            // S1 was updated last because of the message, so it should appear first
        expect(sessions[0].sessionId).toBe(session1.sessionId);
        expect(sessions[1].sessionId).toBe(session2.sessionId);
    });
    
        it('should get messages with limit (legacy test structure)', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            await chatModel.addMessage({ sessionId: session.sessionId, role: 'user', content: 'Msg 1', metadata: null });
        await new Promise(resolve => setTimeout(resolve, 5));
            const msg2 = await chatModel.addMessage({ sessionId: session.sessionId, role: 'assistant', content: 'Msg 2', metadata: null });
        await new Promise(resolve => setTimeout(resolve, 5));
            const msg3 = await chatModel.addMessage({ sessionId: session.sessionId, role: 'user', content: 'Msg 3', metadata: null });
        
            const messages = await chatModel.getMessages(session.sessionId, 2);
        expect(messages).toHaveLength(2);
        expect(messages[0].messageId).toBe(msg2.messageId); 
        expect(messages[1].messageId).toBe(msg3.messageId); 
    });

        it('should get messages before a timestamp (legacy test structure)', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            const msg1 = await chatModel.addMessage({ sessionId: session.sessionId, role: 'user', content: 'Msg 1', metadata: null });
        await new Promise(resolve => setTimeout(resolve, 5));
            const msg2 = await chatModel.addMessage({ sessionId: session.sessionId, role: 'assistant', content: 'Msg 2', metadata: null });
        await new Promise(resolve => setTimeout(resolve, 5));
            await chatModel.addMessage({ sessionId: session.sessionId, role: 'user', content: 'Msg 3', metadata: null });
        
            const messages = await chatModel.getMessages(session.sessionId, undefined, msg2.timestamp);
        expect(messages).toHaveLength(1);
        expect(messages[0].messageId).toBe(msg1.messageId);
    });

        it('should delete a session and its messages (legacy test structure)', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            await chatModel.addMessage({ sessionId: session.sessionId, role: 'user', content: 'Hello', metadata: null });
            
            await chatModel.deleteSession(session.sessionId);
            
            const deletedSession = await chatModel.getSessionById(session.sessionId);
        expect(deletedSession).toBeNull();
        
            const deletedMessages = await chatModel.getMessages(session.sessionId);
        expect(deletedMessages).toHaveLength(0);
        
            const sessionRow = db.prepare('SELECT 1 FROM chat_sessions WHERE session_id = ?').get(session.sessionId);
        expect(sessionRow).toBeUndefined();
            const messageRows = db.prepare('SELECT 1 FROM chat_messages WHERE session_id = ?').all(session.sessionId);
        expect(messageRows).toHaveLength(0);
        });
    }); 

    describe('createSession', () => {
        it('should create a new chat session with a notebookId and title', async () => {
            const title = 'My Test Session';
            const session = await chatModel.createSession(testNotebook.id, undefined, title);
            expect(session).toBeDefined();
            expect(session.notebookId).toBe(testNotebook.id);
            expect(session.title).toBe(title);
            expect(session.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
            expect(session.createdAt.getTime()).toBe(session.updatedAt.getTime());
        });
    
        it('should create a new chat session with notebookId and null title if not provided', async () => {
          const session = await chatModel.createSession(testNotebook.id);
          expect(session.title).toBeNull();
        });
    
        it('should create a new chat session with a provided sessionId', async () => {
          const explicitSessionId = randomUUID();
          const title = 'Explicit ID Session';
          const session = await chatModel.createSession(testNotebook.id, explicitSessionId, title);
          expect(session.sessionId).toBe(explicitSessionId);
        });
    
        it('should return the existing session if creating with an existing sessionId for the SAME notebookId', async () => {
          const explicitSessionId = randomUUID();
          const firstSession = await chatModel.createSession(testNotebook.id, explicitSessionId, 'First');
          const secondAttempt = await chatModel.createSession(testNotebook.id, explicitSessionId, 'Second Attempt Title (should be ignored)');
          expect(secondAttempt.sessionId).toBe(firstSession.sessionId);
          expect(secondAttempt.title).toBe('First');
        });
    
        it('should throw an error if creating with an existing sessionId but for a DIFFERENT notebookId', async () => {
          const explicitSessionId = randomUUID();
          await chatModel.createSession(testNotebook.id, explicitSessionId, 'Original Session');
          const anotherNotebook = await notebookModel.create(randomUUID(), 'Another Notebook', 'Desc');
          await expect(chatModel.createSession(anotherNotebook.id, explicitSessionId, 'Conflicting Session'))
            .rejects
            .toThrow(`Session ID ${explicitSessionId} conflict: already exists in a different notebook.`);
        });
    
        it('should throw an error if notebookId does not exist (FOREIGN KEY constraint)', async () => {
          const nonExistentNotebookId = randomUUID();
          await expect(chatModel.createSession(nonExistentNotebookId, undefined, 'Session for invalid NB'))
            .rejects
            .toThrow(`Failed to create chat session: Invalid notebook ID ${nonExistentNotebookId}.`);
        });
    });

    describe('getSessionById', () => {
        it('should retrieve an existing session by its ID', async () => {
            const createdSession = await chatModel.createSession(testNotebook.id, undefined, 'SessionToGet');
            const fetchedSession = await chatModel.getSessionById(createdSession.sessionId);
            expect(fetchedSession).toBeDefined();
            expect(fetchedSession?.sessionId).toBe(createdSession.sessionId);
            expect(fetchedSession?.title).toBe('SessionToGet');
            expect(fetchedSession?.notebookId).toBe(testNotebook.id);
        });

        it('should return null if no session exists with the given ID', async () => {
            const nonExistentSessionId = randomUUID();
            const fetchedSession = await chatModel.getSessionById(nonExistentSessionId);
            expect(fetchedSession).toBeNull();
        });
    });

    describe('updateSessionTitle', () => {
        it('should update the title and updated_at timestamp of an existing session', async () => {
            const session = await chatModel.createSession(testNotebook.id, undefined, 'Original Title');
            const originalUpdatedAt = session.updatedAt.getTime();
            const newTitle = "New Awesome Title";

            await new Promise(resolve => setTimeout(resolve, 50));
            const updatedSessionResult = await chatModel.updateSessionTitle(session.sessionId, newTitle);
            
            expect(updatedSessionResult).toBeDefined();
            expect(updatedSessionResult?.title).toBe(newTitle);
            expect(updatedSessionResult!.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt);
        });

        it('should not throw when updating title of a non-existent session (no rows affected)', async () => {
            const nonExistentSessionId = randomUUID();
            const result = await chatModel.updateSessionTitle(nonExistentSessionId, 'No Session Here');
            expect(result).toBeNull(); 
            
            const attemptToFetch = await chatModel.getSessionById(nonExistentSessionId);
            expect(attemptToFetch).toBeNull();
        });
    });
    
    describe('listSessions (Newer tests, ensuring proper isolation)', () => {
        it('should return an empty array if no sessions exist', async () => {
            const sessionsFromDefaultNB = await chatModel.listSessionsForNotebook(testNotebook.id);
            for(const s of sessionsFromDefaultNB) await chatModel.deleteSession(s.sessionId);
            db.exec('DELETE FROM chat_sessions;');

            const sessions = await chatModel.listSessions();
            expect(sessions).toEqual([]);
        });
    });

    describe('listSessionsForNotebook', () => {
        let notebook2: NotebookRecord;

        beforeEach(async () => {
            notebook2 = await notebookModel.create(randomUUID(), 'Notebook Two', 'For specific listing');
            await chatModel.createSession(testNotebook.id, undefined, 'Chat 1 NB1');
            await chatModel.createSession(notebook2.id, undefined, 'Chat 1 NB2');
            await chatModel.createSession(testNotebook.id, undefined, 'Chat 2 NB1');
        });

        it('should list all sessions for a specific notebook', async () => {
            const sessionsForNb1 = await chatModel.listSessionsForNotebook(testNotebook.id);
            expect(sessionsForNb1.length).toBe(2);
            sessionsForNb1.forEach(s => expect(s.notebookId).toBe(testNotebook.id));

            const sessionsForNb2 = await chatModel.listSessionsForNotebook(notebook2.id);
            expect(sessionsForNb2.length).toBe(1);
            expect(sessionsForNb2[0].notebookId).toBe(notebook2.id);
            expect(sessionsForNb2[0].title).toBe('Chat 1 NB2');
        });

        it('should return an empty array for a notebook with no sessions', async () => {
            const notebook3 = await notebookModel.create(randomUUID(), 'Notebook Three (No Chats)', 'Desc');
            const sessions = await chatModel.listSessionsForNotebook(notebook3.id);
            expect(sessions).toEqual([]);
        });

        it('should return an empty array for a non-existent notebook ID (no error thrown by model)', async () => {
            const nonExistentNotebookId = randomUUID();
            const sessions = await chatModel.listSessionsForNotebook(nonExistentNotebookId);
            expect(sessions).toEqual([]);
        });
    });

    describe('updateChatNotebook', () => {
        let sessionToMove: IChatSession;
        let targetNotebook: NotebookRecord;

        beforeEach(async () => {
            sessionToMove = await chatModel.createSession(testNotebook.id, undefined, 'Session to be Moved');
            targetNotebook = await notebookModel.create(randomUUID(), 'Target Notebook', 'For session transfer');
        });

        it('should update the notebook_id and updated_at for a session', async () => {
            const originalUpdatedAt = sessionToMove.updatedAt.getTime();
            await new Promise(resolve => setTimeout(resolve, 50));

            const result = await chatModel.updateChatNotebook(sessionToMove.sessionId, targetNotebook.id);
            expect(result).toBe(true);

            const updatedSession = await chatModel.getSessionById(sessionToMove.sessionId);
            expect(updatedSession?.notebookId).toBe(targetNotebook.id);
            expect(updatedSession!.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt);
        });

        it('should return false if the session ID does not exist', async () => {
            const nonExistentSessionId = randomUUID();
            const result = await chatModel.updateChatNotebook(nonExistentSessionId, targetNotebook.id);
            expect(result).toBe(false);
        });

        it('should throw an error if the target notebook ID does not exist (FOREIGN KEY constraint)', async () => {
            const nonExistentNotebookId = randomUUID();
            await expect(chatModel.updateChatNotebook(sessionToMove.sessionId, nonExistentNotebookId))
                .rejects
                .toThrow();
        });
    });

    describe('addMessage', () => {
        let sessionId: string;
        beforeEach(async () => {
            const session = await chatModel.createSession(testNotebook.id);
            sessionId = session.sessionId;
        });

        it('should add a message with valid ChatMessageSourceMetadata', async () => {
            const metadata: ChatMessageSourceMetadata = { sourceChunkIds: [10, 20] };
            const message = await chatModel.addMessage({ sessionId: sessionId, role: 'user', content: 'With metadata', metadata });
            expect(message.messageId).toEqual(expect.any(String));
            expect(message.timestamp).toEqual(expect.any(Date));
            expect(message.metadata).toBe(JSON.stringify(metadata));
            
            const dbSession = await chatModel.getSessionById(sessionId);
            expect(dbSession!.updatedAt.getTime()).toBeCloseTo(message.timestamp.getTime(), 50);
        });

        it('should add a message with null metadata', async () => {
            const message = await chatModel.addMessage({ sessionId: sessionId, role: 'assistant', content: 'No metadata', metadata: null });
            expect(message.metadata).toBeNull();
        });

        it('should add a message with undefined metadata (becomes null in DB)', async () => {
            const message = await chatModel.addMessage({ sessionId: sessionId, role: 'user', content: 'Undefined metadata' });
            expect(message.metadata).toBeNull();
        });

        it('should update the session updated_at timestamp when a message is added', async () => {
            const session = await chatModel.getSessionById(sessionId);
            const initialSessionUpdate = session!.updatedAt.getTime();
            await new Promise(resolve => setTimeout(resolve, 50));

            const newMessage = await chatModel.addMessage({ sessionId: sessionId, role: 'user', content: 'Test message for timestamp' });
            const updatedSession = await chatModel.getSessionById(sessionId);
            const messageTimestamp = newMessage.timestamp.getTime();
            const finalSessionUpdate = updatedSession!.updatedAt.getTime();

            expect(finalSessionUpdate).toBeGreaterThan(initialSessionUpdate);
            expect(finalSessionUpdate).toBeCloseTo(messageTimestamp, 50);
        });

        it('should throw an error if trying to add a message to a non-existent session', async () => {
            const nonExistentSessionId = randomUUID();
            await expect(chatModel.addMessage({ sessionId: nonExistentSessionId, role: 'user', content: 'msg' }))
                .rejects.toThrow();
        });
    });

describe('getMessages', () => {
        let sessionId: string;
        let msg1: IChatMessage, msg2: IChatMessage, msg3: IChatMessage;
        let msgWithMeta: IChatMessage;

        beforeEach(async () => {
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

        it('should retrieve all messages for a session in ascending order', async () => {
            const messages = await chatModel.getMessages(sessionId);
            expect(messages.length).toBe(3);
            expect(messages[0].messageId).toBe(msg1.messageId);
            expect(messages[1].messageId).toBe(msgWithMeta.messageId);
            expect(messages[2].messageId).toBe(msg3.messageId);
        });

        it('should retrieve messages with limit (most recent if default DESC then reversed)', async () => {
            const messages = await chatModel.getMessages(sessionId, 2);
            expect(messages.length).toBe(2);
            expect(messages[0].messageId).toBe(msgWithMeta.messageId);
            expect(messages[1].messageId).toBe(msg3.messageId);
        });

        it('should retrieve messages before a timestamp', async () => {
            const messages = await chatModel.getMessages(sessionId, undefined, msgWithMeta.timestamp);
            expect(messages).toHaveLength(1);
            expect(messages[0].messageId).toBe(msg1.messageId);
        });

        it('should retrieve messages with limit and before a timestamp', async () => {
            const olderTimestamp = new Date(msg1.timestamp.getTime() - 1000).toISOString();
            const insertStmt = db.prepare(`INSERT INTO chat_messages (message_id, session_id, timestamp, role, content, metadata)
                                           VALUES (?, ?, ?, ?, ?, ?)`)
            const msg0_id = randomUUID();
            insertStmt.run(msg0_id, sessionId, olderTimestamp, 'user', 'Message 0', null);

            const msg1TimestampAsDate = msg1.timestamp;

            const messages = await chatModel.getMessages(sessionId, 1, msgWithMeta.timestamp);
            expect(messages.length).toBe(1);
            expect(messages[0].messageId).toBe(msg1.messageId); 
        });

        it('should return empty array for a session with no messages', async () => {
            const newSession = await chatModel.createSession(testNotebook.id);
            const messages = await chatModel.getMessages(newSession.sessionId);
            expect(messages).toEqual([]);
        });

        it('should return messages with metadata as JSON string or null', async () => {
            const messages = await chatModel.getMessages(sessionId);
            const message1 = messages.find(m => m.messageId === msg1.messageId);
            const messageWithMeta = messages.find(m => m.messageId === msgWithMeta.messageId);
            
            expect(message1?.metadata).toBeNull();
            expect(messageWithMeta?.metadata).toBe(JSON.stringify({ sourceChunkIds: [5] }));
        });
    });

    describe('deleteSession', () => {
        it('should delete a session and all its associated messages (CASCADE)', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            await chatModel.addMessage({ sessionId: session.sessionId, role: 'user', content: 'Message to be deleted' });
            const msgId = (await chatModel.getMessages(session.sessionId))[0].messageId;
            
            const msgBefore = db.prepare('SELECT 1 FROM chat_messages WHERE message_id = ?').get(msgId);
            expect(msgBefore).toBeDefined();

            await chatModel.deleteSession(session.sessionId);
            
            const deletedSession = await chatModel.getSessionById(session.sessionId);
            expect(deletedSession).toBeNull();
            const messagesAfter = await chatModel.getMessages(session.sessionId);
            expect(messagesAfter.length).toBe(0);

            const msgAfter = db.prepare('SELECT 1 FROM chat_messages WHERE message_id = ?').get(msgId);
            expect(msgAfter).toBeUndefined();
        });

        it('should not throw when deleting a non-existent session', async () => {
            await expect(chatModel.deleteSession(randomUUID())).resolves.not.toThrow();
        });
    });

}); 