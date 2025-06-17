import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { IpcMainEvent } from 'electron';
import Database from 'better-sqlite3';
import { ChatService } from '../ChatService';
import { LangchainAgent } from '../agents/LangchainAgent';
import { ChatModel } from '../../models/ChatModel';
import { NotebookModel } from '../../models/NotebookModel';
import { ActivityLogService } from '../ActivityLogService';
import { ActivityLogModel } from '../../models/ActivityLogModel';
import { IChatMessage, StructuredChatMessage, ChatMessageSourceMetadata } from '../../shared/types';
import runMigrations from '../../models/runMigrations';
import { 
    ON_CHAT_RESPONSE_CHUNK, 
    ON_CHAT_STREAM_END, 
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

describe('ChatService with BaseService', () => {
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
        
        // Run migrations
        try {
            await runMigrations(db);
        } catch (error) {
            console.error('Migration error:', error);
            throw error;
        }
        
        // Initialize models
        chatModel = new ChatModel(db);
        notebookModel = new NotebookModel(db);
        
        // Mock LangchainAgent
        mockLangchainAgent = {
            queryStream: vi.fn()
        } as unknown as LangchainAgent;
        
        // Create service with dependency injection
        chatService = new ChatService({
            db,
            chatModel,
            langchainAgent: mockLangchainAgent,
            activityLogService: mockActivityLogService,
            streamManager: mockStreamManager as any
        });
        
        // Initialize service
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
        // Cleanup service
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
            // Create a notebook first
            await notebookModel.create(
                notebookId,
                'Test Notebook',
                null, // objectId
                'Test Description'
            );
            
            // Create a session
            await chatModel.createSession(notebookId, sessionId, 'Test Session');
        });

        it('should retrieve messages for a session and parse metadata', async () => {
            // Add messages with metadata
            const metadata: ChatMessageSourceMetadata = {
                sourceChunkIds: [1, 2, 3]
            };
            
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

            const messages = await chatService.getMessages(sessionId);
            
            expect(messages).toHaveLength(2);
            
            // Find messages by role since order might not be guaranteed with same timestamp
            const userMessage = messages.find(m => m.role === 'user');
            const assistantMessage = messages.find(m => m.role === 'assistant');
            
            expect(userMessage).toBeDefined();
            expect(userMessage!.content).toBe('Hello');
            expect(userMessage!.metadata).toEqual(metadata);
            
            expect(assistantMessage).toBeDefined();
            expect(assistantMessage!.content).toBe('Hi there!');
            expect(assistantMessage!.metadata).toBeNull();
        });

        it('should handle invalid metadata JSON gracefully', async () => {
            await chatModel.addMessage({
                sessionId,
                role: 'user',
                content: 'Test message',
                metadata: null
            });
            
            // Manually update the metadata to invalid JSON to simulate corruption
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

        it('should filter messages before a specific timestamp', async () => {
            const now = new Date();
            const earlier = new Date(now.getTime() - 60000); // 1 minute ago
            const future = new Date(now.getTime() + 60000); // 1 minute in future
            
            // Add message with specific timestamp
            const stmt = db.prepare(`
                INSERT INTO chat_messages (message_id, session_id, timestamp, role, content)
                VALUES ($messageId, $sessionId, $timestamp, $role, $content)
            `);
            
            stmt.run({
                messageId: uuidv4(),
                sessionId,
                timestamp: earlier.toISOString(),
                role: 'user',
                content: 'Earlier message'
            });
            
            stmt.run({
                messageId: uuidv4(),
                sessionId,
                timestamp: now.toISOString(),
                role: 'user',
                content: 'Later message'
            });

            // Get messages before the 'now' timestamp - should only get the earlier message
            const messages = await chatService.getMessages(sessionId, undefined, now);
            
            expect(messages).toHaveLength(1);
            expect(messages[0].content).toBe('Earlier message');
        });

        it('should handle limit parameter', async () => {
            // Add multiple messages
            for (let i = 0; i < 5; i++) {
                await chatModel.addMessage({
                    sessionId,
                    role: 'user',
                    content: `Message ${i}`
                });
            }

            const messages = await chatService.getMessages(sessionId, 3);
            
            expect(messages).toHaveLength(3);
        });

        it('should validate sourceChunkIds in metadata', async () => {
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
            
            // Manually update the metadata to simulate invalid data
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
            // Create new IDs for each test
            notebookId = uuidv4();
            sessionId = uuidv4();
            
            // Create a notebook for the tests
            await notebookModel.create(
                notebookId,
                'Test Notebook for Streaming',
                null, // objectId
                'Test Description'
            );
        });

        it('should create session if it does not exist', async () => {
            const onChunkCallback = vi.fn();
            const onEndCallback = vi.fn();
            const onErrorCallback = vi.fn();
            
            (mockLangchainAgent.queryStream as Mock).mockImplementation(
                async (sid, q, onChunk, onEnd, onError, signal) => {
                    // Simulate immediate response
                    onChunk('42');
                    onEnd({ messageId: uuidv4(), metadata: null });
                }
            );

            await chatService.startStreamingResponse(notebookId, sessionId, question, mockEvent);
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Verify session was created
            const session = await chatModel.getSessionById(sessionId);
            expect(session).toBeDefined();
            expect(session?.notebookId).toBe(notebookId);
        });

        it('should handle streaming chunks and send them via IPC', async () => {
            // Create session first
            await chatModel.createSession(notebookId, sessionId);
            
            // Mock the StreamManager to verify it was called correctly
            const mockGenerator = (async function* () {
                yield 'Hello ';
                yield 'world!';
            })();
            
            mockStreamManager.startStream.mockImplementation(async (sender, generator, channels, endData) => {
                // Consume the generator to simulate streaming
                const chunks = [];
                for await (const chunk of generator) {
                    chunks.push(chunk);
                }
                expect(chunks).toEqual(['Hello ', 'world!']);
            });
            
            (mockLangchainAgent.queryStream as Mock).mockImplementation(
                async (sid, q, onChunk, onEnd, onError, signal) => {
                    // Simulate streaming
                    onChunk('Hello ');
                    onChunk('world!');
                    onEnd({ messageId: uuidv4(), metadata: null });
                }
            );

            await chatService.startStreamingResponse(notebookId, sessionId, question, mockEvent);
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Verify StreamManager was called
            expect(mockStreamManager.startStream).toHaveBeenCalled();
        });

        it('should handle errors during streaming', async () => {
            await chatModel.createSession(notebookId, sessionId);
            
            mockStreamManager.startStream.mockImplementation(async (sender, generator) => {
                // Consume the generator and it should throw
                await expect(async () => {
                    for await (const chunk of generator) {
                        // Should throw before yielding
                    }
                }).rejects.toThrow('Stream failed');
            });
            
            (mockLangchainAgent.queryStream as Mock).mockImplementation(
                async (sid, q, onChunk, onEnd, onError, signal) => {
                    // Simulate error after some delay
                    setTimeout(() => onError(new Error('Stream failed')), 10);
                }
            );

            await chatService.startStreamingResponse(notebookId, sessionId, question, mockEvent);
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 100));
            
            expect(mockStreamManager.startStream).toHaveBeenCalled();
        });

        it('should handle destroyed sender gracefully', async () => {
            await chatModel.createSession(notebookId, sessionId);
            
            mockSender.isDestroyed.mockReturnValue(true);
            
            (mockLangchainAgent.queryStream as Mock).mockImplementation(
                async (sid, q, onChunk, onEnd, onError, signal) => {
                    onChunk('Test chunk');
                    onEnd({ messageId: uuidv4(), metadata: null });
                }
            );

            await chatService.startStreamingResponse(notebookId, sessionId, question, mockEvent);
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // StreamManager should handle destroyed sender
            expect(mockStreamManager.startStream).toHaveBeenCalled();
        });

        it('should stop previous stream when starting a new one', async () => {
            await chatModel.createSession(notebookId, sessionId);
            
            // Mock hasActiveStream to return true on second call
            mockStreamManager.hasActiveStream
                .mockReturnValueOnce(false) // First call
                .mockReturnValueOnce(true);  // Second call
            
            (mockLangchainAgent.queryStream as Mock).mockImplementation(
                async (sid, q, onChunk, onEnd, onError, signal) => {
                    // Just acknowledge the call
                }
            );

            // Start first stream
            await chatService.startStreamingResponse(notebookId, sessionId, 'First question', mockEvent);
            
            // Start second stream
            await chatService.startStreamingResponse(notebookId, sessionId, 'Second question', mockEvent);
            
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('already had an active stream')
            );
            expect(mockStreamManager.stopStream).toHaveBeenCalledWith(mockSender.id);
        });

        it('should log activity when chat session starts', async () => {
            await chatModel.createSession(notebookId, sessionId);
            
            (mockLangchainAgent.queryStream as Mock).mockImplementation(
                async (sid, q, onChunk, onEnd) => {
                    onEnd({ messageId: uuidv4(), metadata: null });
                }
            );

            await chatService.startStreamingResponse(notebookId, sessionId, question, mockEvent);
            
            expect(mockLogActivity).toHaveBeenCalledWith({
                activityType: 'chat_session_started',
                details: {
                    sessionId,
                    notebookId,
                    question: question.substring(0, 100),
                    timestamp: expect.any(String)
                }
            });
        });
    });

    describe('stopStream', () => {
        it('should abort active stream', async () => {
            const notebookId = uuidv4();
            const sessionId = uuidv4();
            
            // Create notebook first
            await notebookModel.create(
                notebookId,
                'Test Notebook',
                null, // objectId
                'Test Description'
            );
            
            await chatModel.createSession(notebookId, sessionId);
            
            (mockLangchainAgent.queryStream as Mock).mockImplementation(
                async (sid, q, onChunk, onEnd, onError, signal) => {
                    // Just acknowledge the call
                }
            );

            await chatService.startStreamingResponse(notebookId, sessionId, 'Test', mockEvent);
            
            // Stop the stream
            chatService.stopStream(mockSender.id);
            
            // Verify StreamManager.stopStream was called
            expect(mockStreamManager.stopStream).toHaveBeenCalledWith(mockSender.id);
        });

        it('should handle stopping non-existent stream gracefully', () => {
            // Should not throw
            chatService.stopStream(999);
            
            // Since it delegates to StreamManager, we verify the method was called
            expect(mockStreamManager.stopStream).toHaveBeenCalledWith(999);
        });
    });

    describe('ensureSessionExists', () => {
        it('should create session if it does not exist', async () => {
            const notebookId = uuidv4();
            const sessionId = uuidv4();
            
            // Create notebook first
            await notebookModel.create(
                notebookId,
                'Test Notebook',
                null, // objectId
                'Test Description'
            );
            
            // Verify session doesn't exist
            let session = await chatModel.getSessionById(sessionId);
            expect(session).toBeNull();
            
            // Access private method via reflection for testing
            await (chatService as any).ensureSessionExists(notebookId, sessionId);
            
            // Verify session was created
            session = await chatModel.getSessionById(sessionId);
            expect(session).toBeDefined();
            expect(session?.notebookId).toBe(notebookId);
        });

        it('should not create duplicate session if it already exists', async () => {
            const notebookId = uuidv4();
            const sessionId = uuidv4();
            
            // Create notebook first
            await notebookModel.create(
                notebookId,
                'Test Notebook',
                null, // objectId
                'Test Description'
            );
            
            // Create session
            await chatModel.createSession(notebookId, sessionId, 'Existing Session');
            
            // Try to ensure it exists again
            await (chatService as any).ensureSessionExists(notebookId, sessionId);
            
            // Verify only one session exists
            const sessions = await chatModel.listSessionsForNotebook(notebookId);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].title).toBe('Existing Session');
        });
    });

    describe('Constructor and BaseService integration', () => {
        it('should initialize with proper dependencies', () => {
            expect(chatService).toBeDefined();
            // ChatService uses BaseService logger format now
            expect(logger.info).toHaveBeenCalledWith('ChatService initialized');
        });

        it('should inherit BaseService functionality', async () => {
            // Test that execute wrapper works
            const messages = await chatService.getMessages('test-session-id');
            
            // Should log the operation with execute wrapper format
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('getMessages started')
            );
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('getMessages completed')
            );
        });
    });

    describe('Lifecycle methods', () => {
        it('should support initialize method', async () => {
            // Already called in beforeEach, create a new instance to test
            const newService = new ChatService({
                db,
                chatModel,
                langchainAgent: mockLangchainAgent,
                activityLogService: mockActivityLogService
            });
            await expect(newService.initialize()).resolves.toBeUndefined();
        });

        it('should support cleanup method with stream cleanup', async () => {
            // Start a stream to test cleanup
            const sessionId = uuidv4();
            const notebookId = uuidv4();
            
            // Create notebook and session
            await notebookModel.create(notebookId, 'Test', null, 'Test');
            await chatModel.createSession(notebookId, sessionId, 'Test Session');
            
            // Setup streaming mock
            let capturedOnEnd: ((result: any) => void) | null = null;
            
            (mockLangchainAgent.queryStream as Mock).mockImplementation(
                async (sid, q, onChunk, onEnd, onError, signal) => {
                    capturedOnEnd = onEnd;
                }
            );
            
            // Start stream using the new method
            await chatService.startStreamingResponse(notebookId, sessionId, 'test', mockEvent);
            
            // Cleanup should complete without errors
            await chatService.cleanup();
            
            // Verify cleanup logged
            expect(logger.info).toHaveBeenCalledWith('ChatService cleanup complete');
        });

        it('should handle cleanup gracefully', async () => {
            // Cleanup should complete without errors even without active streams
            await chatService.cleanup();
            
            // Verify cleanup logged
            expect(logger.info).toHaveBeenCalledWith('ChatService cleanup complete');
        });

        it('should support health check', async () => {
            const isHealthy = await chatService.healthCheck();
            expect(isHealthy).toBe(true);
        });
    });

    describe('Error handling with BaseService', () => {
        it('should use execute wrapper for error handling', async () => {
            // Mock the model to throw an error
            vi.spyOn(chatModel, 'getMessagesBySessionId').mockImplementation(() => {
                throw new Error('Database connection lost');
            });

            await expect(chatService.getMessages('test-session')).rejects.toThrow('Database connection lost');
            
            // Should log the error with proper context
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('getMessages failed'),
                expect.any(Error)
            );
        });

        it('should handle stream errors with BaseService patterns', async () => {
            const sessionId = uuidv4();
            const notebookId = uuidv4();
            
            // Create notebook and session
            await notebookModel.create(notebookId, 'Test', null, 'Test');
            await chatModel.createSession(notebookId, sessionId, 'Test Session');
            
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
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Should send error to client
            expect(mockSender.send).toHaveBeenCalledWith(
                ON_CHAT_STREAM_ERROR,
                'Stream failed'
            );
        });
    });

    describe('Dependency injection patterns', () => {
        it('should work with mocked dependencies', async () => {
            // Create fully mocked dependencies
            const mockChatModel = {
                getMessagesBySessionId: vi.fn().mockReturnValue([
                    {
                        messageId: 'mock-1',
                        sessionId: 'mock-session',
                        role: 'user',
                        content: 'Mock message',
                        timestamp: new Date().toISOString()
                    }
                ]),
                addMessage: vi.fn(),
                createSession: vi.fn(),
                listSessionsForNotebook: vi.fn().mockReturnValue([])
            } as unknown as ChatModel;

            const mockAgent = {
                queryStream: vi.fn()
            } as unknown as LangchainAgent;

            // Create service with mocked dependencies
            const serviceWithMocks = new ChatService({
                db,
                chatModel: mockChatModel,
                langchainAgent: mockAgent,
                activityLogService: mockActivityLogService,
                streamManager: mockStreamManager as any
            });

            const messages = await serviceWithMocks.getMessages('mock-session');
            
            expect(mockChatModel.getMessagesBySessionId).toHaveBeenCalledWith('mock-session', undefined, undefined);
            expect(messages).toHaveLength(1);
            expect(messages[0].content).toBe('Mock message');
        });

        it('should allow testing without database', async () => {
            // Create stub dependencies that don't need a real database
            const stubChatModel = {
                getMessagesBySessionId: vi.fn().mockReturnValue([]),
                addMessage: vi.fn().mockResolvedValue('new-message-id'),
                createSession: vi.fn(),
                getSessionById: vi.fn().mockReturnValue({ notebookId: 'stub-notebook' })
            } as unknown as ChatModel;

            const stubAgent = {
                queryStream: vi.fn().mockResolvedValue({
                    [Symbol.asyncIterator]: function* () {
                        yield { role: 'assistant', content: 'Stubbed response' };
                    }
                })
            } as unknown as LangchainAgent;

            const serviceWithStub = new ChatService({
                db: {} as Database.Database, // Dummy db object
                chatModel: stubChatModel,
                langchainAgent: stubAgent,
                activityLogService: mockActivityLogService,
                streamManager: mockStreamManager as any
            });

            // Test message retrieval
            const messages = await serviceWithStub.getMessages('stub-session');
            
            expect(stubChatModel.getMessagesBySessionId).toHaveBeenCalledWith('stub-session', undefined, undefined);
            expect(messages).toHaveLength(0);
        });
    });
});