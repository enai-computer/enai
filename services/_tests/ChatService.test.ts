import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { IpcMainEvent } from 'electron';
import Database from 'better-sqlite3';
import { ChatService } from '../ChatService';
import { LangchainAgent } from '../agents/LangchainAgent';
import { ChatModel } from '../../models/ChatModel';
import { NotebookModel } from '../../models/NotebookModel';
import { ActivityLogService } from '../ActivityLogService';
import { ChatMessageSourceMetadata } from '../../shared/types';
import runMigrations from '../../models/runMigrations';
import { 
    ON_CHAT_STREAM_ERROR 
} from '../../shared/ipcChannels';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

// Mock logger to prevent console output during tests
vi.mock('../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock ActivityLogService
const mockLogActivity = vi.fn().mockResolvedValue(undefined);
const mockActivityLogService = {
    logActivity: mockLogActivity,
    initialize: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true)
} as unknown as ActivityLogService;

// Mock StreamManager
const mockStreamManager = {
    hasActiveStream: vi.fn().mockReturnValue(false),
    startStream: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true)
};

// Mock performance tracker
vi.mock('../../utils/performanceTracker', () => ({
    performanceTracker: {
        startStream: vi.fn(),
        recordEvent: vi.fn(),
        completeStream: vi.fn()
    }
}));

