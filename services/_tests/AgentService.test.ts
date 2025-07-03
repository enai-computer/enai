/**
 * AgentService Test Suite
 * 
 * Tests the orchestration capabilities of AgentService, focusing on:
 * - Service coordination and error propagation
 * - Critical user journeys (search, chat, tool execution)
 * - Streaming functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import Database from 'better-sqlite3';
import { AgentService } from '../AgentService';
import { SetIntentPayload } from '../../shared/types';
import { logger } from '../../utils/logger';
import runMigrations from '../../models/runMigrations';
import { WebContents } from 'electron';
import { ON_INTENT_RESULT } from '../../shared/ipcChannels';

// Mock better-sqlite3 to avoid native module issues
vi.mock('better-sqlite3');
vi.mock('../../models/runMigrations');

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../utils/llm');
global.fetch = vi.fn();

// Test helpers
const createMockServices = () => ({
  conversationService: {
    ensureSession: vi.fn().mockResolvedValue('test-session-id'),
    saveMessage: vi.fn().mockResolvedValue('message-id'),
    updateMessage: vi.fn(),
    saveMessagesInTransaction: vi.fn().mockResolvedValue(['msg-1', 'msg-2']),
    loadMessagesFromDatabase: vi.fn().mockResolvedValue([]),
    updateConversationHistory: vi.fn(),
    clearConversation: vi.fn(),
    clearAllConversations: vi.fn(),
    getActiveConversationCount: vi.fn().mockReturnValue(0),
    getConversationHistory: vi.fn().mockReturnValue([]),
    getSessionId: vi.fn().mockReturnValue('test-session-id'),
    initialize: vi.fn(),
    cleanup: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true)
  },
  llmClient: {
    prepareMessages: vi.fn().mockResolvedValue([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'test intent' }
    ]),
    callOpenAI: vi.fn(),
    streamOpenAI: vi.fn(),
    initialize: vi.fn(),
    cleanup: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true)
  },
  searchService: {
    clearSearchResults: vi.fn(),
    getCurrentSearchResults: vi.fn().mockReturnValue([]),
    accumulateSearchResults: vi.fn(),
    searchNews: vi.fn().mockResolvedValue([]),
    detectNewsSources: vi.fn().mockReturnValue({ sources: [], cleanedQuery: '' }),
    processSearchResultsToSlices: vi.fn().mockResolvedValue([]),
    initialize: vi.fn(),
    cleanup: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true)
  },
  toolService: {
    handleToolCallsWithAtomicSave: vi.fn().mockResolvedValue({
      toolResults: [],
      hasSearchResults: false,
      hasMeaningfulContent: false
    }),
    handleToolCallsForStreamingWithAtomicSave: vi.fn().mockResolvedValue([]),
    handleToolCallsForStreaming: vi.fn().mockResolvedValue([]),
    getToolDefinitions: vi.fn().mockReturnValue([]),
    processToolCall: vi.fn(),
    initialize: vi.fn(),
    cleanup: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true)
  },
  streamManager: {
    startStream: vi.fn().mockResolvedValue({ messageId: 'stream-msg-id' }),
    initialize: vi.fn(),
    cleanup: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true)
  }
});

const mockToolCall = (name: string, args: any = {}) => ({
  id: 'call-123',
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
});

const mockAssistantResponse = (content: string | null = null, toolCalls: any[] = []) => ({
  role: 'assistant',
  content,
  ...(toolCalls.length > 0 && { tool_calls: toolCalls })
});

describe('AgentService', () => {
  let db: any; // Mock database
  let agentService: AgentService;
  let mockServices: ReturnType<typeof createMockServices>;
  
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key';
    
    // Create mock database
    db = {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue([])
      }),
      close: vi.fn(),
      open: true
    };
    
    mockServices = createMockServices();
    
    agentService = new AgentService({
      db,
      conversationService: mockServices.conversationService as any,
      llmClient: mockServices.llmClient as any,
      searchService: mockServices.searchService as any,
      toolService: mockServices.toolService as any,
      streamManager: mockServices.streamManager as any
    });
    
    await agentService.initialize();
  });
  
  afterEach(async () => {
    await agentService.cleanup();
    db?.close();
    delete process.env.OPENAI_API_KEY;
  });

  describe('Core functionality', () => {
    it('should process simple chat messages', async () => {
      mockServices.llmClient.callOpenAI.mockResolvedValueOnce(
        mockAssistantResponse('Hello! How can I help you?')
      );

      const result = await agentService.processComplexIntent(
        { intentText: 'Hello', context: 'welcome' },
        'test-sender'
      );

      expect(result).toEqual({
        type: 'chat_reply',
        message: 'Hello! How can I help you?'
      });
    });

    it('should handle tool execution', async () => {
      // First call returns tool request
      mockServices.llmClient.callOpenAI.mockResolvedValueOnce(
        mockAssistantResponse(null, [mockToolCall('search_web', { query: 'test search' })])
      );

      // Tool execution
      mockServices.toolService.handleToolCallsWithAtomicSave.mockResolvedValueOnce({
        toolResults: [{ content: 'Search results' }],
        hasSearchResults: true,
        hasMeaningfulContent: true
      });

      // Summary response
      mockServices.llmClient.callOpenAI.mockResolvedValueOnce(
        mockAssistantResponse('Here are the search results...')
      );

      const result = await agentService.processComplexIntent(
        { intentText: 'search for test', context: 'welcome' },
        'test-sender'
      );

      expect(result?.type).toBe('chat_reply');
      expect(mockServices.toolService.handleToolCallsWithAtomicSave).toHaveBeenCalled();
    });

    it('should maintain conversation history', async () => {
      // Setup conversation history
      let messageCount = 0;
      mockServices.llmClient.prepareMessages.mockImplementation(() => {
        messageCount++;
        const messages = [{ role: 'system', content: 'You are a helpful assistant.' }];
        if (messageCount > 1) {
          messages.push(
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'First answer' }
          );
        }
        messages.push({ role: 'user', content: messageCount === 1 ? 'first question' : 'follow-up' });
        return messages;
      });

      mockServices.llmClient.callOpenAI
        .mockResolvedValueOnce(mockAssistantResponse('First answer'))
        .mockResolvedValueOnce(mockAssistantResponse('Follow-up answer'));

      await agentService.processComplexIntent(
        { intentText: 'first question', context: 'welcome' },
        'test-sender'
      );

      await agentService.processComplexIntent(
        { intentText: 'follow-up', context: 'welcome' },
        'test-sender'
      );

      expect(mockServices.conversationService.updateConversationHistory).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error handling', () => {
    const errorCases = [
      {
        name: 'conversation service errors',
        setup: () => {
          mockServices.conversationService.ensureSession.mockRejectedValueOnce(
            new Error('Database error')
          );
        },
        expectedError: 'Database error'
      },
      {
        name: 'LLM client errors',
        setup: () => {
          mockServices.llmClient.callOpenAI.mockRejectedValueOnce(
            new Error('API key invalid')
          );
        },
        expectedError: 'API key invalid'
      },
      {
        name: 'tool service errors',
        setup: () => {
          mockServices.llmClient.callOpenAI.mockResolvedValueOnce(
            mockAssistantResponse(null, [mockToolCall('unknown_tool')])
          );
          mockServices.toolService.handleToolCallsWithAtomicSave.mockRejectedValueOnce(
            new Error('Unknown tool')
          );
        },
        expectedError: 'Unknown tool'
      }
    ];

    errorCases.forEach(({ name, setup, expectedError }) => {
      it(`should propagate ${name}`, async () => {
        setup();
        
        await expect(
          agentService.processComplexIntent(
            { intentText: 'test', context: 'welcome' },
            'test-sender'
          )
        ).rejects.toThrow(expectedError);

        expect(logger.error).toHaveBeenCalled();
      });
    });
  });

  describe('Streaming', () => {
    let mockSender: WebContents;

    beforeEach(() => {
      mockSender = {
        send: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false)
      } as unknown as WebContents;
    });

    it('should stream responses with search results', async () => {
      // Setup tool execution
      mockServices.llmClient.callOpenAI.mockResolvedValueOnce(
        mockAssistantResponse(null, [mockToolCall('search_web', { query: 'test' })])
      );

      mockServices.searchService.getCurrentSearchResults.mockReturnValue([
        { id: '1', title: 'Result', content: 'Content', score: 0.9, source: 'web' }
      ]);

      mockServices.toolService.handleToolCallsForStreamingWithAtomicSave.mockResolvedValueOnce([
        { content: 'Search completed' }
      ]);

      mockServices.searchService.processSearchResultsToSlices.mockResolvedValueOnce([
        { id: '1', title: 'Result', content: 'Content', type: 'search' }
      ]);

      // Setup streaming
      const mockStream = async function* () {
        yield 'Streaming ';
        yield 'response';
      };
      mockServices.llmClient.streamOpenAI.mockReturnValue(mockStream());

      mockServices.streamManager.startStream.mockImplementation(async (sender, generator) => {
        for await (const chunk of generator) {
          // Consume stream
        }
        return { messageId: 'stream-1' };
      });

      await agentService.processComplexIntentWithStreaming(
        { intentText: 'search test', context: 'welcome' },
        'test-sender',
        mockSender,
        'correlation-123'
      );

      // Verify slices were sent
      expect(mockSender.send).toHaveBeenCalledWith(
        ON_INTENT_RESULT,
        expect.objectContaining({
          type: 'chat_reply',
          slices: expect.arrayContaining([
            expect.objectContaining({ id: '1' })
          ])
        })
      );
    });

    it('should handle streaming errors gracefully', async () => {
      mockServices.llmClient.callOpenAI.mockResolvedValueOnce(
        mockAssistantResponse('Response')
      );

      mockServices.streamManager.startStream.mockRejectedValueOnce(
        new Error('Stream error')
      );

      await agentService.processComplexIntentWithStreaming(
        { intentText: 'test', context: 'welcome' },
        'test-sender',
        mockSender,
        'correlation-123'
      );

      expect(logger.error).toHaveBeenCalledWith('Direct streaming error:', expect.any(Error));
    });
  });

  describe('Service orchestration', () => {
    it('should handle immediate returns from tools', async () => {
      mockServices.llmClient.callOpenAI.mockResolvedValueOnce(
        mockAssistantResponse(null, [mockToolCall('open_notebook', { notebookId: 'nb-123' })])
      );

      mockServices.toolService.handleToolCallsWithAtomicSave.mockResolvedValueOnce({
        toolResults: [{
          content: 'Opened',
          immediateReturn: { type: 'open_notebook', notebookId: 'nb-123' }
        }],
        hasSearchResults: false,
        hasMeaningfulContent: false
      });

      const result = await agentService.processComplexIntent(
        { intentText: 'open notebook', context: 'welcome' },
        'test-sender'
      );

      expect(result).toEqual({ type: 'open_notebook', notebookId: 'nb-123' });
      // Should not call LLM again for summary
      expect(mockServices.llmClient.callOpenAI).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple tool calls', async () => {
      const toolCalls = [
        mockToolCall('search_web', { query: 'query1' }),
        mockToolCall('search_web', { query: 'query2' })
      ];

      mockServices.llmClient.callOpenAI.mockResolvedValueOnce(
        mockAssistantResponse(null, toolCalls)
      );

      mockServices.toolService.handleToolCallsWithAtomicSave.mockResolvedValueOnce({
        toolResults: [
          { content: 'Result 1' },
          { content: 'Result 2' }
        ],
        hasSearchResults: true,
        hasMeaningfulContent: true
      });

      mockServices.llmClient.callOpenAI.mockResolvedValueOnce(
        mockAssistantResponse('Combined results...')
      );

      const result = await agentService.processComplexIntent(
        { intentText: 'multiple searches', context: 'welcome' },
        'test-sender'
      );

      expect(result?.type).toBe('chat_reply');
      const toolCall = mockServices.toolService.handleToolCallsWithAtomicSave.mock.calls[0][0];
      expect(toolCall.tool_calls).toHaveLength(2);
    });
  });

  describe('News detection', () => {
    const newsTestCases = [
      { query: 'FT headlines', sources: ['ft.com'], cleaned: 'headlines' },
      { query: 'WSJ and NYT news', sources: ['wsj.com', 'nytimes.com'], cleaned: 'news' },
      { query: 'regular search', sources: [], cleaned: 'regular search' }
    ];

    newsTestCases.forEach(({ query, sources, cleaned }) => {
      it(`should detect sources: ${sources.join(', ') || 'none'}`, () => {
        mockServices.searchService.detectNewsSources.mockReturnValue({
          sources,
          cleanedQuery: cleaned
        });

        const result = agentService.detectNewsSources(query);
        
        expect(result.sources).toEqual(sources);
        expect(result.cleanedQuery).toBe(cleaned);
      });
    });
  });

  describe('Lifecycle', () => {
    it('should support health check', async () => {
      const isHealthy = await agentService.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it('should clear conversations', () => {
      mockServices.conversationService.getActiveConversationCount
        .mockReturnValueOnce(2)
        .mockReturnValueOnce(0);

      expect(agentService.getActiveConversationCount()).toBe(2);
      agentService.clearAllConversations();
      expect(agentService.getActiveConversationCount()).toBe(0);
    });
  });
});