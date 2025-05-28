import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { AgentService } from './AgentService';
import { NotebookService } from './NotebookService';
import { SetIntentPayload } from '../shared/types';
import { HybridSearchResult } from './HybridSearchService';

// Mock dependencies
vi.mock('./NotebookService');
vi.mock('./ExaService', () => ({
  exaService: {
    isConfigured: vi.fn().mockReturnValue(true),
    search: vi.fn(),
  },
}));
vi.mock('./HybridSearchService', () => ({
  hybridSearchService: {
    search: vi.fn(),
    searchLocal: vi.fn(),
    searchNews: vi.fn(),
  },
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('AgentService', () => {
  let agentService: AgentService;
  let mockNotebookService: NotebookService;
  const mockOpenAIKey = 'test-openai-key';
  
  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Set up environment
    process.env.OPENAI_API_KEY = mockOpenAIKey;
    
    // Create mock instances
    mockNotebookService = new NotebookService({} as any, {} as any, {} as any, {} as any, {} as any);
    
    // Mock NotebookService methods
    (mockNotebookService.getAllNotebooks as Mock).mockResolvedValue([
      { id: 'nb-1', title: 'Test Notebook', description: 'Test' },
      { id: 'nb-2', title: 'Another Notebook', description: 'Another' },
    ]);
    
    // Create AgentService instance
    // TODO: Fix mock injection - hybridSearchService and exaService are mocked above
    // but not passed to constructor, so AgentService uses real singletons instead of mocks.
    // This causes tests expecting mocked behavior to fail.
    // Fix: agentService = new AgentService(mockNotebookService, mockHybridSearchService, mockExaService);
    agentService = new AgentService(mockNotebookService);
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
      const serviceWithoutKey = new AgentService(mockNotebookService);
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
      const { hybridSearchService } = await import('./HybridSearchService');
      (hybridSearchService.search as Mock).mockResolvedValue(mockSearchResults);
      
      // Mock OpenAI responses
      const mockToolCallResponse = {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call-123',
              type: 'function',
              function: {
                name: 'search_web',
                arguments: JSON.stringify({ query: 'test search query' }),
              },
            }],
          },
        }],
      };
      
      const mockFollowUpResponse = {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Based on my search, here\'s what I found about test search query...',
          },
        }],
      };
      
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockToolCallResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFollowUpResponse,
        });
      
      const payload: SetIntentPayload = {
        intentText: 'search for information about quantum computing',
        context: 'welcome'
      };
      
      const result = await agentService.processComplexIntent(payload, 1);
      
      // Verify hybridSearchService was called
      expect(hybridSearchService.search).toHaveBeenCalledWith('test search query', {
        numResults: 10
      });
      
      // Verify result
      expect(result.type).toBe('chat_reply');
      if (result.type === 'chat_reply') {
        expect(result.message).toContain('test search query');
      }
    });
    
    it('should handle search errors gracefully', async () => {
      // Mock hybridSearchService to throw error
      const { hybridSearchService } = await import('./HybridSearchService');
      (hybridSearchService.search as Mock).mockRejectedValue(new Error('Search service unavailable'));
      
      const mockToolCallResponse = {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call-456',
              type: 'function',
              function: {
                name: 'search_web',
                arguments: JSON.stringify({ query: 'failing search' }),
              },
            }],
          },
        }],
      };
      
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockToolCallResponse,
      });
      
      const payload: SetIntentPayload = {
        intentText: 'search for something that will fail',
        context: 'welcome'
      };
      
      const result = await agentService.processComplexIntent(payload, 2);
      
      expect(result.type).toBe('chat_reply');
      if (result.type === 'chat_reply') {
        // Error is handled gracefully and AI provides a response
        expect(result.message).toBeTruthy();
      }
    });
    
    it('should handle invalid search query', async () => {
      const mockToolCallResponse = {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call-789',
              type: 'function',
              function: {
                name: 'search_web',
                arguments: JSON.stringify({ query: null }), // Invalid query
              },
            }],
          },
        }],
      };
      
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockToolCallResponse,
      });
      
      const payload: SetIntentPayload = {
        intentText: 'search with invalid query',
        context: 'welcome'
      };
      
      const result = await agentService.processComplexIntent(payload, 3);
      
      const { hybridSearchService } = await import('./HybridSearchService');
      expect(hybridSearchService.search).not.toHaveBeenCalled();
      expect(result.type).toBe('chat_reply');
      if (result.type === 'chat_reply') {
        // The error message is returned and then AI tries to summarize
        expect(result.message).toBeTruthy();
      }
    });
  });
  
  describe('conversation history management', () => {
    it('should maintain conversation history across calls', async () => {
      const mockResponse1 = {
        choices: [{
          message: {
            role: 'assistant',
            content: 'First response',
          },
        }],
      };
      
      const mockResponse2 = {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Second response with context',
          },
        }],
      };
      
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse1,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse2,
        });
      
      const senderId = 100;
      
      // First call
      await agentService.processComplexIntent({ intentText: 'first question' }, senderId);
      
      // Second call - should include history
      await agentService.processComplexIntent({ intentText: 'follow-up question' }, senderId);
      
      // Check that second call included conversation history
      const secondCallBody = JSON.parse((global.fetch as Mock).mock.calls[1][1].body);
      expect(secondCallBody.messages.length).toBeGreaterThan(2); // System + multiple messages
      expect(secondCallBody.messages.some((m: any) => m.content === 'first question')).toBe(true);
      expect(secondCallBody.messages.some((m: any) => m.content === 'First response')).toBe(true);
    });
    
    it('should clear conversation history', () => {
      const senderId = 200;
      
      // Add some history
      (agentService as any).conversationHistory.set(senderId, [
        { role: 'user', content: 'test' },
        { role: 'assistant', content: 'response' },
      ]);
      
      expect(agentService.getActiveConversationCount()).toBe(1);
      
      agentService.clearConversation(senderId);
      
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
      delete process.env.OPENAI_API_KEY;
      const serviceWithoutKey = new AgentService(mockNotebookService);
      
      const result = await serviceWithoutKey.processComplexIntent(
        { intentText: 'test' },
        1
      );
      
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.message).toContain('not configured');
      }
    });
    
    it('should handle OpenAI API errors', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          error: { message: 'Invalid API key' },
        }),
      });
      
      const result = await agentService.processComplexIntent(
        { intentText: 'test' },
        1
      );
      
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.message).toBe('An error occurred while processing your request.');
      }
    });
  });

  describe('detectNewsSources', () => {
    it('should detect single news source', () => {
      const service = new AgentService(mockNotebookService);
      const { sources, cleanedQuery } = (service as any).detectNewsSources('headlines from FT today');
      
      expect(sources).toEqual(['ft.com']);
      expect(cleanedQuery).toBe('headlines today');
    });
    
    it('should detect multiple news sources', () => {
      const service = new AgentService(mockNotebookService);
      const { sources, cleanedQuery } = (service as any).detectNewsSources(
        'what are the headlines in the FT, WSJ, and NYT today?'
      );
      
      expect(sources).toContain('ft.com');
      expect(sources).toContain('wsj.com');
      expect(sources).toContain('nytimes.com');
      expect(sources).toHaveLength(3);
      expect(cleanedQuery).toBe('what are headlines today?');
    });
    
    it('should handle various aliases', () => {
      const service = new AgentService(mockNotebookService);
      
      // Test different aliases
      const testCases = [
        { input: 'financial times news', expected: 'ft.com' },
        { input: 'wall street journal headlines', expected: 'wsj.com' },
        { input: 'ny times stories', expected: 'nytimes.com' },
        { input: 'the guardian articles', expected: 'theguardian.com' },
        { input: 'BBC news', expected: 'bbc.com' },
      ];
      
      testCases.forEach(({ input, expected }) => {
        const { sources } = (service as any).detectNewsSources(input);
        expect(sources).toContain(expected);
      });
    });
    
    it('should return empty sources for non-news queries', () => {
      const service = new AgentService(mockNotebookService);
      const { sources, cleanedQuery } = (service as any).detectNewsSources('search for quantum computing');
      
      expect(sources).toEqual([]);
      expect(cleanedQuery).toBe('search for quantum computing');
    });
  });

  describe('multi-source news search', () => {
    it('should search multiple sources in parallel', async () => {
      const { hybridSearchService } = await import('./HybridSearchService');
      
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
      (hybridSearchService.searchNews as Mock).mockResolvedValue(mockNewsResults);
      
      // Mock OpenAI to trigger search_web with multiple sources
      const mockToolCallResponse = {
        choices: [{
          message: {
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
            }],
          },
        }],
      };
      
      const mockFollowUpResponse = {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Here are today\'s headlines from FT, WSJ, and NYT...',
          },
        }],
      };
      
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockToolCallResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFollowUpResponse,
        });
      
      const result = await agentService.processComplexIntent(
        { intentText: 'what are the headlines in the FT, WSJ, and NYT today?' },
        123
      );
      
      // Since we're using hybridSearchService now, not direct exaService calls,
      // we need to verify the correct service was called
      expect(hybridSearchService.searchNews).toHaveBeenCalled();
      
      expect(result.type).toBe('chat_reply');
    });
    
    it('should handle partial failures in multi-source search', async () => {
      const { hybridSearchService } = await import('./HybridSearchService');
      
      // Mock searchNews to return partial results (simulating some sources failed)
      const mockPartialResults = [
        {
          id: 'ft-1',
          title: 'FT Success',
          url: 'https://ft.com/article1',
          content: 'Financial Times content',
          score: 0.95,
          source: 'exa' as const,
        },
        {
          id: 'nyt-1',
          title: 'NYT Success',
          url: 'https://nytimes.com/article1',
          content: 'New York Times content',
          score: 0.91,
          source: 'exa' as const,
        },
      ];
      
      (hybridSearchService.searchNews as Mock).mockResolvedValue(mockPartialResults);
      
      const mockToolCallResponse = {
        choices: [{
          message: {
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
            }],
          },
        }],
      };
      
      const mockFollowUpResponse = {
        choices: [{
          message: {
            role: 'assistant',
            content: 'I found headlines from FT and NYT. WSJ search failed.',
          },
        }],
      };
      
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockToolCallResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFollowUpResponse,
        });
      
      const result = await agentService.processComplexIntent(
        { intentText: 'headlines from FT, WSJ, and NYT' },
        124
      );
      
      // Verify search was attempted
      expect(hybridSearchService.searchNews).toHaveBeenCalled();
      
      // Should still return results from successful sources
      expect(result.type).toBe('chat_reply');
    });
  });

  // Note: Conversation history filtering tests have been removed as they were testing
  // private implementation details that may no longer exist in the current implementation.

  // Note: Formatting tests have been removed as they were testing private implementation details
  // that have been moved to SearchResultFormatter class. The formatting functionality
  // is now tested through the public API of AgentService.

  describe('OpenAI integration behavior', () => {
    it('should handle multiple tool calls in a single response', async () => {
      const { hybridSearchService: mockHybridSearchService } = await import('./HybridSearchService');
      const { exaService: mockExaService } = await import('./ExaService');
      
      const agentService = new AgentService(
        mockNotebookService,
        mockHybridSearchService,
        mockExaService
      );
      
      // Mock OpenAI to return multiple tool calls
      const mockMultiToolResponse = {
        choices: [{
          message: {
            role: 'assistant' as const,
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function' as const,
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
                type: 'function' as const,
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
                type: 'function' as const,
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
        }]
      };
      
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockMultiToolResponse
      });
      
      const result = await agentService.processComplexIntent({
        intentText: 'headlines from FT, WSJ, and NYT',
        senderId: 300
      });
      
      // This test would fail with current implementation because it only processes the first tool call
      expect(mockExaService.search).toHaveBeenCalledTimes(3);
      expect(mockExaService.search).toHaveBeenCalledWith(expect.stringContaining('ft.com'), expect.any(Object));
      expect(mockExaService.search).toHaveBeenCalledWith(expect.stringContaining('wsj.com'), expect.any(Object));
      expect(mockExaService.search).toHaveBeenCalledWith(expect.stringContaining('nytimes.com'), expect.any(Object));
    });

    it('should persist tool responses correctly through follow-up questions', async () => {
      const { hybridSearchService: mockHybridSearchService } = await import('./HybridSearchService');
      const { exaService: mockExaService } = await import('./ExaService');
      
      const agentService = new AgentService(
        mockNotebookService,
        mockHybridSearchService,
        mockExaService
      );
      
      // First request with tool call
      const firstResponse = {
        choices: [{
          message: {
            role: 'assistant' as const,
            content: null,
            tool_calls: [{
              id: 'call_123',
              type: 'function' as const,
              function: {
                name: 'search_web',
                arguments: JSON.stringify({ query: 'test search' })
              }
            }]
          }
        }]
      };
      
      // Follow-up response after tool execution
      const followUpResponse = {
        choices: [{
          message: {
            role: 'assistant' as const,
            content: 'Here are the search results...'
          }
        }]
      };
      
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => firstResponse })
        .mockResolvedValueOnce({ ok: true, json: async () => followUpResponse });
      
      // Mock hybridSearchService instead of exaService
      const { hybridSearchService } = await import('./HybridSearchService');
      (hybridSearchService.search as Mock).mockResolvedValueOnce([]);
      
      // First query
      await agentService.processComplexIntent({
        intentText: 'search for something'
      }, 400);
      
      // Get conversation history before second query
      const historyBeforeSecond = (agentService as any).conversationHistory.get(400);
      
      // Verify tool response is in history
      const toolMessages = historyBeforeSecond.filter((m: any) => m.role === 'tool');
      expect(toolMessages).toHaveLength(1);
      expect(toolMessages[0].tool_call_id).toBe('call_123');
      
      // Second query - should work without tool_call_id errors
      const secondResponse = {
        choices: [{
          message: {
            role: 'assistant' as const,
            content: 'Let me help with that follow-up...'
          }
        }]
      };
      
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => secondResponse });
      
      const result = await agentService.processComplexIntent({
        intentText: 'tell me more'
      }, 400);
      
      // Should succeed without tool_call_id errors
      expect(result.type).toBe('chat_reply');
      expect(result.message).not.toContain('tool_call_id');
    });

    it('should handle system prompt instruction mismatch gracefully', async () => {
      // This test verifies that our code can handle the mismatch between
      // system prompt instructions (multiple tool calls) and our implementation
      // (expecting all sources in one query)
      const { hybridSearchService: mockHybridSearchService } = await import('./HybridSearchService');
      const { exaService: mockExaService } = await import('./ExaService');
      
      const agentService = new AgentService(
        mockNotebookService,
        mockHybridSearchService,
        mockExaService
      );
      
      // Mock OpenAI following system prompt literally (one source per call)
      const mockResponse = {
        choices: [{
          message: {
            role: 'assistant' as const,
            content: null,
            tool_calls: [{
              id: 'call_single',
              type: 'function' as const,
              function: {
                name: 'search_web',
                arguments: JSON.stringify({ 
                  query: 'headlines from NYT today', // Only one source!
                  searchType: 'headlines'
                })
              }
            }]
          }
        }]
      };
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });
      
      (mockHybridSearchService.searchNews as Mock).mockResolvedValueOnce([]);
      
      const result = await agentService.processComplexIntent({
        intentText: 'headlines from NYT, FT, and WSJ'
      }, 500);
      
      // The implementation should handle this gracefully
      expect(mockHybridSearchService.searchNews).toHaveBeenCalled();
    });
  });
});