describe('ChatService', () => {
    let db: Database.Database;
    let chatModel: ChatModel;
    let notebookModel: NotebookModel;
    let mockLangchainAgent: LangchainAgent;
    let chatService: ChatService;
    let mockEvent: IpcMainEvent;
    let mockSender: any;

    beforeEach(async () => {
        // Create in-memory database
        db = new Database(':memory:');
        await runMigrations(db);
        
        // Initialize models
        chatModel = new ChatModel(db);
        notebookModel = new NotebookModel(db);
        
        // Mock LangchainAgent
        mockLangchainAgent = {
            queryStream: vi.fn()
        } as unknown as LangchainAgent;
        
        // Create service with dependency injection
        chatService = new ChatService({
            chatModel,
            langchainAgent: mockLangchainAgent,
            activityLogService: mockActivityLogService,
            streamManager: mockStreamManager as any
        });
        
        await chatService.initialize();
        
        // Mock IPC event and sender
        mockSender = {
            id: 1,
            send: vi.fn(),
            isDestroyed: vi.fn().mockReturnValue(false)
        };
        
        mockEvent = {
            sender: mockSender
        } as unknown as IpcMainEvent;
    });

    afterEach(async () => {
        await chatService.cleanup();
        if (db && db.open) {
            db.close();
        }
        vi.clearAllMocks();
    });

    describe('getMessages', () => {
        const sessionId = uuidv4();
        const notebookId = uuidv4();

        beforeEach(async () => {
            await notebookModel.create(notebookId, 'Test Notebook', null, 'Test Description');
            await chatModel.createSession(notebookId, sessionId, 'Test Session');
        });

        it('should retrieve and parse messages with metadata', async () => {
            // Add messages with different metadata scenarios
            const metadata: ChatMessageSourceMetadata = { sourceChunkIds: [1, 2, 3] };
            
            await chatModel.addMessage({
                sessionId,
                role: 'user',
                content: 'Hello',
                metadata
            });
            
            await chatModel.addMessage({
                sessionId,
                role: 'assistant',
                content: 'Hi there!',
                metadata: null
            });

            // Test with limit and timestamp filter
            const now = new Date();
            const messages = await chatService.getMessages(sessionId, 10, new Date(now.getTime() + 60000));
            
            expect(messages).toHaveLength(2);
            
            const userMessage = messages.find(m => m.role === 'user');
            const assistantMessage = messages.find(m => m.role === 'assistant');
            
            expect(userMessage).toBeDefined();
            expect(userMessage!.content).toBe('Hello');
            expect(userMessage!.metadata).toEqual(metadata);
            
            expect(assistantMessage).toBeDefined();
            expect(assistantMessage!.content).toBe('Hi there!');
            expect(assistantMessage!.metadata).toBeNull();
        });

        it('should handle invalid metadata gracefully', async () => {
            await chatModel.addMessage({
                sessionId,
                role: 'user',
                content: 'Test message',
                metadata: null
            });
            
            // Manually corrupt metadata
            const stmt = db.prepare(`
                UPDATE chat_messages 
                SET metadata = 'invalid json' 
                WHERE session_id = ? AND role = 'user'
            `);
            stmt.run(sessionId);

            const messages = await chatService.getMessages(sessionId);
            
            expect(messages).toHaveLength(1);
            expect(messages[0].metadata).toBeNull();
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to parse metadata for message'),
                expect.any(Error)
            );
        });

        it('should validate sourceChunkIds format', async () => {
            const invalidMetadata = {
                sourceChunkIds: 'not-an-array',
                sourcesUsed: []
            };
            
            await chatModel.addMessage({
                sessionId,
                role: 'user',
                content: 'Test',
                metadata: null
            });
            
            // Update with invalid metadata structure
            const stmt = db.prepare(`
                UPDATE chat_messages 
                SET metadata = ? 
                WHERE session_id = ? AND role = 'user'
            `);
            stmt.run(JSON.stringify(invalidMetadata), sessionId);

            const messages = await chatService.getMessages(sessionId);
            
            expect(messages[0].metadata).toBeDefined();
            expect(messages[0].metadata?.sourceChunkIds).toBeUndefined();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Invalid sourceChunkIds format')
            );
        });
    });

    describe('startStreamingResponse', () => {
        let notebookId: string;
        let sessionId: string;
        const question = 'What is the meaning of life?';

        beforeEach(async () => {
            notebookId = uuidv4();
            sessionId = uuidv4();
            await notebookModel.create(notebookId, 'Test Notebook', null, 'Test Description');
        });

        it('should handle complete streaming flow with session creation', async () => {
            // Mock the complete streaming flow
            const mockGenerator = (async function* () {
                yield 'Hello ';
                yield 'world!';
            })();
            
            mockStreamManager.startStream.mockImplementation(async (sender, generator, channels, endData) => {
                // Consume the generator to simulate streaming
                const chunks: string[] = [];
                for await (const chunk of generator) {
                    chunks.push(chunk);
                }
                expect(chunks).toEqual(['Hello ', 'world!']);
            });
            
            (mockLangchainAgent.queryStream as Mock).mockImplementation(
                async (sid, q, onChunk, onEnd, onError, signal) => {
                    onChunk('Hello ');
                    onChunk('world!');
                    onEnd({ messageId: uuidv4(), metadata: null });
                }
            );

            await chatService.startStreamingResponse(notebookId, sessionId, question, mockEvent);
            
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Verify session was created
            const session = await chatModel.getSessionById(sessionId);
            expect(session).toBeDefined();
            expect(session?.notebookId).toBe(notebookId);
            
            // Verify StreamManager was called
            expect(mockStreamManager.startStream).toHaveBeenCalled();
            
            // Verify activity was logged
            expect(mockLogActivity).toHaveBeenCalledWith({
                activityType: 'chat_session_started',
                details: expect.objectContaining({
                    sessionId,
                    notebookId,
                    question: question.substring(0, 100)
                })
            });
        });

        it('should handle streaming errors and destroyed senders', async () => {
            await chatModel.createSession(notebookId, sessionId);
            
            // Test error handling
            mockStreamManager.startStream.mockImplementation(async (sender, generator) => {
                await expect(async () => {
                    for await (const chunk of generator) {
                        // Should throw before yielding
                    }
                }).rejects.toThrow('Stream failed');
            });
            
            (mockLangchainAgent.queryStream as Mock).mockImplementation(
                async (sid, q, onChunk, onEnd, onError, signal) => {
                    setTimeout(() => onError(new Error('Stream failed')), 10);
                }
            );

            await chatService.startStreamingResponse(notebookId, sessionId, question, mockEvent);
            await new Promise(resolve => setTimeout(resolve, 100));
            
            expect(mockStreamManager.startStream).toHaveBeenCalled();
            
            // Test destroyed sender
            mockSender.isDestroyed.mockReturnValue(true);
            await chatService.startStreamingResponse(notebookId, sessionId, 'Another question', mockEvent);
            
            // StreamManager should handle destroyed sender
            expect(mockStreamManager.startStream).toHaveBeenCalledTimes(2);
        });

        it('should handle concurrent stream management', async () => {
            await chatModel.createSession(notebookId, sessionId);
            
            // Mock hasActiveStream to simulate concurrent streams
            mockStreamManager.hasActiveStream
                .mockReturnValueOnce(false)
                .mockReturnValueOnce(true);
            
            (mockLangchainAgent.queryStream as Mock).mockImplementation(
                async (sid, q, onChunk, onEnd, onError, signal) => {
                    // Just acknowledge
                }
            );

            // Start first stream
            await chatService.startStreamingResponse(notebookId, sessionId, 'First question', mockEvent);
            
            // Start second stream - should stop first
            await chatService.startStreamingResponse(notebookId, sessionId, 'Second question', mockEvent);
            
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('already had an active stream')
            );
            expect(mockStreamManager.stopStream).toHaveBeenCalledWith(mockSender.id);
        });
    });

    describe('stopStream', () => {
        it('should delegate to StreamManager', async () => {
            const notebookId = uuidv4();
            const sessionId = uuidv4();
            
            await notebookModel.create(notebookId, 'Test', null, 'Test');
            await chatModel.createSession(notebookId, sessionId);
            
            (mockLangchainAgent.queryStream as Mock).mockImplementation(
                async (sid, q, onChunk, onEnd, onError, signal) => {
                    // Just acknowledge
                }
            );

            await chatService.startStreamingResponse(notebookId, sessionId, 'Test', mockEvent);
            
            // Stop existing and non-existent streams
            chatService.stopStream(mockSender.id);
            chatService.stopStream(999);
            
            expect(mockStreamManager.stopStream).toHaveBeenCalledWith(mockSender.id);
            expect(mockStreamManager.stopStream).toHaveBeenCalledWith(999);
        });
    });

    describe('lifecycle and error handling', () => {
        it('should handle initialization and cleanup', async () => {
            // Test fresh initialization
            const newService = new ChatService({
                chatModel,
                langchainAgent: mockLangchainAgent,
                activityLogService: mockActivityLogService,
                streamManager: mockStreamManager as any
            });
            
            await expect(newService.initialize()).resolves.toBeUndefined();
            expect(logger.info).toHaveBeenCalledWith('ChatService initialized');
            
            // Test health check
            const isHealthy = await newService.healthCheck();
            expect(isHealthy).toBe(true);
            
            // Test cleanup
            await newService.cleanup();
            expect(logger.info).toHaveBeenCalledWith('ChatService cleanup complete');
        });

        it('should use execute wrapper for error handling', async () => {
            vi.spyOn(chatModel, 'getMessagesBySessionId').mockImplementation(() => {
                throw new Error('Database connection lost');
            });

            await expect(chatService.getMessages('test-session')).rejects.toThrow('Database connection lost');
            
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('getMessages failed'),
                expect.any(Error)
            );
        });

        it('should handle stream errors with proper error propagation', async () => {
            const sessionId = uuidv4();
            const notebookId = uuidv4();
            
            await notebookModel.create(notebookId, 'Test', null, 'Test');
            await chatModel.createSession(notebookId, sessionId);
            
            let capturedOnError: ((error: Error) => void) | null = null;
            
            (mockLangchainAgent.queryStream as Mock).mockImplementation(
                async (sid, q, onChunk, onEnd, onError, signal) => {
                    capturedOnError = onError;
                }
            );
            
            await chatService.startStreamingResponse(notebookId, sessionId, 'test', mockEvent);
            
            // Simulate error
            const error = new Error('Stream failed');
            capturedOnError!(error);
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Should send error to client
            expect(mockSender.send).toHaveBeenCalledWith(
                ON_CHAT_STREAM_ERROR,
                'Stream failed'
            );
        });
    });

    describe('private methods', () => {
        it('should ensure session exists without duplication', async () => {
            const notebookId = uuidv4();
            const sessionId = uuidv4();
            
            await notebookModel.create(notebookId, 'Test', null, 'Test');
            
            // Verify session doesn't exist
            let session = await chatModel.getSessionById(sessionId);
            expect(session).toBeNull();
            
            // Access private method for testing
            await (chatService as any).ensureSessionExists(notebookId, sessionId);
            
            // Verify session was created
            session = await chatModel.getSessionById(sessionId);
            expect(session).toBeDefined();
            expect(session?.notebookId).toBe(notebookId);
            
            // Call again - should not create duplicate
            await (chatService as any).ensureSessionExists(notebookId, sessionId);
            
            const sessions = await chatModel.listSessionsForNotebook(notebookId);
            expect(sessions).toHaveLength(1);
        });
    });
});