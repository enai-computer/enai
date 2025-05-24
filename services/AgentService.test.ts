import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { AgentService } from './AgentService';
import { NotebookService } from './NotebookService';
import { ExaSearchTool } from './agents/tools/ExaSearchTool';
import { IntentPayload } from '../shared/types';

// Mock dependencies
vi.mock('./NotebookService');
vi.mock('./agents/tools/ExaSearchTool');
vi.mock('./ExaService', () => ({
  exaService: {
    isConfigured: vi.fn().mockReturnValue(true),
  },
}));
vi.mock('./HybridSearchService', () => ({
  hybridSearchService: {
    search: vi.fn(),
    searchLocal: vi.fn(),
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
        expect(result.message).toContain('encountered an error');
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
});