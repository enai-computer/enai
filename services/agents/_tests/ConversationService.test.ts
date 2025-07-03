import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ConversationService } from '../ConversationService';
import { ChatModel } from '../../../models/ChatModel';
import { NotebookService } from '../../NotebookService';
import { OpenAIMessage } from '../../../shared/types/agent.types';
import { runMigrations } from '../../../models/runMigrations';

vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('ConversationService', () => {
  let db: Database.Database;
  let chatModel: ChatModel;
  let notebookService: NotebookService;
  let conversationService: ConversationService;

  beforeEach(async () => {
    db = new Database(':memory:');
    await runMigrations(db);
    
    // Create a notebook in the database to satisfy foreign key constraints
    const notebookId = 'notebook-123';
    const now = Date.now();
    db.prepare(`
      INSERT INTO notebooks (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(notebookId, 'Default Notebook', now, now);
    
    chatModel = new ChatModel(db);
    notebookService = {
      ensureDefaultNotebook: vi.fn().mockResolvedValue({ id: notebookId }),
      getNotebookCover: vi.fn().mockResolvedValue({ id: notebookId, title: 'Default Notebook' }),
    } as any;
    
    conversationService = new ConversationService({
      chatModel,
      notebookService,
      db,
    });
    
    await conversationService.initialize();
  });

  afterEach(async () => {
    if (conversationService) {
      await conversationService.cleanup();
    }
    if (db) {
      db.close();
    }
  });

  describe('ensureSession', () => {
    it('should create a new session for first-time sender', async () => {
      const senderId = 'test-sender-1';
      const sessionId = await conversationService.ensureSession(senderId);
      
      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(/^[0-9a-f-]+$/); // UUID format
      
      // Verify session was created in database
      const session = await chatModel.getSessionById(sessionId);
      expect(session).toBeDefined();
      expect(session?.notebookId).toBe('notebook-123');
    });

    it('should return existing session for returning sender', async () => {
      const senderId = 'test-sender-2';
      const sessionId1 = await conversationService.ensureSession(senderId);
      const sessionId2 = await conversationService.ensureSession(senderId);
      
      expect(sessionId2).toBe(sessionId1);
    });

    it('should handle concurrent session creation', async () => {
      const senderId = 'test-sender-3';
      const promises = Array(5).fill(null).map(() => 
        conversationService.ensureSession(senderId)
      );
      
      const sessionIds = await Promise.all(promises);
      const uniqueSessionIds = new Set(sessionIds);
      
      expect(uniqueSessionIds.size).toBe(1);
    });
  });

  describe('saveMessage', () => {
    it('should save a message and update conversation history', async () => {
      const senderId = 'test-sender';
      const sessionId = await conversationService.ensureSession(senderId);
      
      const messageId = await conversationService.saveMessage(
        sessionId,
        'user',
        'Hello, world!'
      );
      
      expect(messageId).toBeDefined();
      
      // Verify message was saved to database
      const messages = await chatModel.getMessagesBySessionId(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello, world!');
      expect(messages[0].role).toBe('user');
      
      // Verify conversation history was updated
      const history = conversationService.getConversationHistory(senderId);
      expect(history).toHaveLength(1);
      expect(history![0].content).toBe('Hello, world!');
    });

    it('should save message with metadata', async () => {
      const senderId = 'test-sender';
      const sessionId = await conversationService.ensureSession(senderId);
      const metadata = { tool_calls: [], model: 'gpt-4' };
      
      const messageId = await conversationService.saveMessage(
        sessionId,
        'assistant',
        'I can help with that.',
        metadata
      );
      
      const messages = await chatModel.getMessagesBySessionId(sessionId);
      expect(messages[0].metadata).toEqual(metadata);
    });

    it('should handle empty content', async () => {
      const senderId = 'test-sender';
      const sessionId = await conversationService.ensureSession(senderId);
      
      const messageId = await conversationService.saveMessage(
        sessionId,
        'user',
        ''
      );
      
      expect(messageId).toBeDefined();
      const messages = await chatModel.getMessagesBySessionId(sessionId);
      expect(messages[0].content).toBe('');
    });
  });

  describe('updateMessage', () => {
    it('should update existing message content', async () => {
      const senderId = 'test-sender';
      const sessionId = await conversationService.ensureSession(senderId);
      
      const messageId = await conversationService.saveMessage(
        sessionId,
        'assistant',
        'Initial content'
      );
      
      await conversationService.updateMessage(messageId, 'Updated content');
      
      const messages = await chatModel.getMessagesBySessionId(sessionId);
      expect(messages[0].content).toBe('Updated content');
    });

    it('should handle non-existent message gracefully', async () => {
      await expect(
        conversationService.updateMessage('non-existent-id', 'content')
      ).rejects.toThrow();
    });
  });

  describe('saveMessagesInTransaction', () => {
    it('should save multiple messages atomically', async () => {
      const senderId = 'test-sender';
      const sessionId = await conversationService.ensureSession(senderId);
      
      const messages: Array<{ role: 'user' | 'assistant'; content: string; metadata?: any }> = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First response' },
        { role: 'user', content: 'Second message' },
        { role: 'assistant', content: 'Second response' },
      ];
      
      const messageIds = await conversationService.saveMessagesInTransaction(
        sessionId,
        messages
      );
      
      expect(messageIds).toHaveLength(4);
      
      const savedMessages = chatModel.getMessages(sessionId);
      expect(savedMessages).toHaveLength(4);
      expect(savedMessages.map(m => m.content)).toEqual([
        'First message',
        'First response',
        'Second message',
        'Second response',
      ]);
    });

    it('should rollback on error', async () => {
      const senderId = 'test-sender';
      const sessionId = await conversationService.ensureSession(senderId);
      
      // Save one valid message first
      await conversationService.saveMessage(sessionId, 'user', 'Initial');
      
      // Mock an error during transaction
      const originalAddMessage = chatModel.addMessage.bind(chatModel);
      let callCount = 0;
      chatModel.addMessage = vi.fn().mockImplementation((...args) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Database error');
        }
        return originalAddMessage(...args);
      });
      
      const messages = [
        { role: 'user' as const, content: 'Message 1' },
        { role: 'assistant' as const, content: 'Message 2' },
        { role: 'user' as const, content: 'Message 3' },
      ];
      
      await expect(
        conversationService.saveMessagesInTransaction(sessionId, messages)
      ).rejects.toThrow('Database error');
      
      // Verify only the initial message remains
      const savedMessages = chatModel.getMessages(sessionId);
      expect(savedMessages).toHaveLength(1);
      expect(savedMessages[0].content).toBe('Initial');
    });
  });

  describe('loadMessagesFromDatabase', () => {
    it('should load and validate messages', async () => {
      const senderId = 'test-sender';
      const sessionId = await conversationService.ensureSession(senderId);
      
      // Save some messages
      await conversationService.saveMessage(sessionId, 'user', 'Hello');
      await conversationService.saveMessage(sessionId, 'assistant', 'Hi there!');
      
      const messages = await conversationService.loadMessagesFromDatabase(sessionId);
      
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        role: 'user',
        content: 'Hello',
      });
      expect(messages[1]).toMatchObject({
        role: 'assistant',
        content: 'Hi there!',
      });
    });

    it('should filter out invalid messages', async () => {
      const senderId = 'test-sender';
      const sessionId = await conversationService.ensureSession(senderId);
      
      // Save valid messages
      await conversationService.saveMessage(sessionId, 'user', 'Valid message');
      
      // Directly insert an invalid message (bypassing validation)
      const stmt = db.prepare(`
        INSERT INTO chat_messages (message_id, session_id, role, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run('invalid-1', sessionId, 'invalid_role', 'Invalid', new Date().toISOString());
      
      // Save another valid message
      await conversationService.saveMessage(sessionId, 'assistant', 'Valid response');
      
      const messages = await conversationService.loadMessagesFromDatabase(sessionId);
      
      // Should only return valid messages
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('Valid message');
      expect(messages[1].content).toBe('Valid response');
    });
  });

  describe('clearConversation', () => {
    it('should clear conversation history for a sender', async () => {
      const senderId = 'test-sender';
      const sessionId = await conversationService.ensureSession(senderId);
      
      // Add some messages
      await conversationService.saveMessage(sessionId, 'user', 'Message 1');
      await conversationService.saveMessage(sessionId, 'assistant', 'Response 1');
      
      expect(conversationService.getConversationHistory(senderId)).toHaveLength(2);
      
      conversationService.clearConversation(senderId);
      
      expect(conversationService.getConversationHistory(senderId)).toHaveLength(0);
    });

    it('should not affect other senders', async () => {
      const senderId1 = 'sender-1';
      const senderId2 = 'sender-2';
      
      const sessionId1 = await conversationService.ensureSession(senderId1);
      const sessionId2 = await conversationService.ensureSession(senderId2);
      
      await conversationService.saveMessage(sessionId1, 'user', 'Message 1');
      await conversationService.saveMessage(sessionId2, 'user', 'Message 2');
      
      conversationService.clearConversation(senderId1);
      
      expect(conversationService.getConversationHistory(senderId1)).toHaveLength(0);
      expect(conversationService.getConversationHistory(senderId2)).toHaveLength(1);
    });
  });

  describe('clearAllConversations', () => {
    it('should clear all conversation histories', async () => {
      const senderIds = ['sender-1', 'sender-2', 'sender-3'];
      
      for (const senderId of senderIds) {
        const sessionId = await conversationService.ensureSession(senderId);
        await conversationService.saveMessage(sessionId, 'user', `Message from ${senderId}`);
      }
      
      expect(conversationService.getActiveConversationCount()).toBe(3);
      
      conversationService.clearAllConversations();
      
      expect(conversationService.getActiveConversationCount()).toBe(0);
      
      for (const senderId of senderIds) {
        expect(conversationService.getConversationHistory(senderId)).toHaveLength(0);
      }
    });
  });

  describe('validateLoadedMessages', () => {
    it('should validate message structure correctly', () => {
      const validMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi', metadata: { tool_calls: [] } },
        { role: 'system', content: 'System message' },
      ];
      
      const result = (conversationService as any).validateLoadedMessages(validMessages as any);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitizedMessages).toHaveLength(3);
    });

    it('should identify invalid messages', () => {
      const messages = [
        { role: 'user', content: 'Valid' },
        { role: 'invalid_role', content: 'Invalid role' },
        { content: 'Missing role' },
        { role: 'assistant' }, // Missing content
        { role: 'user', content: null }, // Null content
      ];
      
      const result = (conversationService as any).validateLoadedMessages(messages as any);
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.sanitizedMessages).toHaveLength(1);
    });
  });

  describe('memory management', () => {
    it('should handle cleanup properly', async () => {
      const senderId = 'test-sender';
      const sessionId = await conversationService.ensureSession(senderId);
      
      await conversationService.saveMessage(sessionId, 'user', 'Test');
      expect(conversationService.getActiveConversationCount()).toBe(1);
      
      await conversationService.cleanup();
      
      // After cleanup, internal maps should be cleared
      expect(conversationService.getActiveConversationCount()).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle very long messages', async () => {
      const senderId = 'test-sender';
      const sessionId = await conversationService.ensureSession(senderId);
      
      const longContent = 'x'.repeat(10000);
      const messageId = await conversationService.saveMessage(
        sessionId,
        'user',
        longContent
      );
      
      expect(messageId).toBeDefined();
      
      const messages = await chatModel.getMessagesBySessionId(sessionId);
      expect(messages[0].content).toBe(longContent);
    });

    it('should handle special characters in content', async () => {
      const senderId = 'test-sender';
      const sessionId = await conversationService.ensureSession(senderId);
      
      const specialContent = `Test with "quotes", 'apostrophes', \nnewlines, \ttabs, and emoji 🎉`;
      const messageId = await conversationService.saveMessage(
        sessionId,
        'user',
        specialContent
      );
      
      const messages = await chatModel.getMessagesBySessionId(sessionId);
      expect(messages[0].content).toBe(specialContent);
    });
  });
});