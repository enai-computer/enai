import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from './db';
import runMigrations from './runMigrations';
import { ChatModel } from './ChatModel';
import { ChatMessageCreate, ChatMessageRole, ChatHistory } from '../shared/types.d'; // Import shared types

// Hold the test database instance
let testDb: Database.Database;
// Hold the test model instance
let testChatModel: ChatModel;

// Sample data for testing
const sampleSessionTitle = 'Test Chat Session';

describe('ChatModel Integration Tests', () => {
    // Setup: Create in-memory DB and run migrations before all tests
    beforeAll(() => {
        try {
            testDb = initDb(':memory:'); // Initialize in-memory DB
            runMigrations(testDb); // Run migrations on the test DB
            testChatModel = new ChatModel(testDb); // Instantiate model with test DB
            console.log('[ChatModel Tests] Test DB initialized and migrations run.');
        } catch (error) {
            console.error('[ChatModel Tests] Failed to initialize test database:', error);
            throw error; // Prevent tests from running if setup fails
        }
    });

    // Teardown: Close DB connection after all tests
    afterAll(() => {
        if (testDb && testDb.open) {
            testDb.close();
            console.log('[ChatModel Tests] Test DB closed.');
        }
    });

    // Cleanup: Delete relevant data before each test for isolation
    beforeEach(() => {
        try {
            // Clear only chat-related tables
            testDb.exec('DELETE FROM chat_messages;');
            testDb.exec('DELETE FROM chat_sessions;');
        } catch (error) {
            console.error('[ChatModel Tests] Failed to clean chat tables:', error);
        }
    });

    // --- Test Cases --- (create session -> add messages -> get history stub)

    it('should create a session, add messages, and get empty history (stub)', async () => {
        // 1. Create a session
        const sessionId = await testChatModel.createSession(sampleSessionTitle);
        expect(sessionId).toBeDefined();
        expect(sessionId).toMatch(/^[0-9a-f-]{36}$/); // Basic UUID format check

        // Verify session was created in DB (optional but good)
        const sessionRow = testDb.prepare('SELECT * FROM chat_sessions WHERE session_id = ?').get(sessionId);
        expect(sessionRow).toBeDefined();
        expect((sessionRow as any).title).toBe(sampleSessionTitle);

        // 2. Add messages
        const userMessageData: ChatMessageCreate = {
            sessionId: sessionId,
            role: 'user',
            content: 'Hello, assistant!',
            metadata: { source: 'test' }
        };
        const userMessageId = await testChatModel.addMessage(userMessageData);
        expect(userMessageId).toMatch(/^[0-9a-f-]{36}$/);

        const assistantMessageData: ChatMessageCreate = {
            sessionId: sessionId,
            role: 'assistant',
            content: 'Hello, user! How can I help?',
            // No metadata for this one
        };
        const assistantMessageId = await testChatModel.addMessage(assistantMessageData);
        expect(assistantMessageId).toMatch(/^[0-9a-f-]{36}$/);

        // Verify messages were created in DB (optional)
        const messages = testDb.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);
        expect(messages).toHaveLength(2);
        expect((messages[0] as any).role).toBe('user');
        expect((messages[0] as any).content).toBe(userMessageData.content);
        expect((messages[0] as any).metadata).toBe(JSON.stringify(userMessageData.metadata));
        expect((messages[1] as any).role).toBe('assistant');
        expect((messages[1] as any).content).toBe(assistantMessageData.content);
        expect((messages[1] as any).metadata).toBeNull();

        // 3. Get History (Stub check)
        const history: ChatHistory = await testChatModel.getHistory(sessionId);
        expect(history).toBeDefined();
        expect(history).toBeInstanceOf(Array);
        expect(history).toHaveLength(0); // Expect empty array due to stub
    });

    it('should create a session without a title', async () => {
        const sessionId = await testChatModel.createSession(); // No title provided
        expect(sessionId).toBeDefined();
        expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

        const sessionRow = testDb.prepare('SELECT title FROM chat_sessions WHERE session_id = ?').get(sessionId);
        expect(sessionRow).toBeDefined();
        expect((sessionRow as any).title).toBeNull();
    });

    it('should reject adding a message with an invalid role', async () => {
        const sessionId = await testChatModel.createSession();
        const invalidMessageData = {
            sessionId: sessionId,
            role: 'invalid-role' as ChatMessageRole, // Force invalid role
            content: 'This should fail.',
        };

        // Expect the addMessage call to throw an error
        await expect(testChatModel.addMessage(invalidMessageData))
            .rejects
            .toThrow('Invalid chat message role: invalid-role');
    });

}); 