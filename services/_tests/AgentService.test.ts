/**
 * AgentService Test Suite
 * 
 * Tests the orchestration capabilities of AgentService after refactoring to delegate
 * functionality to specialized services:
 * - ConversationService: Manages sessions and conversation history
 * - LLMClient: Handles OpenAI API interactions
 * - SearchService: Orchestrates search operations and news source detection
 * - ToolService: Executes agent tools
 * - StreamManager: Manages streaming responses
 * 
 * The tests focus on:
 * 1. Service orchestration and coordination
 * 2. Error propagation from sub-services
 * 3. Streaming functionality
 * 4. Edge cases in service interaction
 * 5. Backward compatibility of the public API
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import Database from 'better-sqlite3';
import { AgentService } from '../AgentService';
import { SetIntentPayload } from '../../shared/types';
import { logger } from '../../utils/logger';
import runMigrations from '../../models/runMigrations';
import { ConversationService } from '../agents/ConversationService';
import { LLMClient } from '../agents/LLMClient';
import { SearchService } from '../agents/SearchService';
import { ToolService } from '../agents/ToolService';
import { StreamManager } from '../StreamManager';
import { OpenAIMessage } from '../../shared/types/agent.types';
import { ON_INTENT_RESULT } from '../../shared/ipcChannels';

// Mock logger to prevent console output during tests
vi.mock('../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock utils/llm
vi.mock('../../utils/llm');

// Mock fetch globally
global.fetch = vi.fn();

describe('AgentService with BaseService', () => {
  let db: Database.Database;
  let agentService: AgentService;
  let mockConversationService: ConversationService;
  let mockLLMClient: LLMClient;
  let mockSearchService: SearchService;
  let mockToolService: ToolService;
  let mockStreamManager: StreamManager;
  const mockOpenAIKey = 'test-openai-key';
  
  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Set up environment
    process.env.OPENAI_API_KEY = mockOpenAIKey;
    
    // Create in-memory database
    db = new Database(':memory:');
    await runMigrations(db);
    
    // Create mock instances
    mockConversationService = {
      ensureSession: vi.fn().mockResolvedValue('test-session-id'),
      saveMessage: vi.fn().mockResolvedValue('message-id'),
      updateMessage: vi.fn().mockResolvedValue(undefined),
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
    } as unknown as ConversationService;
    
    mockLLMClient = {
      prepareMessages: vi.fn().mockResolvedValue([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'test intent' }
      ]),
      callOpenAI: vi.fn(),
      streamOpenAI: vi.fn(),
      initialize: vi.fn(),
      cleanup: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true)
    } as unknown as LLMClient;
    
    mockSearchService = {
      clearSearchResults: vi.fn(),
      getCurrentSearchResults: vi.fn().mockReturnValue([]),
      accumulateSearchResults: vi.fn(),
      searchNews: vi.fn().mockResolvedValue([]),
      detectNewsSources: vi.fn().mockReturnValue({ sources: [], cleanedQuery: '' }),
      processSearchResultsToSlices: vi.fn().mockResolvedValue([]),
      initialize: vi.fn(),
      cleanup: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true)
    } as unknown as SearchService;
    
    mockToolService = {
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
    } as unknown as ToolService;
    
    mockStreamManager = {
      startStream: vi.fn().mockResolvedValue({ messageId: 'stream-msg-id' }),
      initialize: vi.fn(),
      cleanup: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true)
    } as unknown as StreamManager;
    
    // Create AgentService instance with dependency injection
    agentService = new AgentService({
      db,
      conversationService: mockConversationService,
      llmClient: mockLLMClient,
      searchService: mockSearchService,
      toolService: mockToolService,
      streamManager: mockStreamManager
    });
    
    // Initialize service
    await agentService.initialize();
    
    // Clear any existing conversation history to ensure test isolation
    agentService.clearAllConversations();
  });
  
  afterEach(async () => {
    // Cleanup service
    await agentService.cleanup();
    
    if (db && db.open) {
      db.close();
    }
    
    delete process.env.OPENAI_API_KEY;
    vi.clearAllMocks();
  });
  
  describe('Constructor and BaseService integration', () => {
    it('should initialize with proper dependencies', () => {
      expect(agentService).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith('AgentService initialized');
    });

    it('should inherit BaseService functionality', async () => {
      // Test that execute wrapper works
      const payload: SetIntentPayload = {
        intentText: 'test intent',
        context: 'test'
      };
      
      // Mock the LLM to return a simple response
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'Test response'
      });
      
      await agentService.processComplexIntent(payload, 1);
      
      // Should log the operation with execute wrapper format
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[AgentService] processComplexIntent started')
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[AgentService] processComplexIntent completed')
      );
    });
    
    it('should handle missing OpenAI key', async () => {
      delete process.env.OPENAI_API_KEY;
      const serviceWithoutKey = new AgentService({
        db,
        conversationService: mockConversationService,
        llmClient: mockLLMClient,
        searchService: mockSearchService,
        toolService: mockToolService,
        streamManager: mockStreamManager
      });
      expect(serviceWithoutKey).toBeDefined();
    });
  });

  describe('Lifecycle methods', () => {
    it('should support initialize method', async () => {
      // Already called in beforeEach, create a new instance to test
      const newService = new AgentService({
        db,
        conversationService: mockConversationService,
        llmClient: mockLLMClient,
        searchService: mockSearchService,
        toolService: mockToolService,
        streamManager: mockStreamManager
      });
      await expect(newService.initialize()).resolves.toBeUndefined();
    });

    it('should support cleanup method', async () => {
      // Add some conversation history
      const payload: SetIntentPayload = {
        intentText: 'test intent',
        context: 'test'
      };
      
      // Mock LLM response
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'Test response'
      });
      
      // Mock conversation service to simulate having conversations
      (mockConversationService.getActiveConversationCount as Mock).mockReturnValue(1);
      
      await agentService.processComplexIntent(payload, 1);
      
      // Cleanup should complete without error
      await agentService.cleanup();
      
      // Verify cleanup logged
      expect(logger.info).toHaveBeenCalledWith('Cleaning up AgentService');
    });

    it('should support health check', async () => {
      const isHealthy = await agentService.healthCheck();
      expect(isHealthy).toBe(true);
    });
  });

  describe('Error handling with BaseService', () => {
    it('should use execute wrapper for error handling', async () => {
      // Mock the LLM to throw an error
      (mockLLMClient.callOpenAI as Mock).mockRejectedValueOnce(new Error('LLM connection failed'));

      const payload: SetIntentPayload = {
        intentText: 'test intent',
        context: 'test'
      };

      await expect(agentService.processComplexIntent(payload, 1)).rejects.toThrow('LLM connection failed');
      
      // Should log the error with proper context
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[AgentService] processComplexIntent failed'),
        expect.any(Error)
      );
    });
  });

  describe('Dependency injection patterns', () => {
    it('should work with fully mocked dependencies', async () => {
      // All dependencies are already mocked in beforeEach
      const payload: SetIntentPayload = {
        intentText: 'search for test',
        context: 'test'
      };
      
      // Setup mock responses
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'No results found'
      });
      
      const result = await agentService.processComplexIntent(payload, 1);
      
      expect(result).toBeDefined();
      expect(result?.type).toBe('chat_reply');
    });
  });
  
  describe('processComplexIntent - search_web', () => {
    it('should use tool service for web search', async () => {
      const mockSearchResults = [
        {
          id: '1',
          title: 'Test Article',
          content: 'This is a test article about the topic...',
          url: 'https://example.com/article',
          score: 0.950,
          source: 'web' as const,
          publishedDate: '2024-01-15'
        }
      ];
      
      // Mock search service to have results
      (mockSearchService.getCurrentSearchResults as Mock).mockReturnValue(mockSearchResults);
      
      // Mock first call - returns tool calls
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-123',
          type: 'function',
          function: {
            name: 'search_web',
            arguments: JSON.stringify({ query: 'test search query' }),
          },
        }]
      });
      
      // Mock tool service response
      (mockToolService.handleToolCallsWithAtomicSave as Mock).mockResolvedValueOnce({
        toolResults: [{ content: 'Search results for test search query' }],
        hasSearchResults: true,
        hasMeaningfulContent: true
      });
      
      // Mock second call - returns summary
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'Based on my search, here\'s what I found about test search query...'
      });
      
      const payload: SetIntentPayload = {
        intentText: 'search for information about quantum computing',
        context: 'welcome'
      };
      
      const result = await agentService.processComplexIntent(payload, 1);
      
      // Verify tool service was called
      expect(mockToolService.handleToolCallsWithAtomicSave).toHaveBeenCalled();
      
      // Verify result
      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
      if (result && result.type === 'chat_reply') {
        expect(result.message).toContain('test search query');
      }
    });
    
    it('should handle search errors gracefully', async () => {
      // Mock response with tool call
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-456',
          type: 'function',
          function: {
            name: 'search_web',
            arguments: JSON.stringify({ query: 'failing search' }),
          },
        }]
      });
      
      // Mock tool service to handle the error gracefully
      (mockToolService.handleToolCallsWithAtomicSave as Mock).mockResolvedValueOnce({
        toolResults: [{ content: 'Error: Search service unavailable' }],
        hasSearchResults: false,
        hasMeaningfulContent: true
      });
      
      // Mock summary response after error
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'I encountered an error while searching, but here is what I can tell you...'
      });
      
      const payload: SetIntentPayload = {
        intentText: 'search for something that will fail',
        context: 'welcome'
      };
      
      const result = await agentService.processComplexIntent(payload, 2);
      
      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
      if (result && result.type === 'chat_reply') {
        // Error is handled gracefully and AI provides a response
        expect(result.message).toBeTruthy();
      }
    });
    
    it('should handle invalid search query', async () => {
      // Mock response with tool call containing invalid query
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-789',
          type: 'function',
          function: {
            name: 'search_web',
            arguments: JSON.stringify({ query: null }), // Invalid query
          },
        }]
      });
      
      // Mock tool service to handle invalid query
      (mockToolService.handleToolCallsWithAtomicSave as Mock).mockResolvedValueOnce({
        toolResults: [{ content: 'Error: Invalid query provided' }],
        hasSearchResults: false,
        hasMeaningfulContent: true
      });
      
      // Mock summary response after error
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'I couldn\'t perform the search due to an invalid query.'
      });
      
      const payload: SetIntentPayload = {
        intentText: 'search with invalid query',
        context: 'welcome'
      };
      
      const result = await agentService.processComplexIntent(payload, 3);
      
      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
      if (result && result.type === 'chat_reply') {
        // The error message is returned and then AI tries to summarize
        expect(result.message).toBeTruthy();
      }
    });
  });
  
  describe('conversation history management', () => {
    it('should maintain conversation history across calls', async () => {
      // Mock first response
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'First response'
      });
      
      // Mock second response
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'Second response with context'
      });
      
      // Mock prepare messages to return accumulated history
      let callCount = 0;
      (mockLLMClient.prepareMessages as Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'first question' }
          ];
        } else {
          return [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'First response' },
            { role: 'user', content: 'follow-up question' }
          ];
        }
      });
      
      const senderId = 100;
      
      // First call
      await agentService.processComplexIntent({ intentText: 'first question', context: 'welcome' }, senderId);
      
      // Second call - should include history
      await agentService.processComplexIntent({ intentText: 'follow-up question', context: 'welcome' }, senderId);
      
      // Check that the LLM was called twice
      expect(mockLLMClient.callOpenAI).toHaveBeenCalledTimes(2);
      
      // Verify conversation service was called to update history
      expect(mockConversationService.updateConversationHistory).toHaveBeenCalled();
    });
    
    it('should clear conversation history', () => {
      const senderId = "200";
      
      // Mock conversation service to simulate having history
      (mockConversationService.getActiveConversationCount as Mock)
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(0);
      
      expect(agentService.getActiveConversationCount()).toBe(1);
      
      agentService.clearConversation(senderId);
      
      expect(mockConversationService.clearConversation).toHaveBeenCalledWith(senderId);
      expect(agentService.getActiveConversationCount()).toBe(0);
    });
    
    it('should clear all conversations', () => {
      // Mock conversation service to simulate having multiple conversations
      (mockConversationService.getActiveConversationCount as Mock)
        .mockReturnValueOnce(3)
        .mockReturnValueOnce(0);
      
      expect(agentService.getActiveConversationCount()).toBe(3);
      
      agentService.clearAllConversations();
      
      expect(mockConversationService.clearAllConversations).toHaveBeenCalled();
      expect(agentService.getActiveConversationCount()).toBe(0);
    });
  });
  
  describe('error handling', () => {
    it('should handle missing OpenAI key', async () => {
      // Mock the LLM to throw an error
      (mockLLMClient.callOpenAI as Mock).mockRejectedValueOnce(new Error('OpenAI API key not configured'));
      
      // The service will throw the error, not return an error payload
      await expect(agentService.processComplexIntent(
        { intentText: 'test', context: 'welcome' },
        1
      )).rejects.toThrow('OpenAI API key not configured');
      
      // Verify that the error message was attempted to be saved
      expect(mockConversationService.saveMessage).toHaveBeenCalledWith(
        'test-session-id',
        'assistant',
        'I encountered an error processing your request. Please try again.',
        expect.objectContaining({ error: 'OpenAI API key not configured' })
      );
    });
    
    it('should handle OpenAI API errors', async () => {
      // Mock the LLM to throw an API error
      (mockLLMClient.callOpenAI as Mock).mockRejectedValueOnce(new Error('Invalid API key'));
      
      // The service will throw the error, not return an error payload
      await expect(agentService.processComplexIntent(
        { intentText: 'test', context: 'welcome' },
        1
      )).rejects.toThrow('Invalid API key');
      
      // Verify that the error message was attempted to be saved
      expect(mockConversationService.saveMessage).toHaveBeenCalledWith(
        'test-session-id',
        'assistant',
        'I encountered an error processing your request. Please try again.',
        expect.objectContaining({ error: 'Invalid API key' })
      );
    });
  });

  describe('detectNewsSources', () => {
    it('should detect single news source', () => {
      (mockSearchService.detectNewsSources as Mock).mockReturnValue({
        sources: ['ft.com'],
        cleanedQuery: 'headlines today'
      });
      
      const { sources, cleanedQuery } = agentService.detectNewsSources('headlines from FT today');
      
      expect(sources).toEqual(['ft.com']);
      expect(cleanedQuery).toBe('headlines today');
    });
    
    it('should detect multiple news sources', () => {
      (mockSearchService.detectNewsSources as Mock).mockReturnValue({
        sources: ['ft.com', 'wsj.com', 'nytimes.com'],
        cleanedQuery: 'what are headlines today?'
      });
      
      const { sources, cleanedQuery } = agentService.detectNewsSources(
        'what are the headlines in the FT, WSJ, and NYT today?'
      );
      
      expect(sources).toContain('ft.com');
      expect(sources).toContain('wsj.com');
      expect(sources).toContain('nytimes.com');
      expect(sources).toHaveLength(3);
      expect(cleanedQuery).toBe('what are headlines today?');
    });
    
    it('should handle various aliases', () => {
      // Test different aliases
      const testCases = [
        { input: 'financial times news', expected: 'ft.com' },
        { input: 'wall street journal headlines', expected: 'wsj.com' },
        { input: 'ny times stories', expected: 'nytimes.com' },
        { input: 'the guardian articles', expected: 'theguardian.com' },
        { input: 'BBC news', expected: 'bbc.com' },
      ];
      
      testCases.forEach(({ input, expected }) => {
        (mockSearchService.detectNewsSources as Mock).mockReturnValue({
          sources: [expected],
          cleanedQuery: input.replace(/financial times|wall street journal|ny times|the guardian|BBC/gi, '').trim()
        });
        
        const { sources } = agentService.detectNewsSources(input);
        expect(sources).toContain(expected);
      });
    });
    
    it('should return empty sources for non-news queries', () => {
      (mockSearchService.detectNewsSources as Mock).mockReturnValue({
        sources: [],
        cleanedQuery: 'search for quantum computing'
      });
      
      const { sources, cleanedQuery } = agentService.detectNewsSources('search for quantum computing');
      
      expect(sources).toEqual([]);
      expect(cleanedQuery).toBe('search for quantum computing');
    });
  });

  describe('multi-source news search', () => {
    it('should search multiple sources in parallel', async () => {
      
      // Mock search results for multi-source news
      const mockNewsResults = [
        {
          id: 'ft-1',
          title: 'FT Headline',
          url: 'https://ft.com/article1',
          content: 'Financial Times article content',
          score: 0.95,
          source: 'exa' as const,
        },
        {
          id: 'wsj-1',
          title: 'WSJ Headline',
          url: 'https://wsj.com/article1',
          content: 'Wall Street Journal article content',
          score: 0.93,
          source: 'exa' as const,
        },
        {
          id: 'nyt-1',
          title: 'NYT Headline',
          url: 'https://nytimes.com/article1',
          content: 'New York Times article content',
          score: 0.91,
          source: 'exa' as const,
        },
      ];
      
      // Mock search service to return accumulated results
      (mockSearchService.getCurrentSearchResults as Mock).mockReturnValue(mockNewsResults);
      
      // Mock first call - returns tool calls
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-multi-1',
          type: 'function',
          function: {
            name: 'search_web',
            arguments: JSON.stringify({
              query: 'headlines from FT, WSJ, and NYT today',
              searchType: 'headlines',
            }),
          },
        }]
      });
      
      // Mock tool service to handle the search
      (mockToolService.handleToolCallsWithAtomicSave as Mock).mockResolvedValueOnce({
        toolResults: [{ content: 'Found news from multiple sources' }],
        hasSearchResults: true,
        hasMeaningfulContent: true
      });
      
      // Mock second call - returns summary
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'Here are today\'s headlines from FT, WSJ, and NYT...'
      });
      
      const result = await agentService.processComplexIntent(
        { intentText: 'what are the headlines in the FT, WSJ, and NYT today?', context: 'welcome' },
        123
      );
      
      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
    });
    
    it('should handle partial failures in multi-source search', async () => {
      // Mock first call - returns tool calls
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-partial-1',
          type: 'function',
          function: {
            name: 'search_web',
            arguments: JSON.stringify({
              query: 'headlines from FT, WSJ, and NYT',
              searchType: 'headlines',
            }),
          },
        }]
      });
      
      // Mock tool service to handle partial failures
      (mockToolService.handleToolCallsWithAtomicSave as Mock).mockResolvedValueOnce({
        toolResults: [{ content: 'Found news from FT and NYT. WSJ search failed.' }],
        hasSearchResults: true,
        hasMeaningfulContent: true
      });
      
      // Mock second call - returns summary
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'I found headlines from FT and NYT. WSJ search failed.'
      });
      
      const result = await agentService.processComplexIntent(
        { intentText: 'headlines from FT, WSJ, and NYT', context: 'welcome' },
        124
      );
      
      // Should still return results from successful sources
      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
    });
  });

  // Note: Conversation history filtering tests have been removed as they were testing
  // private implementation details that may no longer exist in the current implementation.

  // Note: Formatting tests have been removed as they were testing private implementation details
  // that have been moved to SearchResultFormatter class. The formatting functionality
  // is now tested through the public API of AgentService.

  describe('OpenAI integration behavior', () => {
    it('should handle multiple tool calls in a single response', async () => {
      // Mock response with multiple tool calls
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({ 
                query: 'headlines from FT today',
                searchType: 'headlines'
              })
            }
          },
          {
            id: 'call_2',
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({ 
                query: 'headlines from WSJ today',
                searchType: 'headlines'
              })
            }
          },
          {
            id: 'call_3',
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({ 
                query: 'headlines from NYT today',
                searchType: 'headlines'
              })
            }
          }
        ]
      });
      
      // Mock tool service to handle all tool calls
      (mockToolService.handleToolCallsWithAtomicSave as Mock).mockResolvedValueOnce({
        toolResults: [
          { content: 'FT search results' },
          { content: 'WSJ search results' },
          { content: 'NYT search results' }
        ],
        hasSearchResults: true,
        hasMeaningfulContent: true
      });
      
      // Mock summary response
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'Here are the headlines from FT, WSJ, and NYT...'
      });
      
      const result = await agentService.processComplexIntent(
        { intentText: 'headlines from FT, WSJ, and NYT', context: 'welcome' },
        300
      );
      
      // Verify tool service was called with multiple tool calls
      const toolServiceCall = (mockToolService.handleToolCallsWithAtomicSave as Mock).mock.calls[0];
      expect(toolServiceCall[0].tool_calls).toHaveLength(3);
      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
    });

    it('should persist tool responses correctly through follow-up questions', async () => {
      // First request with tool call
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_123',
          type: 'function',
          function: {
            name: 'search_web',
            arguments: JSON.stringify({ query: 'test search' })
          }
        }]
      });
      
      // Mock tool service response
      (mockToolService.handleToolCallsWithAtomicSave as Mock).mockResolvedValueOnce({
        toolResults: [{ content: 'Test search results' }],
        hasSearchResults: true,
        hasMeaningfulContent: true
      });
      
      // Follow-up response after tool execution
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'Here are the search results...'
      });
      
      // First query
      await agentService.processComplexIntent(
        { intentText: 'search for something', context: 'welcome' },
        400
      );
      
      // Verify conversation service was called to update history
      expect(mockConversationService.updateConversationHistory).toHaveBeenCalled();
      
      // Mock prepare messages to include previous conversation
      (mockLLMClient.prepareMessages as Mock).mockResolvedValueOnce([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'search for something' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_123', type: 'function', function: { name: 'search_web', arguments: '{"query":"test search"}' }}] },
        { role: 'tool', content: 'Test search results', tool_call_id: 'call_123' },
        { role: 'assistant', content: 'Here are the search results...' },
        { role: 'user', content: 'tell me more' }
      ]);
      
      // Second query - should work without tool_call_id errors
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'Let me help with that follow-up...'
      });
      
      const result = await agentService.processComplexIntent(
        { intentText: 'tell me more', context: 'welcome' },
        400
      );
      
      // Should succeed without tool_call_id errors
      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
      if (result && result.type === 'chat_reply') {
        expect(result.message).not.toContain('tool_call_id');
      }
    });

    it('should handle system prompt instruction mismatch gracefully', async () => {
      // Mock OpenAI following system prompt literally (one source per call)
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_single',
          type: 'function',
          function: {
            name: 'search_web',
            arguments: JSON.stringify({ 
              query: 'headlines from NYT today', // Only one source!
              searchType: 'headlines'
            })
          }
        }]
      });
      
      // Mock tool service response
      (mockToolService.handleToolCallsWithAtomicSave as Mock).mockResolvedValueOnce({
        toolResults: [{ content: 'NYT search results' }],
        hasSearchResults: true,
        hasMeaningfulContent: true
      });
      
      // Mock summary response
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'Here are the NYT headlines...'
      });
      
      const result = await agentService.processComplexIntent(
        { intentText: 'headlines from NYT, FT, and WSJ', context: 'welcome' },
        500
      );
      
      // The implementation should handle this gracefully
      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
    });
  });

  describe('Message Validation', () => {
    it('should detect and fix orphaned tool calls when loading from database', async () => {
      const mockMessages: OpenAIMessage[] = [
        {
          role: 'user',
          content: 'Tell me about Psalm 139'
        },
        {
          role: 'assistant',
          content: 'Let me search for that.',
          tool_calls: [
            { id: 'call_123', type: 'function', function: { name: 'search_web', arguments: '{"query":"Psalm 139"}' } },
            { id: 'call_456', type: 'function', function: { name: 'search_web', arguments: '{"query":"Psalm 139 KJV"}' } }
          ]
        },
        // Only one tool response - missing response for call_456
        {
          role: 'tool',
          content: 'Search results for Psalm 139...',
          tool_call_id: 'call_123'
        }
      ];

      // Mock conversation service to validate and sanitize messages
      (mockConversationService.loadMessagesFromDatabase as Mock).mockResolvedValue([
        mockMessages[0],
        {
          ...mockMessages[1],
          tool_calls: [mockMessages[1].tool_calls![0]] // Only the tool call with a response
        },
        mockMessages[2]
      ]);

      // Mock prepare messages to use the sanitized messages
      (mockLLMClient.prepareMessages as Mock).mockImplementation(async () => {
        const messages = await mockConversationService.loadMessagesFromDatabase('test-session');
        return [
          { role: 'system', content: 'You are a helpful assistant.' },
          ...messages,
          { role: 'user', content: 'new question' }
        ];
      });

      // Mock LLM response
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'Based on the previous search results...'
      });

      // Process intent - should work with sanitized messages
      const result = await agentService.processComplexIntent(
        { intentText: 'new question', context: 'welcome' },
        'test-sender'
      );
      
      // Should succeed without errors
      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
      
      // Verify conversation service loaded messages from database
      expect(mockConversationService.loadMessagesFromDatabase).toHaveBeenCalled();
    });
  });

  describe('Service orchestration and error propagation', () => {
    it('should propagate errors from ConversationService', async () => {
      // Mock conversation service to throw error
      (mockConversationService.ensureSession as Mock).mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      await expect(
        agentService.processComplexIntent(
          { intentText: 'test query', context: 'welcome' },
          'test-sender'
        )
      ).rejects.toThrow('Database connection failed');

      // Verify error was logged
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[AgentService] processComplexIntent failed'),
        expect.any(Error)
      );
    });

    it('should propagate errors from LLMClient', async () => {
      // Mock LLM client to throw error
      (mockLLMClient.prepareMessages as Mock).mockRejectedValueOnce(
        new Error('Failed to prepare messages')
      );

      await expect(
        agentService.processComplexIntent(
          { intentText: 'test query', context: 'welcome' },
          'test-sender'
        )
      ).rejects.toThrow('Failed to prepare messages');
    });

    it('should propagate errors from SearchService', async () => {
      // Mock tool service to propagate search service error
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'search_web', arguments: '{"query":"test"}' }
        }]
      });

      (mockToolService.handleToolCallsWithAtomicSave as Mock).mockRejectedValueOnce(
        new Error('Search service unavailable')
      );

      await expect(
        agentService.processComplexIntent(
          { intentText: 'search for something', context: 'welcome' },
          'test-sender'
        )
      ).rejects.toThrow('Search service unavailable');
    });

    it('should propagate errors from ToolService', async () => {
      // Mock LLM to return tool calls
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'unknown_tool', arguments: '{}' }
        }]
      });

      // Mock tool service to throw error
      (mockToolService.handleToolCallsWithAtomicSave as Mock).mockRejectedValueOnce(
        new Error('Unknown tool: unknown_tool')
      );

      await expect(
        agentService.processComplexIntent(
          { intentText: 'use unknown tool', context: 'welcome' },
          'test-sender'
        )
      ).rejects.toThrow('Unknown tool: unknown_tool');
    });

    it('should handle partial failures in sub-services gracefully', async () => {
      // Mock successful conversation and LLM calls
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'Here is your answer'
      });

      // Mock save message to fail (non-critical)
      (mockConversationService.saveMessage as Mock)
        .mockRejectedValueOnce(new Error('Save failed'))
        .mockResolvedValue('msg-id'); // Succeed on retry

      const result = await agentService.processComplexIntent(
        { intentText: 'test query', context: 'welcome' },
        'test-sender'
      );

      // Should still return result despite save failure
      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
      expect(result!.message).toBe('Here is your answer');

      // Verify error was logged but not thrown
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to save user message:',
        expect.any(Error)
      );
    });
  });

  describe('Streaming orchestration', () => {
    let mockSender: WebContents;

    beforeEach(() => {
      mockSender = {
        send: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false)
      } as unknown as WebContents;
    });

    it('should coordinate streaming with all services', async () => {
      // Mock successful orchestration
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'search_web', arguments: '{"query":"test"}' }
        }]
      });

      // Mock search results
      (mockSearchService.getCurrentSearchResults as Mock).mockReturnValue([
        { id: '1', title: 'Result 1', content: 'Content 1' }
      ]);

      // Mock tool service to return search results
      (mockToolService.handleToolCallsForStreamingWithAtomicSave as Mock).mockResolvedValueOnce([
        { content: 'Search completed', immediateReturn: null }
      ]);

      // Mock slice processing
      (mockSearchService.processSearchResultsToSlices as Mock).mockResolvedValueOnce([
        { id: '1', title: 'Result 1', content: 'Content 1', type: 'search' }
      ]);

      // Mock streaming
      const mockStream = async function* () {
        yield 'Here ';
        yield 'are ';
        yield 'the ';
        yield 'results';
      };
      (mockLLMClient.streamOpenAI as Mock).mockReturnValue(mockStream());

      // Mock stream manager to handle the stream
      (mockStreamManager.startStream as Mock).mockImplementation(async (sender, generator) => {
        const chunks = [];
        for await (const chunk of generator) {
          chunks.push(chunk);
        }
        return { messageId: 'stream-msg-1' };
      });

      await agentService.processComplexIntentWithStreaming(
        { intentText: 'search for test', context: 'welcome' },
        'test-sender',
        mockSender,
        'correlation-123'
      );

      // Verify orchestration flow
      expect(mockConversationService.ensureSession).toHaveBeenCalledWith('test-sender');
      expect(mockLLMClient.prepareMessages).toHaveBeenCalled();
      expect(mockConversationService.saveMessage).toHaveBeenCalled();
      expect(mockLLMClient.callOpenAI).toHaveBeenCalled();
      expect(mockToolService.handleToolCallsForStreamingWithAtomicSave).toHaveBeenCalled();
      expect(mockSearchService.processSearchResultsToSlices).toHaveBeenCalled();
      expect(mockStreamManager.startStream).toHaveBeenCalled();

      // Verify slices were sent
      expect(mockSender.send).toHaveBeenCalledWith(
        ON_INTENT_RESULT,
        expect.objectContaining({
          type: 'chat_reply',
          slices: expect.arrayContaining([
            expect.objectContaining({ id: '1', title: 'Result 1' })
          ])
        })
      );
    });

    it('should handle streaming errors from sub-services', async () => {
      // Mock LLM to throw during streaming
      (mockLLMClient.streamOpenAI as Mock).mockImplementation(async function* () {
        yield 'Starting...';
        throw new Error('Stream interrupted');
      });

      // Mock initial success
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'Direct response'
      });

      // Mock stream manager to propagate error
      (mockStreamManager.startStream as Mock).mockRejectedValueOnce(
        new Error('Stream interrupted')
      );

      await agentService.processComplexIntentWithStreaming(
        { intentText: 'test query', context: 'welcome' },
        'test-sender',
        mockSender,
        'correlation-123'
      );

      // Verify error was logged
      expect(logger.error).toHaveBeenCalledWith(
        'Direct streaming error:',
        expect.any(Error)
      );
    });
  });

  describe('Service coordination edge cases', () => {
    it('should handle when search service has no results but tool execution succeeds', async () => {
      // Mock tool calls
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'search_web', arguments: '{"query":"obscure topic"}' }
        }]
      });

      // Mock empty search results
      (mockSearchService.getCurrentSearchResults as Mock).mockReturnValue([]);

      // Mock tool service response
      (mockToolService.handleToolCallsWithAtomicSave as Mock).mockResolvedValueOnce({
        toolResults: [{ content: 'No results found for obscure topic' }],
        hasSearchResults: false,
        hasMeaningfulContent: true
      });

      // Mock summary generation
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'I could not find any information about that topic.'
      });

      const result = await agentService.processComplexIntent(
        { intentText: 'search for obscure topic', context: 'welcome' },
        'test-sender'
      );

      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
      expect(result!.message).toContain('could not find');
    });

    it('should handle conversation history limits across services', async () => {
      // Create a large conversation history
      const largeHistory = [];
      for (let i = 0; i < 100; i++) {
        largeHistory.push(
          { role: 'user', content: `Question ${i}` },
          { role: 'assistant', content: `Answer ${i}` }
        );
      }

      // Mock conversation service to return large history
      (mockConversationService.loadMessagesFromDatabase as Mock).mockResolvedValueOnce(largeHistory);
      
      // Mock LLM client to handle the history appropriately
      (mockLLMClient.prepareMessages as Mock).mockImplementation(async () => {
        // Should truncate to reasonable size
        return [
          { role: 'system', content: 'You are a helpful assistant.' },
          ...largeHistory.slice(-10), // Last 10 messages
          { role: 'user', content: 'new question' }
        ];
      });

      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: 'Response considering recent context'
      });

      const result = await agentService.processComplexIntent(
        { intentText: 'new question', context: 'welcome' },
        'test-sender'
      );

      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
      
      // Verify prepare messages was called and handled truncation
      expect(mockLLMClient.prepareMessages).toHaveBeenCalled();
    });

    it('should coordinate immediate returns from tool service', async () => {
      // Mock tool calls for immediate return actions
      (mockLLMClient.callOpenAI as Mock).mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'open_notebook', arguments: '{"notebookId":"nb-123"}' }
        }]
      });

      // Mock tool service to return immediate action
      (mockToolService.handleToolCallsWithAtomicSave as Mock).mockResolvedValueOnce({
        toolResults: [{
          content: 'Opened notebook',
          immediateReturn: { type: 'open_notebook', notebookId: 'nb-123' }
        }],
        hasSearchResults: false,
        hasMeaningfulContent: false
      });

      const result = await agentService.processComplexIntent(
        { intentText: 'open my notes', context: 'welcome' },
        'test-sender'
      );

      expect(result).toBeDefined();
      expect(result!.type).toBe('open_notebook');
      expect((result as any).notebookId).toBe('nb-123');

      // Verify no summary was attempted
      expect(mockLLMClient.callOpenAI).toHaveBeenCalledTimes(1); // Only initial call
    });
  });
});