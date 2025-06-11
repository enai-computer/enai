import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { searchWeb } from '../searchWeb';
import { ToolContext } from '../types';
import { logger } from '../../../../utils/logger';
import { HybridSearchResult } from '../../../../shared/types';
import { NEWS_SOURCE_MAPPINGS } from '../../../AgentService.constants';

// Mock the logger
vi.mock('../../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the contentFilter module
vi.mock('../../../helpers/contentFilter', () => ({
  cleanNewsContent: vi.fn((content: string) => `[cleaned] ${content}`),
}));

describe('searchWeb', () => {
  let mockContext: ToolContext;
  let mockHybridSearch: Mock;
  let mockSearchNews: Mock;
  let mockExaSearch: Mock;
  let mockFormatSearchResults: Mock;
  let mockFormatNewsResults: Mock;
  let mockFormatMultiSourceNews: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockHybridSearch = vi.fn();
    mockSearchNews = vi.fn();
    mockExaSearch = vi.fn();
    mockFormatSearchResults = vi.fn();
    mockFormatNewsResults = vi.fn();
    mockFormatMultiSourceNews = vi.fn();
    
    mockContext = {
      services: {
        notebookService: {},
        hybridSearchService: {
          search: mockHybridSearch,
          searchNews: mockSearchNews,
        },
        exaService: {
          search: mockExaSearch,
        },
        sliceService: {},
        profileService: {},
      },
      sessionInfo: {
        senderId: 'test-sender',
        sessionId: 'test-session',
      },
      currentIntentSearchResults: [],
      formatter: {
        formatSearchResults: mockFormatSearchResults,
        formatNewsResults: mockFormatNewsResults,
        formatMultiSourceNews: mockFormatMultiSourceNews,
      },
    } as unknown as ToolContext;
  });

  describe('tool properties', () => {
    it('should have correct name and description', () => {
      expect(searchWeb.name).toBe('search_web');
      expect(searchWeb.description).toContain('Search the web for information');
      expect(searchWeb.description).toContain('Exa.ai\'s neural search');
    });

    it('should have correct parameter schema', () => {
      expect(searchWeb.parameters).toEqual({
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query. For multiple news sources, include ALL sources in one query.',
          },
          searchType: {
            type: 'string',
            description: 'Type of search: \'general\' for any content, \'news\' for news articles, \'headlines\' for latest news headlines',
            default: 'general',
          },
          dateRange: {
            type: 'string',
            description: 'For news searches: \'today\' for today\'s news, \'week\' for past week, \'month\' for past month',
          },
        },
        required: ['query'],
      });
    });
  });

  describe('handle method - general search', () => {
    const mockSearchResults: HybridSearchResult[] = [
      {
        id: '1',
        title: 'Web Result 1',
        url: 'https://example.com/1',
        content: 'Web content 1',
        score: 0.9,
        source: 'exa',
      },
      {
        id: '2',
        title: 'Local Result',
        content: 'Local content',
        score: 0.8,
        source: 'local',
      },
    ];

    it('should perform general web search by default', async () => {
      mockHybridSearch.mockResolvedValue(mockSearchResults);
      mockFormatSearchResults.mockReturnValue('Formatted search results');

      const result = await searchWeb.handle(
        { query: 'test query' },
        mockContext
      );

      expect(mockHybridSearch).toHaveBeenCalledWith('test query', {
        numResults: 10,
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[searchWeb] Searching: "test query" (type: general)'
      );
      expect(mockContext.currentIntentSearchResults).toEqual(mockSearchResults);
      expect(mockFormatSearchResults).toHaveBeenCalledWith(mockSearchResults);
      expect(result).toEqual({
        content: 'Formatted search results',
      });
    });

    it('should handle missing query parameter', async () => {
      const result = await searchWeb.handle({}, mockContext);

      expect(result).toEqual({
        content: 'Error: Search query was unclear.',
      });
      expect(mockHybridSearch).not.toHaveBeenCalled();
    });

    it('should handle search errors gracefully', async () => {
      const error = new Error('Network timeout');
      mockHybridSearch.mockRejectedValue(error);

      const result = await searchWeb.handle(
        { query: 'error query' },
        mockContext
      );

      expect(logger.error).toHaveBeenCalledWith('[searchWeb] Search error:', error);
      expect(result).toEqual({
        content: 'Search failed: Network timeout',
      });
    });

    it('should handle non-Error search failures', async () => {
      mockHybridSearch.mockRejectedValue('String error');

      const result = await searchWeb.handle(
        { query: 'error query' },
        mockContext
      );

      expect(result).toEqual({
        content: 'Search failed: Unknown error',
      });
    });
  });

  describe('handle method - news search', () => {
    const mockNewsResults: HybridSearchResult[] = [
      {
        id: 'news-1',
        title: 'Breaking News',
        url: 'https://news.com/article1',
        content: 'News content',
        score: 0.95,
        source: 'exa',
        publishedDate: '2024-01-15',
        author: 'News Reporter',
      },
    ];

    it('should perform news search when searchType is news', async () => {
      mockSearchNews.mockResolvedValue(mockNewsResults);
      mockFormatNewsResults.mockReturnValue('Formatted news results');

      const result = await searchWeb.handle(
        { query: 'latest tech news', searchType: 'news' },
        mockContext
      );

      expect(mockSearchNews).toHaveBeenCalledWith('latest tech news', {
        numResults: 10,
      });
      expect(mockContext.currentIntentSearchResults).toEqual(mockNewsResults);
      expect(mockFormatNewsResults).toHaveBeenCalledWith(mockNewsResults);
      expect(result).toEqual({
        content: 'Formatted news results',
      });
    });

    it('should perform headlines search when searchType is headlines', async () => {
      mockSearchNews.mockResolvedValue(mockNewsResults);
      mockFormatNewsResults.mockReturnValue('Formatted headlines');

      const result = await searchWeb.handle(
        { query: 'today headlines', searchType: 'headlines' },
        mockContext
      );

      expect(mockSearchNews).toHaveBeenCalledWith('today headlines', {
        numResults: 10,
      });
      expect(mockFormatNewsResults).toHaveBeenCalledWith(mockNewsResults);
      expect(result).toEqual({
        content: 'Formatted headlines',
      });
    });
  });

  describe('handle method - multi-source news search', () => {
    const mockMultiSourceResults: HybridSearchResult[] = [
      {
        id: 'cnn-1',
        title: 'CNN Article',
        url: 'https://cnn.com/article',
        content: '[cleaned] CNN content',
        score: 0.9,
        source: 'exa',
      },
      {
        id: 'bbc-1',
        title: 'BBC Article',
        url: 'https://bbc.com/article',
        content: '[cleaned] BBC content',
        score: 0.85,
        source: 'exa',
      },
    ];

    it('should detect and search multiple news sources', async () => {
      mockExaSearch.mockImplementation((query: string, options: any) => {
        if (options.includeDomains?.[0] === 'cnn.com') {
          return Promise.resolve({
            results: [{
              id: 'cnn-1',
              title: 'CNN Article',
              url: 'https://cnn.com/article',
              text: 'CNN content',
              score: 0.9,
            }],
          });
        }
        if (options.includeDomains?.[0] === 'bbc.com') {
          return Promise.resolve({
            results: [{
              id: 'bbc-1',
              title: 'BBC Article',
              url: 'https://bbc.com/article',
              text: 'BBC content',
              score: 0.85,
            }],
          });
        }
        return Promise.resolve({ results: [] });
      });

      mockFormatMultiSourceNews.mockReturnValue('Formatted multi-source news');

      const result = await searchWeb.handle(
        { query: 'AI news from CNN and BBC', searchType: 'news' },
        mockContext
      );

      // Verify Exa was called for each source
      expect(mockExaSearch).toHaveBeenCalledTimes(2);
      expect(mockExaSearch).toHaveBeenCalledWith(
        'site:cnn.com AI news today',
        expect.objectContaining({
          type: 'neural',
          numResults: 3,
          includeDomains: ['cnn.com'],
        })
      );
      expect(mockExaSearch).toHaveBeenCalledWith(
        'site:bbc.com AI news today',
        expect.objectContaining({
          type: 'neural',
          numResults: 3,
          includeDomains: ['bbc.com'],
        })
      );

      expect(mockFormatMultiSourceNews).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ title: 'CNN Article' }),
          expect.objectContaining({ title: 'BBC Article' }),
        ]),
        ['cnn.com', 'bbc.com']
      );
      expect(result.content).toBe('Formatted multi-source news');
    });

    it('should handle case-insensitive source detection', async () => {
      mockExaSearch.mockResolvedValue({ results: [] });
      mockFormatMultiSourceNews.mockReturnValue('Formatted results');

      await searchWeb.handle(
        { query: 'news from CNN and bbc', searchType: 'news' },
        mockContext
      );

      expect(mockExaSearch).toHaveBeenCalledTimes(2);
      expect(mockFormatMultiSourceNews).toHaveBeenCalledWith(
        expect.any(Array),
        ['cnn.com', 'bbc.com']
      );
    });

    it('should handle failed source searches gracefully', async () => {
      mockExaSearch.mockImplementation((query: string, options: any) => {
        if (options.includeDomains?.[0] === 'cnn.com') {
          return Promise.reject(new Error('CNN search failed'));
        }
        return Promise.resolve({
          results: [{
            id: 'bbc-1',
            title: 'BBC Article',
            url: 'https://bbc.com/article',
            text: 'BBC content',
            score: 0.85,
          }],
        });
      });

      mockFormatMultiSourceNews.mockReturnValue('Partial results formatted');

      const result = await searchWeb.handle(
        { query: 'news from CNN and BBC', searchType: 'news' },
        mockContext
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[searchWeb] Failed to search cnn.com:',
        expect.any(Error)
      );
      
      // Should still return results from successful source
      expect(mockFormatMultiSourceNews).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ title: 'BBC Article' }),
        ]),
        ['cnn.com', 'bbc.com']
      );
      expect(result.content).toBe('Partial results formatted');
    });

    it('should clean query by removing source names', async () => {
      mockExaSearch.mockResolvedValue({ results: [] });
      mockFormatMultiSourceNews.mockReturnValue('Formatted');

      await searchWeb.handle(
        { query: 'technology updates from CNN, BBC and Reuters', searchType: 'news' },
        mockContext
      );

      // Should search with cleaned query "technology updates"
      expect(mockExaSearch).toHaveBeenCalledWith(
        expect.stringContaining('technology updates'),
        expect.any(Object)
      );
      expect(mockExaSearch).not.toHaveBeenCalledWith(
        expect.stringContaining('CNN'),
        expect.any(Object)
      );
    });

    it('should handle empty cleaned query', async () => {
      mockExaSearch.mockResolvedValue({ results: [] });
      mockFormatMultiSourceNews.mockReturnValue('Formatted');

      await searchWeb.handle(
        { query: 'CNN and BBC', searchType: 'news' },
        mockContext
      );

      // When query is empty after cleaning, should default to 'headlines'
      expect(mockExaSearch).toHaveBeenCalledWith(
        'site:cnn.com headlines today',
        expect.any(Object)
      );
    });
  });

  describe('handle method - edge cases', () => {
    it('should handle null query parameter', async () => {
      const result = await searchWeb.handle({ query: null }, mockContext);

      expect(result).toEqual({
        content: 'Error: Search query was unclear.',
      });
    });

    it('should handle empty query string', async () => {
      const result = await searchWeb.handle({ query: '' }, mockContext);

      expect(result).toEqual({
        content: 'Error: Search query was unclear.',
      });
    });

    it('should handle news search with no detected sources', async () => {
      mockSearchNews.mockResolvedValue([]);
      mockFormatNewsResults.mockReturnValue('No news found');

      const result = await searchWeb.handle(
        { query: 'random news query', searchType: 'news' },
        mockContext
      );

      expect(mockSearchNews).toHaveBeenCalled();
      expect(mockFormatNewsResults).toHaveBeenCalledWith([]);
      expect(result.content).toBe('No news found');
    });

    it('should aggregate all search results', async () => {
      const results1: HybridSearchResult[] = [
        { id: '1', title: 'Result 1', content: 'Content 1', score: 0.9, source: 'exa' },
      ];
      const results2: HybridSearchResult[] = [
        { id: '2', title: 'Result 2', content: 'Content 2', score: 0.8, source: 'exa' },
      ];

      mockHybridSearch.mockResolvedValueOnce(results1);
      mockHybridSearch.mockResolvedValueOnce(results2);
      mockFormatSearchResults.mockReturnValue('Formatted');

      // First search
      await searchWeb.handle({ query: 'first query' }, mockContext);
      expect(mockContext.currentIntentSearchResults).toEqual(results1);

      // Second search should append to existing results
      await searchWeb.handle({ query: 'second query' }, mockContext);
      expect(mockContext.currentIntentSearchResults).toEqual([...results1, ...results2]);
    });
  });

  describe('news source detection', () => {
    it('should detect all supported news sources', async () => {
      mockExaSearch.mockResolvedValue({ results: [] });
      mockFormatMultiSourceNews.mockReturnValue('Formatted');

      const allSources = Object.keys(NEWS_SOURCE_MAPPINGS).join(' and ');
      await searchWeb.handle(
        { query: `news from ${allSources}`, searchType: 'news' },
        mockContext
      );

      // Should call search for each source
      expect(mockExaSearch).toHaveBeenCalledTimes(Object.keys(NEWS_SOURCE_MAPPINGS).length);
    });

    it('should detect sources using aliases', async () => {
      mockExaSearch.mockResolvedValue({ results: [] });
      mockFormatMultiSourceNews.mockReturnValue('Formatted');

      // Test with various aliases
      await searchWeb.handle(
        { query: 'news from new york times and washington post', searchType: 'news' },
        mockContext
      );

      expect(mockExaSearch).toHaveBeenCalledWith(
        expect.stringContaining('site:nytimes.com'),
        expect.any(Object)
      );
      expect(mockExaSearch).toHaveBeenCalledWith(
        expect.stringContaining('site:washingtonpost.com'),
        expect.any(Object)
      );
    });
  });
});