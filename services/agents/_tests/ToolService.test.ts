import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ToolService } from '../ToolService';
import { ConversationService } from '../ConversationService';
import { SearchService } from '../SearchService';
import { NotebookService } from '../../NotebookService';
import { ProfileService } from '../../ProfileService';
import { HybridSearchService } from '../../HybridSearchService';
import { ExaService } from '../../ExaService';
import { SliceService } from '../../SliceService';
import { SearchResultFormatter } from '../../SearchResultFormatter';
import { runMigrations } from '../../../models/runMigrations';
import type { OpenAIMessage } from '../../../shared/types/agent.types';

// Mock the logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock performance tracker

// Helper function to create tool calls
function createToolCall(name: string, args: any) {
  return {
    id: `call-${Math.random()}`,
    type: 'function' as const,
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

describe('ToolService', () => {
  let db: Database.Database;
  let toolService: ToolService;
  let mockServices: any;

  beforeEach(async () => {
    db = new Database(':memory:');
    await runMigrations(db);

    // Create minimal mock services
    mockServices = {
      conversationService: {
        saveMessagesInTransaction: vi.fn(),
        updateConversationHistory: vi.fn(),
      },
      searchService: {
        getCurrentSearchResults: vi.fn().mockReturnValue([]),
        getCurrentSearchQuery: vi.fn().mockReturnValue(''),
        accumulateSearchResults: vi.fn(),
      },
      notebookService: {
        createNotebook: vi.fn().mockResolvedValue({ id: 'nb-1', title: 'New' }),
        getAllRegularNotebooks: vi.fn().mockResolvedValue([]),
      },
      profileService: {
        getProfile: vi.fn().mockResolvedValue({ goals: [] }),
      },
      hybridSearchService: {
        search: vi.fn().mockResolvedValue([{
          title: 'Result',
          url: 'https://example.com',
          content: 'Content',
          score: 0.8,
        }]),
      },
      exaService: {
        search: vi.fn().mockResolvedValue({ results: [] }),
      },
      sliceService: {},
      searchResultFormatter: {
        formatSearchResults: vi.fn().mockReturnValue('Formatted results'),
      },
    };

    toolService = new ToolService({
      db,
      ...mockServices,
    });
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe('processToolCall', () => {
    it('executes known tools successfully', async () => {
      const toolCall = createToolCall('search_knowledge_base', { query: 'test' });
      
      const result = await toolService.processToolCall(toolCall);
      
      expect(result.content).toContain('Found 1 results');
      expect(mockServices.hybridSearchService.search).toHaveBeenCalled();
    });

    it('handles unknown tools', async () => {
      const toolCall = createToolCall('unknown_tool', {});
      
      const result = await toolService.processToolCall(toolCall);
      
      expect(result.content).toBe('Unknown tool: unknown_tool');
    });

    it('handles tool errors gracefully', async () => {
      mockServices.hybridSearchService.search.mockRejectedValueOnce(new Error('Boom'));
      const toolCall = createToolCall('search_knowledge_base', { query: 'test' });
      
      const result = await toolService.processToolCall(toolCall);
      
      expect(result.content).toContain('Boom');
    });

    it('handles malformed tool calls', async () => {
      const toolCall = { id: 'bad', function: { name: 'test', arguments: 'bad json' } };
      
      const result = await toolService.processToolCall(toolCall);
      
      expect(result.content).toContain('Error');
    });
  });

  describe('handleToolCallsWithAtomicSave', () => {
    it('processes multiple tools and saves atomically', async () => {
      const assistantMessage: OpenAIMessage = {
        role: 'assistant',
        content: 'Processing...',
        tool_calls: [
          createToolCall('search_knowledge_base', { query: 'test' }),
          createToolCall('create_notebook', { title: 'New' }),
        ],
      };

      const result = await toolService.handleToolCallsWithAtomicSave(
        assistantMessage,
        [],
        'user-123',
        'session-123'
      );

      expect(result.toolResults).toHaveLength(2);
      expect(result.hasSearchResults).toBe(true);
      expect(mockServices.conversationService.saveMessagesInTransaction).toHaveBeenCalled();
      expect(mockServices.searchService.accumulateSearchResults).toHaveBeenCalled();
    });

    it('handles empty tool calls', async () => {
      const assistantMessage: OpenAIMessage = {
        role: 'assistant',
        content: 'No tools',
        tool_calls: [],
      };

      const result = await toolService.handleToolCallsWithAtomicSave(
        assistantMessage,
        [],
        'user-123',
        'session-123'
      );

      expect(result.toolResults).toHaveLength(0);
      expect(result.hasSearchResults).toBe(false);
    });
  });

  describe('handleToolCallsForStreaming', () => {
    it('processes tools without blocking on save failures', async () => {
      const toolCalls = [createToolCall('search_knowledge_base', { query: 'test' })];

      const results = await toolService.handleToolCallsForStreaming(
        toolCalls,
        [],
        'user-123',
        'session-123'
      );

      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('Found 1 results');
    });
  });

  describe('getToolDefinitions', () => {
    it('returns tool definitions', () => {
      const definitions = toolService.getToolDefinitions();
      
      expect(definitions.length).toBeGreaterThan(0);
      expect(definitions[0]).toHaveProperty('type', 'function');
      expect(definitions[0].function).toHaveProperty('name');
      expect(definitions[0].function).toHaveProperty('parameters');
    });
  });
});