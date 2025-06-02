import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { AgentService } from '../AgentService';
import { NotebookService } from '../NotebookService';
import { SetIntentPayload } from '../../shared/types';
import { HybridSearchService } from '../HybridSearchService';
import { HybridSearchResult } from '../../shared/types';
import { ExaService } from '../ExaService';
import { LLMService } from '../LLMService';
import { ChatModel } from '../../models/ChatModel';

// Mock dependencies
vi.mock('../NotebookService');
vi.mock('../ExaService');
vi.mock('../HybridSearchService');
vi.mock('../LLMService');
vi.mock('../../models/ChatModel');

// Mock fetch globally
global.fetch = vi.fn();

describe('AgentService', () => {
  let agentService: AgentService;
  let mockNotebookService: NotebookService;
  let mockLLMService: LLMService;
  let mockHybridSearchService: HybridSearchService;
  let mockExaService: ExaService;
  let mockChatModel: ChatModel;
  let mockSliceService: any;
  const mockOpenAIKey = 'test-openai-key';
  
  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Set up environment
    process.env.OPENAI_API_KEY = mockOpenAIKey;
    
    // Create mock instances
    mockNotebookService = new NotebookService({} as any, {} as any, {} as any, {} as any, {} as any);
    mockLLMService = new LLMService({} as any);
    mockExaService = new ExaService();
    mockHybridSearchService = new HybridSearchService({} as any, {} as any);
    mockChatModel = new ChatModel({} as any);
    mockSliceService = {}; // Mock SliceService
    
    // Mock NotebookService methods
    (mockNotebookService.getAllNotebooks as Mock).mockResolvedValue([
      { id: 'nb-1', title: 'Test Notebook', description: 'Test' },
      { id: 'nb-2', title: 'Another Notebook', description: 'Another' },
    ]);
    (mockNotebookService.getAllRegularNotebooks as Mock).mockResolvedValue([
      { id: 'nb-1', title: 'Test Notebook', description: 'Test' },
      { id: 'nb-2', title: 'Another Notebook', description: 'Another' },
    ]);
    (mockNotebookService.getNotebookCover as Mock).mockResolvedValue({
      id: 'agent-conversations',
      title: 'Agent Conversations',
      description: 'NotebookCover for agent conversations',
      objectId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    // Mock ChatModel methods
    (mockChatModel.createSession as Mock).mockResolvedValue({
      sessionId: 'test-session-id',
      notebookId: 'agent-conversations',
      createdAt: new Date(),
      updatedAt: new Date(),
      title: 'Test Session'
    });
    (mockChatModel.addMessage as Mock).mockResolvedValue({});
    (mockChatModel.getMessagesBySessionId as Mock).mockResolvedValue([]);
    
    // Mock ExaService methods
    (mockExaService.isConfigured as Mock) = vi.fn().mockReturnValue(true);
    (mockExaService.search as Mock) = vi.fn();
    
    // Mock HybridSearchService methods
    (mockHybridSearchService.search as Mock) = vi.fn();
    (mockHybridSearchService.searchLocal as Mock) = vi.fn();
    (mockHybridSearchService.searchNews as Mock) = vi.fn();
    
    // Mock LLMService methods - create a flexible mock that can be customized per test
    const mockInvoke = vi.fn();
    const mockBind = vi.fn().mockReturnValue({ invoke: mockInvoke });
    const mockLangchainModel = { bind: mockBind };
    (mockLLMService.getLangchainModel as Mock).mockReturnValue(mockLangchainModel);
    
    // Create AgentService instance with all dependencies
    agentService = new AgentService(mockNotebookService, mockLLMService, mockHybridSearchService, mockExaService, mockChatModel, mockSliceService);
    
    // Store references for test access AFTER creating agentService
    (agentService as any).mockInvoke = mockInvoke;
    (agentService as any).mockBind = mockBind;
  });
  
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });
  
  describe('constructor', () => {
    it('should initialize with dependencies', () => {
      expect(agentService).toBeDefined();
      expect((agentService as any).notebookService).toBe(mockNotebookService);
      expect((agentService as any).hybridSearchService).toBeDefined();
      expect((agentService as any).exaService).toBeDefined();
    });
    
    it('should handle missing OpenAI key', () => {
      delete process.env.OPENAI_API_KEY;
      const serviceWithoutKey = new AgentService(mockNotebookService, mockLLMService, mockHybridSearchService, mockExaService, mockChatModel, mockSliceService);
      expect(serviceWithoutKey).toBeDefined();
    });
  });
  
  describe('processComplexIntent - search_web', () => {
    it('should use hybridSearchService for web search', async () => {
      const mockSearchResults = [
        {
          id: '1',
          title: 'Test Article',
          content: 'This is a test article about the topic...',
          url: 'https://example.com/article',
          score: 0.950,
          source: 'Web',
          publishedDate: '2024-01-15'
        },
        {
          id: '2',
          title: 'Local Note',
          content: 'Content from your personal notes...',
          score: 0.850,
          source: 'Local Knowledge'
        }
      ];
      
      // Mock hybridSearchService.search
      (mockHybridSearchService.search as Mock).mockResolvedValue(mockSearchResults);
      
      // Get the mock invoke function from the service
      const mockInvoke = (agentService as any).mockInvoke;
      
      // Mock first call - returns tool calls
      mockInvoke.mockResolvedValueOnce({
        content: null,
        additional_kwargs: {
          tool_calls: [{
            id: 'call-123',
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({ query: 'test search query' }),
            },
          }]
        }
      });
      
      // Mock second call - returns summary
      mockInvoke.mockResolvedValueOnce({
        content: 'Based on my search, here\'s what I found about test search query...',
        additional_kwargs: {}
      });
      
      const payload: SetIntentPayload = {
        intentText: 'search for information about quantum computing',
        context: 'welcome'
      };
      
      const result = await agentService.processComplexIntent(payload, 1);
      
      // Verify hybridSearchService was called
      expect(mockHybridSearchService.search).toHaveBeenCalledWith('test search query', {
        numResults: 10
      });
      
      // Verify result
      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
      if (result && result.type === 'chat_reply') {
        expect(result.message).toContain('test search query');
      }
    });
    
    it('should handle search errors gracefully', async () => {
      // Mock hybridSearchService to throw error
      (mockHybridSearchService.search as Mock).mockRejectedValue(new Error('Search service unavailable'));
      
      // Get the mock invoke function
      const mockInvoke = (agentService as any).mockInvoke;
      
      // Mock response with tool call
      mockInvoke.mockResolvedValueOnce({
        content: null,
        additional_kwargs: {
          tool_calls: [{
            id: 'call-456',
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({ query: 'failing search' }),
            },
          }]
        }
      });
      
      // Mock summary response after error
      mockInvoke.mockResolvedValueOnce({
        content: 'I encountered an error while searching, but here is what I can tell you...',
        additional_kwargs: {}
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
      // Get the mock invoke function
      const mockInvoke = (agentService as any).mockInvoke;
      
      // Mock response with tool call containing invalid query
      mockInvoke.mockResolvedValueOnce({
        content: null,
        additional_kwargs: {
          tool_calls: [{
            id: 'call-789',
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({ query: null }), // Invalid query
            },
          }]
        }
      });
      
      // Mock summary response after error
      mockInvoke.mockResolvedValueOnce({
        content: 'I couldn\'t perform the search due to an invalid query.',
        additional_kwargs: {}
      });
      
      const payload: SetIntentPayload = {
        intentText: 'search with invalid query',
        context: 'welcome'
      };
      
      const result = await agentService.processComplexIntent(payload, 3);
      
      expect(mockHybridSearchService.search).not.toHaveBeenCalled();
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
      // Get the mock invoke function
      const mockInvoke = (agentService as any).mockInvoke;
      
      // Mock first response
      mockInvoke.mockResolvedValueOnce({
        content: 'First response',
        additional_kwargs: {}
      });
      
      // Mock second response
      mockInvoke.mockResolvedValueOnce({
        content: 'Second response with context',
        additional_kwargs: {}
      });
      
      const senderId = 100;
      
      // First call
      await agentService.processComplexIntent({ intentText: 'first question', context: 'welcome' }, senderId);
      
      // Second call - should include history
      await agentService.processComplexIntent({ intentText: 'follow-up question', context: 'welcome' }, senderId);
      
      // Check that the invoke was called twice and the second call had history
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      
      // Get the messages from the second call
      const secondCallMessages = mockInvoke.mock.calls[1][0];
      expect(secondCallMessages.length).toBeGreaterThan(2); // System + multiple messages
      
      // Verify conversation history is maintained
      const conversationHistory = (agentService as any).conversationHistory.get(String(senderId));
      expect(conversationHistory).toBeDefined();
      expect(conversationHistory.some((m: any) => m.content === 'first question')).toBe(true);
      expect(conversationHistory.some((m: any) => m.content === 'First response')).toBe(true);
    });
    
    it('should clear conversation history', () => {
      const senderId = 200;
      
      // Add some history
      (agentService as any).conversationHistory.set(senderId, [
        { role: 'user', content: 'test' },
        { role: 'assistant', content: 'response' },
      ]);
      
      expect(agentService.getActiveConversationCount()).toBe(1);
      
      agentService.clearConversation(String(senderId));
      
      expect(agentService.getActiveConversationCount()).toBe(0);
    });
    
    it('should clear all conversations', () => {
      // Add multiple conversations
      (agentService as any).conversationHistory.set(1, [{ role: 'user', content: 'test1' }]);
      (agentService as any).conversationHistory.set(2, [{ role: 'user', content: 'test2' }]);
      (agentService as any).conversationHistory.set(3, [{ role: 'user', content: 'test3' }]);
      
      expect(agentService.getActiveConversationCount()).toBe(3);
      
      agentService.clearAllConversations();
      
      expect(agentService.getActiveConversationCount()).toBe(0);
    });
  });
  
  describe('error handling', () => {
    it('should handle missing OpenAI key', async () => {
      // Mock the invoke to throw an error
      const mockInvoke = (agentService as any).mockInvoke;
      mockInvoke.mockRejectedValueOnce(new Error('OpenAI API key not configured'));
      
      const result = await agentService.processComplexIntent(
        { intentText: 'test', context: 'welcome' },
        1
      );
      
      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result && result.type === 'error') {
        expect(result.message).toBe('An error occurred while processing your request.');
      }
    });
    
    it('should handle OpenAI API errors', async () => {
      // Mock the invoke to throw an API error
      const mockInvoke = (agentService as any).mockInvoke;
      mockInvoke.mockRejectedValueOnce(new Error('Invalid API key'));
      
      const result = await agentService.processComplexIntent(
        { intentText: 'test', context: 'welcome' },
        1
      );
      
      expect(result).toBeDefined();
      expect(result!.type).toBe('error');
      if (result && result.type === 'error') {
        expect(result.message).toBe('An error occurred while processing your request.');
      }
    });
  });

  describe('detectNewsSources', () => {
    it('should detect single news source', () => {
      const service = new AgentService(mockNotebookService, mockLLMService, mockHybridSearchService, mockExaService, mockChatModel, mockSliceService);
      const { sources, cleanedQuery } = service.detectNewsSources('headlines from FT today');
      
      expect(sources).toEqual(['ft.com']);
      expect(cleanedQuery).toBe('headlines today');
    });
    
    it('should detect multiple news sources', () => {
      const service = new AgentService(mockNotebookService, mockLLMService, mockHybridSearchService, mockExaService, mockChatModel, mockSliceService);
      const { sources, cleanedQuery } = service.detectNewsSources(
        'what are the headlines in the FT, WSJ, and NYT today?'
      );
      
      expect(sources).toContain('ft.com');
      expect(sources).toContain('wsj.com');
      expect(sources).toContain('nytimes.com');
      expect(sources).toHaveLength(3);
      expect(cleanedQuery).toBe('what are headlines today?');
    });
    
    it('should handle various aliases', () => {
      const service = new AgentService(mockNotebookService, mockLLMService, mockHybridSearchService, mockExaService, mockChatModel, mockSliceService);
      
      // Test different aliases
      const testCases = [
        { input: 'financial times news', expected: 'ft.com' },
        { input: 'wall street journal headlines', expected: 'wsj.com' },
        { input: 'ny times stories', expected: 'nytimes.com' },
        { input: 'the guardian articles', expected: 'theguardian.com' },
        { input: 'BBC news', expected: 'bbc.com' },
      ];
      
      testCases.forEach(({ input, expected }) => {
        const { sources } = service.detectNewsSources(input);
        expect(sources).toContain(expected);
      });
    });
    
    it('should return empty sources for non-news queries', () => {
      const service = new AgentService(mockNotebookService, mockLLMService, mockHybridSearchService, mockExaService, mockChatModel, mockSliceService);
      const { sources, cleanedQuery } = service.detectNewsSources('search for quantum computing');
      
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
      
      // Mock searchNews to return results
      (mockHybridSearchService.searchNews as Mock).mockResolvedValue(mockNewsResults);
      
      // Get the mock invoke function
      const mockInvoke = (agentService as any).mockInvoke;
      
      // Mock Exa service search calls for multi-source
      (mockExaService.search as Mock)
        .mockResolvedValueOnce({ results: [mockNewsResults[0]] }) // FT
        .mockResolvedValueOnce({ results: [mockNewsResults[1]] }) // WSJ
        .mockResolvedValueOnce({ results: [mockNewsResults[2]] }); // NYT
      
      // Mock first call - returns tool calls
      mockInvoke.mockResolvedValueOnce({
        content: null,
        additional_kwargs: {
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
        }
      });
      
      // Mock second call - returns summary
      mockInvoke.mockResolvedValueOnce({
        content: 'Here are today\'s headlines from FT, WSJ, and NYT...',
        additional_kwargs: {}
      });
      
      const result = await agentService.processComplexIntent(
        { intentText: 'what are the headlines in the FT, WSJ, and NYT today?', context: 'welcome' },
        123
      );
      
      // Verify that ExaService.search was called multiple times for multi-source
      expect(mockExaService.search).toHaveBeenCalled();
      
      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
    });
    
    it('should handle partial failures in multi-source search', async () => {
      // Get the mock invoke function
      const mockInvoke = (agentService as any).mockInvoke;
      
      // Mock Exa service with partial failures
      (mockExaService.search as Mock)
        .mockResolvedValueOnce({ results: [{ 
          id: 'ft-1',
          title: 'FT Success',
          url: 'https://ft.com/article1',
          text: 'Financial Times content',
          score: 0.95
        }] }) // FT success
        .mockRejectedValueOnce(new Error('WSJ search failed')) // WSJ fails
        .mockResolvedValueOnce({ results: [{
          id: 'nyt-1',
          title: 'NYT Success',
          url: 'https://nytimes.com/article1',
          text: 'New York Times content',
          score: 0.93
        }] }); // NYT success
      
      // Mock first call - returns tool calls
      mockInvoke.mockResolvedValueOnce({
        content: null,
        additional_kwargs: {
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
        }
      });
      
      // Mock second call - returns summary
      mockInvoke.mockResolvedValueOnce({
        content: 'I found headlines from FT and NYT. WSJ search failed.',
        additional_kwargs: {}
      });
      
      const result = await agentService.processComplexIntent(
        { intentText: 'headlines from FT, WSJ, and NYT', context: 'welcome' },
        124
      );
      
      // Verify search was attempted
      expect(mockExaService.search).toHaveBeenCalled();
      
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
      // Get the mock invoke function
      const mockInvoke = (agentService as any).mockInvoke;
      
      // Mock ExaService search results
      (mockExaService.search as Mock)
        .mockResolvedValueOnce({ results: [{ title: 'FT News', url: 'https://ft.com/1', text: 'FT content' }] })
        .mockResolvedValueOnce({ results: [{ title: 'WSJ News', url: 'https://wsj.com/1', text: 'WSJ content' }] })
        .mockResolvedValueOnce({ results: [{ title: 'NYT News', url: 'https://nytimes.com/1', text: 'NYT content' }] });
      
      // Mock response with multiple tool calls
      mockInvoke.mockResolvedValueOnce({
        content: null,
        additional_kwargs: {
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
        }
      });
      
      // Mock summary response
      mockInvoke.mockResolvedValueOnce({
        content: 'Here are the headlines from FT, WSJ, and NYT...',
        additional_kwargs: {}
      });
      
      const result = await agentService.processComplexIntent(
        { intentText: 'headlines from FT, WSJ, and NYT', context: 'welcome' },
        300
      );
      
      // This test would fail with current implementation because it only processes the first tool call
      expect(mockExaService.search).toHaveBeenCalledTimes(3);
      expect(mockExaService.search).toHaveBeenCalledWith(expect.stringContaining('ft.com'), expect.any(Object));
      expect(mockExaService.search).toHaveBeenCalledWith(expect.stringContaining('wsj.com'), expect.any(Object));
      expect(mockExaService.search).toHaveBeenCalledWith(expect.stringContaining('nytimes.com'), expect.any(Object));
    });

    it('should persist tool responses correctly through follow-up questions', async () => {
      // Get the mock invoke function
      const mockInvoke = (agentService as any).mockInvoke;
      
      // Mock search results
      (mockHybridSearchService.search as Mock).mockResolvedValueOnce([
        { id: '1', title: 'Test Result', content: 'Test content', url: 'https://example.com' }
      ]);
      
      // First request with tool call
      mockInvoke.mockResolvedValueOnce({
        content: null,
        additional_kwargs: {
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({ query: 'test search' })
            }
          }]
        }
      });
      
      // Follow-up response after tool execution
      mockInvoke.mockResolvedValueOnce({
        content: 'Here are the search results...',
        additional_kwargs: {}
      });
      
      // First query
      await agentService.processComplexIntent(
        { intentText: 'search for something', context: 'welcome' },
        400
      );
      
      // Get conversation history before second query - use string key
      const historyBeforeSecond = (agentService as any).conversationHistory.get('400');
      
      // Verify conversation history exists
      expect(historyBeforeSecond).toBeDefined();
      
      // Verify tool response is in history
      if (historyBeforeSecond) {
        const toolMessages = historyBeforeSecond.filter((m: any) => m.role === 'tool');
        expect(toolMessages).toHaveLength(1);
        expect(toolMessages[0].tool_call_id).toBe('call_123');
      }
      
      // Second query - should work without tool_call_id errors
      mockInvoke.mockResolvedValueOnce({
        content: 'Let me help with that follow-up...',
        additional_kwargs: {}
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
      // This test verifies that our code can handle the mismatch between
      // system prompt instructions (multiple tool calls) and our implementation
      // (expecting all sources in one query)
      const mockInvoke = (agentService as any).mockInvoke;
      
      // Mock Exa search for NYT
      (mockExaService.search as Mock).mockResolvedValueOnce({
        results: [{
          id: '1',
          title: 'NYT Headlines',
          url: 'https://nytimes.com/1',
          text: 'NYT content',
          score: 0.95
        }]
      });
      
      // Mock OpenAI following system prompt literally (one source per call)
      mockInvoke.mockResolvedValueOnce({
        content: null,
        additional_kwargs: {
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
        }
      });
      
      // Mock summary response
      mockInvoke.mockResolvedValueOnce({
        content: 'Here are the NYT headlines...',
        additional_kwargs: {}
      });
      
      const result = await agentService.processComplexIntent(
        { intentText: 'headlines from NYT, FT, and WSJ', context: 'welcome' },
        500
      );
      
      // The implementation should handle this gracefully
      // Since it detects NYT in the query, it will use Exa search directly
      expect(mockExaService.search).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result!.type).toBe('chat_reply');
    });
  });

  describe('Message Validation', () => {
    it('should detect and fix orphaned tool calls when loading from database', async () => {
      const mockMessages = [
        {
          messageId: '1',
          sessionId: 'test-session',
          role: 'user',
          content: 'Tell me about Psalm 139',
          metadata: null,
          createdAt: new Date()
        },
        {
          messageId: '2',
          sessionId: 'test-session',
          role: 'assistant',
          content: 'Let me search for that.',
          metadata: JSON.stringify({
            toolCalls: [
              { id: 'call_123', type: 'function', function: { name: 'search_web', arguments: '{"query":"Psalm 139"}' } },
              { id: 'call_456', type: 'function', function: { name: 'search_web', arguments: '{"query":"Psalm 139 KJV"}' } }
            ]
          }),
          createdAt: new Date()
        },
        // Only one tool response - missing response for call_456
        {
          messageId: '3',
          sessionId: 'test-session',
          role: 'tool',
          content: 'Search results for Psalm 139...',
          metadata: JSON.stringify({ toolCallId: 'call_123', toolName: 'search_web' }),
          createdAt: new Date()
        }
      ];

      (mockChatModel.getMessagesBySessionId as Mock).mockResolvedValue(mockMessages);

      // Access private method through type assertion
      const loadedMessages = await (agentService as any).loadMessagesFromDatabase('test-session');
      
      // Should have sanitized the messages
      expect(loadedMessages).toHaveLength(3);
      
      // The assistant message should have only the tool call with a response
      const assistantMsg = loadedMessages.find((m: any) => m.role === 'assistant');
      expect(assistantMsg.tool_calls).toHaveLength(1);
      expect(assistantMsg.tool_calls[0].id).toBe('call_123');
    });
  });
});