import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { searchKnowledgeBase } from '../searchKnowledgeBase';
import { ToolContext } from '../types';
import { logger } from '../../../../utils/logger';
import { HybridSearchResult } from '../../../../shared/types';

// Mock the logger
vi.mock('../../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('searchKnowledgeBase', () => {
  let mockContext: ToolContext;
  let mockSearch: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockSearch = vi.fn();
    
    mockContext = {
      services: {
        notebookService: {},
        hybridSearchService: {
          search: mockSearch,
        },
        exaService: {},
        sliceService: {},
        profileService: {},
      },
      sessionInfo: {
        senderId: 'test-sender',
        sessionId: 'test-session',
      },
      currentIntentSearchResults: [],
      formatter: {},
    } as unknown as ToolContext;
  });

  describe('tool properties', () => {
    it('should have correct name and description', () => {
      expect(searchKnowledgeBase.name).toBe('search_knowledge_base');
      expect(searchKnowledgeBase.description).toContain('Search the user\'s knowledge base');
      expect(searchKnowledgeBase.description).toContain('saved web content, PDFs, bookmarks');
    });

    it('should have correct parameter schema', () => {
      expect(searchKnowledgeBase.parameters).toEqual({
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant information',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return',
            default: 10,
          },
          autoOpen: {
            type: 'boolean',
            description: 'Whether to automatically open the first result if highly relevant',
            default: false,
          },
        },
        required: ['query'],
      });
    });
  });

  describe('handle method', () => {
    const mockSearchResults: HybridSearchResult[] = [
      {
        id: '1',
        title: 'First Result',
        url: 'https://example.com/1',
        content: 'This is the first result content',
        score: 0.95,
        source: 'local',
        propositions: ['Key idea 1', 'Key idea 2'],
      },
      {
        id: '2',
        title: 'Second Result',
        content: 'This is the second result content',
        score: 0.75,
        source: 'local',
        propositions: ['Key idea 3'],
      },
      {
        id: '3',
        title: 'Third Result',
        url: 'https://example.com/3',
        content: 'This is the third result content',
        score: 0.45,
        source: 'local',
        propositions: ['Key idea 1', 'Key idea 4'],
      },
    ];

    it('should successfully search knowledge base with default parameters', async () => {
      mockSearch.mockResolvedValue(mockSearchResults);

      const result = await searchKnowledgeBase.handle(
        { query: 'test query' },
        mockContext
      );

      expect(mockSearch).toHaveBeenCalledWith('test query', {
        numResults: 10,
        useExa: false,
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[searchKnowledgeBase] Searching knowledge base: "test query" (limit: 10, autoOpen: false)'
      );
      expect(logger.debug).toHaveBeenCalledWith(
        '[searchKnowledgeBase] Knowledge base search returned 3 results'
      );
      
      // Check that results were aggregated
      expect(mockContext.currentIntentSearchResults).toHaveLength(3);
      expect(mockContext.currentIntentSearchResults).toEqual(mockSearchResults);
      
      // Check formatted output
      expect(result.content).toContain('Found 3 results for "test query"');
      expect(result.content).toContain('Key Ideas:');
      expect(result.content).toContain('Sources (by relevance):');
    });

    it('should handle custom limit parameter', async () => {
      mockSearch.mockResolvedValue(mockSearchResults);

      await searchKnowledgeBase.handle(
        { query: 'test query', limit: 5 },
        mockContext
      );

      expect(mockSearch).toHaveBeenCalledWith('test query', {
        numResults: 5,
        useExa: false,
      });
    });

    it('should handle autoOpen parameter when true and first result has URL', async () => {
      mockSearch.mockResolvedValue(mockSearchResults);

      const result = await searchKnowledgeBase.handle(
        { query: 'test query', autoOpen: true },
        mockContext
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[searchKnowledgeBase] Auto-opening first result: https://example.com/1'
      );
      expect(result).toEqual({
        content: 'Found "First Result" in your knowledge base. Opening it now...',
        immediateReturn: {
          type: 'open_url',
          url: 'https://example.com/1',
          message: 'Right on, I found "First Result" in your knowledge base and I\'ll open it for you.',
        },
      });
    });

    it('should not autoOpen when first result has no URL', async () => {
      const resultsWithoutUrl = [
        { ...mockSearchResults[1] }, // Second result has no URL
        ...mockSearchResults.slice(2),
      ];
      mockSearch.mockResolvedValue(resultsWithoutUrl);

      const result = await searchKnowledgeBase.handle(
        { query: 'test query', autoOpen: true },
        mockContext
      );

      expect(result.content).toContain('Found 3 results');
      expect(result.immediateReturn).toBeUndefined();
    });

    it('should handle missing query parameter', async () => {
      const result = await searchKnowledgeBase.handle({}, mockContext);

      expect(result).toEqual({
        content: 'Error: Search query was unclear.',
      });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('should handle null query parameter', async () => {
      const result = await searchKnowledgeBase.handle({ query: null }, mockContext);

      expect(result).toEqual({
        content: 'Error: Search query was unclear.',
      });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('should handle empty query string', async () => {
      const result = await searchKnowledgeBase.handle({ query: '' }, mockContext);

      expect(result).toEqual({
        content: 'Error: Search query was unclear.',
      });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('should handle empty search results', async () => {
      mockSearch.mockResolvedValue([]);

      const result = await searchKnowledgeBase.handle(
        { query: 'no results query' },
        mockContext
      );

      expect(result).toEqual({
        content: 'No results found in your knowledge base for "no results query". Try saving more content or refining your search.',
      });
    });

    it('should handle search errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockSearch.mockRejectedValue(error);

      const result = await searchKnowledgeBase.handle(
        { query: 'error query' },
        mockContext
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[searchKnowledgeBase] Knowledge base search error:',
        error
      );
      expect(result).toEqual({
        content: 'Search failed: Database connection failed',
      });
    });

    it('should handle non-Error objects thrown by search', async () => {
      mockSearch.mockRejectedValue('String error');

      const result = await searchKnowledgeBase.handle(
        { query: 'error query' },
        mockContext
      );

      expect(result).toEqual({
        content: 'Search failed: Unknown error',
      });
    });

    it('should format results with proper relevance categorization', async () => {
      const mixedRelevanceResults: HybridSearchResult[] = [
        { ...mockSearchResults[0], score: 0.85 }, // High relevance
        { ...mockSearchResults[1], score: 0.65 }, // Medium relevance
        { ...mockSearchResults[2], score: 0.35 }, // Low relevance
      ];
      mockSearch.mockResolvedValue(mixedRelevanceResults);

      const result = await searchKnowledgeBase.handle(
        { query: 'test query' },
        mockContext
      );

      expect(result.content).toContain('1 highly relevant (70%+)');
      expect(result.content).toContain('1 moderately relevant (50-70%)');
      expect(result.content).toContain('1 potentially related (<50%)');
    });

    it('should handle results without propositions', async () => {
      const resultsWithoutPropositions: HybridSearchResult[] = [
        {
          id: '1',
          title: 'Result without propositions',
          url: 'https://example.com',
          content: 'Content',
          score: 0.8,
          source: 'local',
        },
      ];
      mockSearch.mockResolvedValue(resultsWithoutPropositions);

      const result = await searchKnowledgeBase.handle(
        { query: 'test query' },
        mockContext
      );

      expect(result.content).toContain('No key ideas extracted');
      expect(result.content).toContain('[80%] Result without propositions');
    });

    it('should deduplicate propositions across results', async () => {
      const resultsWithDuplicatePropositions: HybridSearchResult[] = [
        {
          id: '1',
          title: 'First',
          content: 'Content',
          score: 0.9,
          source: 'local',
          propositions: ['Idea A', 'Idea B'],
        },
        {
          id: '2',
          title: 'Second',
          content: 'Content',
          score: 0.8,
          source: 'local',
          propositions: ['Idea A', 'Idea C'], // Duplicate 'Idea A'
        },
      ];
      mockSearch.mockResolvedValue(resultsWithDuplicatePropositions);

      const result = await searchKnowledgeBase.handle(
        { query: 'test query' },
        mockContext
      );

      // Should only show each unique proposition once
      const ideaACount = (result.content.match(/Idea A/g) || []).length;
      expect(ideaACount).toBe(1);
      expect(result.content).toContain('• Idea A');
      expect(result.content).toContain('• Idea B');
      expect(result.content).toContain('• Idea C');
    });

    it('should limit propositions when there are too many', async () => {
      const manyPropositions = Array.from({ length: 15 }, (_, i) => `Idea ${i}`);
      const resultsWithManyPropositions: HybridSearchResult[] = [
        {
          id: '1',
          title: 'Many Ideas',
          content: 'Content',
          score: 0.9,
          source: 'local',
          propositions: manyPropositions,
        },
      ];
      mockSearch.mockResolvedValue(resultsWithManyPropositions);

      const result = await searchKnowledgeBase.handle(
        { query: 'test query' },
        mockContext
      );

      // Should show first 10 propositions and indicate there are more
      expect(result.content).toContain('• Idea 0');
      expect(result.content).toContain('• Idea 9');
      expect(result.content).not.toContain('• Idea 10');
      expect(result.content).toContain('... and 5 more ideas');
    });

    it('should limit sources when there are too many', async () => {
      const manyResults = Array.from({ length: 12 }, (_, i) => ({
        id: `${i}`,
        title: `Result ${i}`,
        url: `https://example.com/${i}`,
        content: 'Content',
        score: 0.9 - i * 0.05,
        source: 'local' as const,
      }));
      mockSearch.mockResolvedValue(manyResults);

      const result = await searchKnowledgeBase.handle(
        { query: 'test query' },
        mockContext
      );

      // Should show first 8 sources
      expect(result.content).toContain('Result 0');
      expect(result.content).toContain('Result 7');
      expect(result.content).not.toContain('Result 8');
      expect(result.content).toContain('... and 4 more sources');
    });
  });
});