import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from './db';
import runMigrations from './runMigrations';
// Import ONLY the class
import { ChatModel } from './ChatModel'; 
import { IChatMessage, IChatSession, ChatMessageRole, /* AddMessageInput potentially if needed */ } from '../shared/types.d'; // Adjust type imports as needed

// Hold the dedicated test database instance
let testDb: Database.Database;
// Hold the test model instance (created in beforeAll)
let testChatModel: ChatModel;

// Sample data for testing
const sampleSessionTitle = 'Test Chat Session';

describe('ChatModel Integration Tests', () => {
    // Setup: Create dedicated in-memory DB, run migrations, instantiate ChatModel
    beforeAll(() => {
        try {
            // No need to set NODE_ENV anymore for _setTestDb
            // process.env.NODE_ENV = 'test'; 

            // Create the specific in-memory DB *for tests*
            testDb = initDb(':memory:'); 
            runMigrations(testDb); // Run migrations on the test DB
            
            // Instantiate the ChatModel class with the test DB
            testChatModel = new ChatModel(testDb); 

            // Remove injection call
            // chatModel._setTestDb(testDb); 

            console.log('[ChatModel Tests - beforeAll] Dedicated Test DB initialized, migrations run, model instantiated.');
        } catch (error) {
            console.error('[ChatModel Tests - beforeAll] Failed to initialize dedicated test database:', error);
            throw error; // Prevent tests from running if setup fails
        }
    });

    // Teardown: Close dedicated test DB connection after all tests
    afterAll(() => {
        if (testDb && testDb.open) {
            testDb.close();
            console.log('[ChatModel Tests - afterAll] Dedicated Test DB closed.');
        }
    });

    // Cleanup: Delete relevant data from the dedicated test DB before each test
    beforeEach(async () => { 
        try {
            testDb.exec('DELETE FROM chat_messages;');
            testDb.exec('DELETE FROM chat_sessions;');
        } catch (error) {
            console.error('[ChatModel Tests - beforeEach] Failed to clean chat tables:', error);
        }
    });

    // --- Test Cases --- 

    it('should create a session, add messages, and retrieve them', async () => {
        // 1. Create a session
        const newSession: IChatSession = await testChatModel.createSession(); 
        const sessionId = newSession.session_id;
        expect(sessionId).toBeDefined();
        expect(sessionId).toMatch(/^[0-9a-f\-]{36}$/i); 

        const sessionRow = testDb.prepare('SELECT * FROM chat_sessions WHERE session_id = ?').get(sessionId);
        expect(sessionRow).toBeDefined();
        expect((sessionRow as any).title).toBeNull(); 

        // 2. Add messages
        const userMessageData = {
            session_id: sessionId,
            role: 'user' as ChatMessageRole,
            content: 'Hello, assistant!',
            metadata: { source: 'test' } 
        };
        const userMessage: IChatMessage = await testChatModel.addMessage(userMessageData);
        expect(userMessage.message_id).toMatch(/^[0-9a-f\-]{36}$/i);
        expect(userMessage.session_id).toBe(sessionId);
        expect(userMessage.role).toBe('user');
        expect(userMessage.content).toBe(userMessageData.content);
        expect(userMessage.metadata).toBe(JSON.stringify(userMessageData.metadata)); 

        // Add a small delay to ensure distinct timestamps
        await new Promise(resolve => setTimeout(resolve, 5));

        const assistantMessageData = {
            session_id: sessionId,
            role: 'assistant' as ChatMessageRole,
            content: 'Hello, user! How can I help?',
        };
        const assistantMessage: IChatMessage = await testChatModel.addMessage(assistantMessageData);
        expect(assistantMessage.message_id).toMatch(/^[0-9a-f\-]{36}$/i);
        expect(assistantMessage.metadata).toBeNull(); 

        const messagesFromDb = testDb.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);
        expect(messagesFromDb).toHaveLength(2);
        expect((messagesFromDb[0] as any).role).toBe('user');
        expect((messagesFromDb[0] as any).content).toBe(userMessageData.content);
        expect((messagesFromDb[0] as any).metadata).toBe(JSON.stringify(userMessageData.metadata)); 
        expect((messagesFromDb[1] as any).role).toBe('assistant');
        expect((messagesFromDb[1] as any).content).toBe(assistantMessageData.content);
        expect((messagesFromDb[1] as any).metadata).toBeNull(); 

        // 3. Get Messages
        const retrievedMessages: IChatMessage[] = await testChatModel.getMessages(sessionId);
        expect(retrievedMessages).toBeDefined();
        expect(retrievedMessages).toBeInstanceOf(Array);
        expect(retrievedMessages).toHaveLength(2);
        expect(retrievedMessages[0].message_id).toBe(userMessage.message_id);
        expect(retrievedMessages[1].message_id).toBe(assistantMessage.message_id);
        expect(retrievedMessages[0].role).toBe('user');
        expect(retrievedMessages[1].role).toBe('assistant');
        expect(retrievedMessages[0].metadata).toBe(JSON.stringify(userMessageData.metadata));
        expect(retrievedMessages[1].metadata).toBeNull();
    });

    it('should update a session title', async () => {
        const newSession = await testChatModel.createSession();
        const sessionId = newSession.session_id;
        const newTitle = "Updated Session Title";

        await testChatModel.updateSessionTitle(sessionId, newTitle);

        const sessionRow = testDb.prepare('SELECT title, updated_at FROM chat_sessions WHERE session_id = ?').get(sessionId) as any;
        expect(sessionRow).toBeDefined();
        expect(sessionRow.title).toBe(newTitle);
        const createdAt = new Date(newSession.created_at).getTime();
        const updatedAt = new Date(sessionRow.updated_at).getTime();
        expect(updatedAt).toBeGreaterThanOrEqual(createdAt);
    });

    it('should list sessions ordered by updated_at descending', async () => {
        const session1 = await testChatModel.createSession();
        await new Promise(resolve => setTimeout(resolve, 10)); 
        const session2 = await testChatModel.createSession();
        await new Promise(resolve => setTimeout(resolve, 10));
        await testChatModel.addMessage({ session_id: session1.session_id, role: 'user', content: 'Update S1' });

        const sessions = await testChatModel.listSessions();
        expect(sessions).toHaveLength(2);
        expect(sessions[0].session_id).toBe(session1.session_id);
        expect(sessions[1].session_id).toBe(session2.session_id);
    });
    
    it('should get messages with limit', async () => {
        const session = await testChatModel.createSession();
        await testChatModel.addMessage({ session_id: session.session_id, role: 'user', content: 'Msg 1' });
        await new Promise(resolve => setTimeout(resolve, 5));
        const msg2 = await testChatModel.addMessage({ session_id: session.session_id, role: 'assistant', content: 'Msg 2' });
        await new Promise(resolve => setTimeout(resolve, 5));
        const msg3 = await testChatModel.addMessage({ session_id: session.session_id, role: 'user', content: 'Msg 3' });
        
        const messages = await testChatModel.getMessages(session.session_id, 2); 
        expect(messages).toHaveLength(2);
        expect(messages[0].message_id).toBe(msg2.message_id); 
        expect(messages[1].message_id).toBe(msg3.message_id); 
    });

    it('should get messages before a timestamp', async () => {
        const session = await testChatModel.createSession();
        const msg1 = await testChatModel.addMessage({ session_id: session.session_id, role: 'user', content: 'Msg 1' });
        await new Promise(resolve => setTimeout(resolve, 5));
        const msg2 = await testChatModel.addMessage({ session_id: session.session_id, role: 'assistant', content: 'Msg 2' });
        await new Promise(resolve => setTimeout(resolve, 5));
        await testChatModel.addMessage({ session_id: session.session_id, role: 'user', content: 'Msg 3' });
        
        const messages = await testChatModel.getMessages(session.session_id, undefined, msg2.timestamp);
        expect(messages).toHaveLength(1);
        expect(messages[0].message_id).toBe(msg1.message_id);
    });

    it('should delete a session and its messages', async () => {
        const session = await testChatModel.createSession();
        await testChatModel.addMessage({ session_id: session.session_id, role: 'user', content: 'Hello' });
        
        await testChatModel.deleteSession(session.session_id);
        
        const deletedSession = await testChatModel.getSession(session.session_id);
        expect(deletedSession).toBeNull();
        
        const deletedMessages = await testChatModel.getMessages(session.session_id);
        expect(deletedMessages).toHaveLength(0);
        
        const sessionRow = testDb.prepare('SELECT 1 FROM chat_sessions WHERE session_id = ?').get(session.session_id);
        expect(sessionRow).toBeUndefined();
        const messageRows = testDb.prepare('SELECT 1 FROM chat_messages WHERE session_id = ?').all(session.session_id);
        expect(messageRows).toHaveLength(0);
    });

    // Remove or adapt tests that rely on specific ChatModel constructor logic 
    // if they were targeting functionality removed or changed.
    /* Example: remove test for invalid role if validation moved elsewhere 
    it('should reject adding a message with an invalid role', async () => {
        // ... test setup ...
        // await expect(chatModel.addMessage(invalidMessageData))
        //     .rejects
        //     .toThrow(/some error/); // Adjust expected error
    });
    */

}); 