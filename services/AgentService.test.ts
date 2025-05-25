import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { AgentService } from './AgentService';
import { NotebookService } from './NotebookService';
import { ExaSearchTool } from './agents/tools/ExaSearchTool';
import { IntentPayload } from '../shared/types';
import { HybridSearchResult } from './HybridSearchService';

// Mock dependencies
vi.mock('./NotebookService');
vi.mock('./agents/tools/ExaSearchTool');
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
  let mockExaSearchTool: ExaSearchTool;
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
    agentService = new AgentService(mockNotebookService);
    
    // Get reference to the mocked ExaSearchTool
    mockExaSearchTool = (agentService as any).exaSearchTool;
  });
  
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });
  
  describe('constructor', () => {
    it('should initialize with dependencies', () => {
      expect(agentService).toBeDefined();
      expect((agentService as any).notebookService).toBe(mockNotebookService);
      expect((agentService as any).exaSearchTool).toBeDefined();
    });
    
    it('should handle missing OpenAI key', () => {
      delete process.env.OPENAI_API_KEY;
      const serviceWithoutKey = new AgentService(mockNotebookService);
      expect(serviceWithoutKey).toBeDefined();
    });
  });
  
  describe('processComplexIntent - search_web', () => {
    it('should use ExaSearchTool for web search', async () => {
      const mockSearchResults = `Found 2 search results:

[1] Test Article
Source: Web | Score: 0.950 | Published: 2024-01-15
URL: https://example.com/article
This is a test article about the topic...

---

[2] Local Note
Source: Local Knowledge | Score: 0.850
Content from your personal notes...`;
      
      // Mock ExaSearchTool._call
      (mockExaSearchTool._call as Mock).mockResolvedValue(mockSearchResults);
      
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
      
      const payload: IntentPayload = {
        intentText: 'search for information about quantum computing',
      };
      
      const result = await agentService.processComplexIntent(payload, 1);
      
      // Verify ExaSearchTool was called
      expect(mockExaSearchTool._call).toHaveBeenCalledWith({
        query: 'test search query',
        searchType: 'general',
        useHybrid: true,
        numResults: 5,
        type: 'neural',
      });
      
      // Verify result
      expect(result.type).toBe('chat_reply');
      if (result.type === 'chat_reply') {
        expect(result.message).toContain('test search query');
      }
    });
    
    it('should handle search errors gracefully', async () => {
      // Mock ExaSearchTool to throw error
      (mockExaSearchTool._call as Mock).mockRejectedValue(new Error('Search service unavailable'));
      
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
      
      const payload: IntentPayload = {
        intentText: 'search for something that will fail',
      };
      
      const result = await agentService.processComplexIntent(payload, 2);
      
      expect(result.type).toBe('chat_reply');
      if (result.type === 'chat_reply') {
        expect(result.message).toContain('temporarily unavailable');
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
      
      const payload: IntentPayload = {
        intentText: 'search with invalid query',
      };
      
      const result = await agentService.processComplexIntent(payload, 3);
      
      expect(mockExaSearchTool._call).not.toHaveBeenCalled();
      expect(result.type).toBe('chat_reply');
      if (result.type === 'chat_reply') {
        expect(result.message).toContain('clear search query');
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
        expect(result.message).toContain('Invalid API key');
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
      const { exaService: mockExaService } = await import('./ExaService');
      
      // Mock search results for each source
      const ftResults = {
        results: [{
          id: 'ft-1',
          title: 'FT Headline',
          url: 'https://ft.com/article1',
          text: 'Financial Times article content',
          score: 0.95,
        }],
      };
      
      const wsjResults = {
        results: [{
          id: 'wsj-1',
          title: 'WSJ Headline',
          url: 'https://wsj.com/article1',
          text: 'Wall Street Journal article content',
          score: 0.93,
        }],
      };
      
      const nytResults = {
        results: [{
          id: 'nyt-1',
          title: 'NYT Headline',
          url: 'https://nytimes.com/article1',
          text: 'New York Times article content',
          score: 0.91,
        }],
      };
      
      // Set up mock to return different results based on query
      (mockExaService.search as Mock).mockImplementation(async (query: string) => {
        if (query.includes('ft.com')) return ftResults;
        if (query.includes('wsj.com')) return wsjResults;
        if (query.includes('nytimes.com')) return nytResults;
        return { results: [] };
      });
      
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
      
      // Verify all three sources were searched
      expect(mockExaService.search).toHaveBeenCalledTimes(3);
      expect(mockExaService.search).toHaveBeenCalledWith(
        expect.stringContaining('ft.com'),
        expect.any(Object)
      );
      expect(mockExaService.search).toHaveBeenCalledWith(
        expect.stringContaining('wsj.com'),
        expect.any(Object)
      );
      expect(mockExaService.search).toHaveBeenCalledWith(
        expect.stringContaining('nytimes.com'),
        expect.any(Object)
      );
      
      expect(result.type).toBe('chat_reply');
    });
    
    it('should handle partial failures in multi-source search', async () => {
      const { exaService: mockExaService } = await import('./ExaService');
      
      // Mock one source to fail
      (mockExaService.search as Mock).mockImplementation(async (query: string) => {
        if (query.includes('ft.com')) {
          return {
            results: [{
              id: 'ft-1',
              title: 'FT Success',
              url: 'https://ft.com/article1',
              score: 0.95,
            }],
          };
        }
        if (query.includes('wsj.com')) {
          throw new Error('WSJ search failed - rate limited');
        }
        if (query.includes('nytimes.com')) {
          return {
            results: [{
              id: 'nyt-1',
              title: 'NYT Success',
              url: 'https://nytimes.com/article1',
              score: 0.91,
            }],
          };
        }
        return { results: [] };
      });
      
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
      
      // Verify all sources were attempted
      expect(mockExaService.search).toHaveBeenCalledTimes(3);
      
      // Should still return results from successful sources
      expect(result.type).toBe('chat_reply');
    });
  });

  describe('conversation history filtering', () => {
    it('should filter orphaned tool messages', () => {
      const service = new AgentService(mockNotebookService);
      
      const messages = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'search for something' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'search_web', arguments: '{}' },
          }],
        },
        { role: 'tool', content: 'search results', tool_call_id: 'call-1' },
        { role: 'assistant', content: 'Here are the results' },
        // This tool message is orphaned - no matching tool_call
        { role: 'tool', content: 'orphaned results', tool_call_id: 'call-2' },
        { role: 'user', content: 'next question' },
      ];
      
      const filtered = (service as any).filterMessagesForValidToolContext(messages);
      
      // Should remove the orphaned tool message
      expect(filtered).toHaveLength(messages.length - 1);
      expect(filtered.find((m: any) => m.tool_call_id === 'call-2')).toBeUndefined();
    });
    
    it('should filter tool messages that dont immediately follow their assistant message', () => {
      const service = new AgentService(mockNotebookService);
      
      const messages: any[] = [
        { role: 'user', content: 'search for news' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'search_web', arguments: '{}' },
            },
            {
              id: 'call-2',
              type: 'function',
              function: { name: 'search_web', arguments: '{}' },
            },
          ],
        },
        { role: 'tool', content: 'results 1', tool_call_id: 'call-1' },
        { role: 'tool', content: 'results 2', tool_call_id: 'call-2' }, // This will be filtered
        { role: 'assistant', content: 'Summary of results' },
      ];
      
      const filtered = (service as any).filterMessagesForValidToolContext(messages);
      
      // The second tool message should be filtered out because it doesn't
      // immediately follow an assistant message with matching tool_calls
      expect(filtered).toHaveLength(4); // One tool message removed
      expect(filtered[0].role).toBe('user');
      expect(filtered[1].role).toBe('assistant');
      expect(filtered[2].role).toBe('tool');
      expect(filtered[2].tool_call_id).toBe('call-1');
      expect(filtered[3].role).toBe('assistant');
      
      // Verify the second tool message was filtered out
      expect(filtered.find((m: any) => m.tool_call_id === 'call-2')).toBeUndefined();
    });
  });

  describe('formatting functions', () => {
    const mockResults: HybridSearchResult[] = [
      {
        id: '1',
        title: 'Test Article',
        url: 'https://example.com/article',
        content: 'This is a long article content that should be truncated when displayed as a snippet...',
        score: 0.95,
        source: 'exa',
        publishedDate: '2024-01-15T10:00:00Z',
        author: 'John Doe',
        highlights: ['Key point 1', 'Key point 2', 'Key point 3'],
      },
      {
        id: '2',
        title: 'Another Article',
        url: 'https://example.com/another',
        content: 'Another article content',
        score: 0.85,
        source: 'local',
      },
    ];
    
    it('should format single result with all options', () => {
      const service = new AgentService(mockNotebookService);
      
      const formatted = (service as any).formatSingleResult(mockResults[0], {
        showIndex: true,
        index: 0,
        showAuthor: true,
        showHighlights: true,
        maxHighlights: 2,
        dateFormat: 'separate',
      });
      
      expect(formatted).toContain('[1] Test Article');
      expect(formatted).toContain('Published: 1/15/2024');
      expect(formatted).toContain('By: John Doe');
      expect(formatted).toContain('Key point 1');
      expect(formatted).toContain('Key point 2');
      expect(formatted).not.toContain('Key point 3'); // maxHighlights = 2
      expect(formatted).toContain('[Read more]');
    });
    
    it('should format date inline when specified', () => {
      const service = new AgentService(mockNotebookService);
      
      const dateFormatted = (service as any).formatResultDate('2024-01-15T10:00:00Z', 'inline');
      expect(dateFormatted).toBe(' | 1/15/2024');
      
      const dateSeparate = (service as any).formatResultDate('2024-01-15T10:00:00Z', 'separate');
      expect(dateSeparate).toBe('Published: 1/15/2024');
    });
    
    it('should format content snippet with truncation', () => {
      const service = new AgentService(mockNotebookService);
      
      const snippet = (service as any).formatResultContentSnippet(mockResults[0].content, 50);
      expect(snippet).toBe('This is a long article content that should be trun...');
      expect(snippet.length).toBeLessThanOrEqual(53); // 50 + '...'
    });
    
    it('should group results by custom field', () => {
      const service = new AgentService(mockNotebookService);
      
      const grouped = (service as any).groupResultsByField(
        mockResults,
        (result: HybridSearchResult) => result.source
      );
      
      expect(grouped).toHaveProperty('exa');
      expect(grouped).toHaveProperty('local');
      expect(grouped.exa).toHaveLength(1);
      expect(grouped.local).toHaveLength(1);
    });
    
    it('should format news results consistently', () => {
      const service = new AgentService(mockNotebookService);
      
      const formatted = (service as any).formatNewsResults(mockResults);
      
      expect(formatted).toContain('# News Search Results');
      expect(formatted).toContain('Test Article');
      expect(formatted).toContain('John Doe');
      expect(formatted).toContain('Key points:');
      expect(formatted).toContain('Another Article');
    });
    
    it('should format multi-source results with grouping', () => {
      const service = new AgentService(mockNotebookService);
      
      const multiSourceResults: HybridSearchResult[] = [
        { ...mockResults[0], url: 'https://ft.com/article1' },
        { ...mockResults[1], url: 'https://wsj.com/article2' },
      ];
      
      const formatted = (service as any).formatMultiSourceResults(
        multiSourceResults,
        ['ft.com', 'wsj.com']
      );
      
      expect(formatted).toContain('# Headlines from ft.com, wsj.com');
      expect(formatted).toContain('## Financial Times');
      expect(formatted).toContain('## Wall Street Journal');
    });
  });

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
      
      mockExaService.search.mockResolvedValueOnce({ results: [] });
      
      // First query
      await agentService.processComplexIntent({
        intentText: 'search for something',
        senderId: 400
      });
      
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
        intentText: 'tell me more',
        senderId: 400
      });
      
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
      
      mockExaService.search.mockResolvedValueOnce({ results: [] });
      
      const result = await agentService.processComplexIntent({
        intentText: 'headlines from NYT, FT, and WSJ',
        senderId: 500
      });
      
      // Current implementation would only search NYT, missing FT and WSJ
      expect(mockExaService.search).toHaveBeenCalledTimes(1);
      expect(mockExaService.search).toHaveBeenCalledWith(
        expect.stringContaining('nytimes.com'),
        expect.any(Object)
      );
      // This demonstrates the bug - we asked for 3 sources but only got 1
    });
  });
});