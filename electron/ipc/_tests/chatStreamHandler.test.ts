import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IpcMainEvent, WebContents } from 'electron';
import { registerChatStreamStartHandler, registerChatStreamStopHandler } from '../chatStreamHandler';
import { ChatService } from '../../../services/ChatService';
import { logger } from '../../../utils/logger';
import { CHAT_STREAM_START, CHAT_STREAM_STOP, ON_CHAT_STREAM_ERROR } from '../../../shared/ipcChannels';

// Mock logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}));

// Mock electron - must be hoisted before other imports
vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn()
  }
}));

describe('chatStreamHandler', () => {
  let mockChatService: Partial<ChatService>;
  let mockEvent: Partial<IpcMainEvent>;
  let mockWebContents: Partial<WebContents>;
  let handlers: Map<string, Function>;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();

    // Initialize handler map
    handlers = new Map();

    // Get the mocked ipcMain
    const { ipcMain } = await import('electron');
    
    // Setup ipcMain mock to capture handlers
    (ipcMain.on as any).mockImplementation((channel: string, handler: Function) => {
      handlers.set(channel, handler);
      return ipcMain;
    });

    // Mock WebContents
    mockWebContents = {
      id: 1,
      isDestroyed: vi.fn().mockReturnValue(false),
      send: vi.fn()
    };

    // Mock IpcMainEvent
    mockEvent = {
      sender: mockWebContents as WebContents
    };

    // Mock ChatService
    mockChatService = {
      startStreamingResponse: vi.fn(),
      stopStream: vi.fn()
    };
  });

  afterEach(() => {
    handlers.clear();
  });

  describe('registerChatStreamStartHandler', () => {
    it('should register the handler correctly', () => {
      registerChatStreamStartHandler(mockChatService as ChatService);
      
      const { ipcMain } = await import('electron');
      expect(ipcMain.on).toHaveBeenCalledWith(
        CHAT_STREAM_START,
        expect.any(Function)
      );
      expect(handlers.has(CHAT_STREAM_START)).toBe(true);
    });

    it.each([
      ['missing sessionId', { question: 'test', notebookId: 'notebook-123' }],
      ['missing question', { sessionId: 'session-123', notebookId: 'notebook-123' }],
      ['missing notebookId', { sessionId: 'session-123', question: 'test' }],
      ['empty sessionId', { sessionId: '', question: 'test', notebookId: 'notebook-123' }],
      ['empty question', { sessionId: 'session-123', question: '', notebookId: 'notebook-123' }],
      ['empty notebookId', { sessionId: 'session-123', question: 'test', notebookId: '' }],
      ['invalid sessionId type', { sessionId: 123, question: 'test', notebookId: 'notebook-123' }],
      ['null question', { sessionId: 'session-123', question: null, notebookId: 'notebook-123' }],
      ['boolean notebookId', { sessionId: 'session-123', question: 'test', notebookId: false }],
    ])('should reject %s', (description, payload) => {
      registerChatStreamStartHandler(mockChatService as ChatService);
      const handler = handlers.get(CHAT_STREAM_START)!;

      handler(mockEvent, payload);
      
      expect(mockChatService.startStreamingResponse).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid notebookId, sessionId, or question'),
        payload
      );
    });

    it('should start streaming successfully with valid parameters', () => {
      registerChatStreamStartHandler(mockChatService as ChatService);
      const handler = handlers.get(CHAT_STREAM_START)!;

      handler(mockEvent, {
        sessionId: 'session-123',
        question: 'What is the meaning of life?',
        notebookId: 'notebook-123'
      });

      expect(mockChatService.startStreamingResponse).toHaveBeenCalledWith(
        'notebook-123',
        'session-123',
        'What is the meaning of life?',
        mockEvent
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Received for sender 1')
      );
    });

    it('should handle service errors', () => {
      const error = new Error('Service initialization failed');
      mockChatService.startStreamingResponse = vi.fn().mockImplementation(() => {
        throw error;
      });

      registerChatStreamStartHandler(mockChatService as ChatService);
      const handler = handlers.get(CHAT_STREAM_START)!;

      handler(mockEvent, {
        sessionId: 'session-123',
        question: 'What is the meaning of life?',
        notebookId: 'notebook-123'
      });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initiate stream'),
        error
      );
      expect(mockWebContents.send).toHaveBeenCalledWith(
        ON_CHAT_STREAM_ERROR,
        'Failed to start stream: Service initialization failed'
      );
    });

  });

  describe('registerChatStreamStopHandler', () => {
    it('should register the handler correctly', () => {
      registerChatStreamStopHandler(mockChatService as ChatService);
      
      const { ipcMain } = await import('electron');
      expect(ipcMain.on).toHaveBeenCalledWith(
        CHAT_STREAM_STOP,
        expect.any(Function)
      );
      expect(handlers.has(CHAT_STREAM_STOP)).toBe(true);
    });

    it('should stop a stream', () => {
      registerChatStreamStopHandler(mockChatService as ChatService);
      const stopHandler = handlers.get(CHAT_STREAM_STOP)!;

      stopHandler(mockEvent);

      expect(mockChatService.stopStream).toHaveBeenCalledWith(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Received stop request from sender 1')
      );
    });

    it('should handle errors when stopping stream', () => {
      mockChatService.stopStream = vi.fn().mockImplementation(() => {
        throw new Error('Stop failed');
      });

      registerChatStreamStopHandler(mockChatService as ChatService);
      const stopHandler = handlers.get(CHAT_STREAM_STOP)!;

      // Should not throw
      expect(() => stopHandler(mockEvent)).not.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to stop stream for sender 1'),
        expect.any(Error)
      );
    });
  });

});