import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SearchService } from '../SearchService';
import { HybridSearchService } from '../../HybridSearchService';
import { ExaService } from '../../ExaService';
import { SliceService } from '../../SliceService';
import { SearchResultFormatter } from '../../SearchResultFormatter';
import { logger } from '../../../utils/logger';
import type { HybridSearchResult, DisplaySlice } from '../../../shared/types';

// Mock logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
  },
}));

// Mock dynamic import for cleanNewsContent
vi.doMock('../helpers/contentFilter', () => ({
  cleanNewsContent: vi.fn((content) => 'Cleaned news content'),
}));

describe('SearchService', () => {
  let searchService: SearchService;
  let hybridSearchService: Partial<HybridSearchService>;
  let exaService: Partial<ExaService>;
  let sliceService: Partial<SliceService>;

  const mockWebSearchResult: HybridSearchResult = {
    id: 'web-1',
    url: 'https://example.com/article',
    title: 'Test Article',
    content: 'This is the full content of the test article that will be truncated for display',
    score: 0.95,
    publishedDate: '2024-01-01',
    highlights: ['test highlight'],
    source: 'exa',
  };

  const mockLocalSearchResult: HybridSearchResult = {
    id: 'local-1',
    url: 'local://object/123',
    title: 'Local Document',
    content: 'This is the content of a local document that will be processed',
    score: 0.85,
    source: 'local',
    objectId: 'object-123',
    chunkId: 456,
  };

  beforeEach(async () => {
    // Mock services
    hybridSearchService = {
      search: vi.fn().mockResolvedValue([mockWebSearchResult]),
      searchNews: vi.fn().mockResolvedValue([mockWebSearchResult]),
    };

    exaService = {
      search: vi.fn().mockResolvedValue({
        results: [
          {
            id: 'exa-1',
            url: 'https://nytimes.com/article',
            title: 'NYT Article',
            text: 'Article content',
            summary: 'Article summary',
            score: 0.9,
            publishedDate: '2024-01-01',
            author: 'Test Author',
            highlights: ['test highlight'],
          },
        ],
      }),
    };

    sliceService = {
      getDetailsForSlices: vi.fn().mockResolvedValue([
        {
          chunkId: 456,
          content: 'Test content',
          summary: 'Test summary',
          sourceObjectId: 'object-123',
          sourceObjectTitle: 'Local Document',
          sourceObjectUri: 'local://object/123',
        },
      ]),
    };

    // Create SearchService instance
    searchService = new SearchService({
      hybridSearchService: hybridSearchService as HybridSearchService,
      exaService: exaService as ExaService,
      sliceService: sliceService as SliceService,
    });

    await searchService.initialize();
  });

  afterEach(async () => {
    await searchService.cleanup();
    vi.clearAllMocks();
  });

  describe('result accumulation', () => {
    it('should manage search results state', () => {
      // Initial state
      expect(searchService.getCurrentSearchResults()).toEqual([]);

      // Accumulate results
      searchService.accumulateSearchResults([mockWebSearchResult]);
      expect(searchService.getCurrentSearchResults()).toHaveLength(1);

      // Add more results
      searchService.accumulateSearchResults([mockLocalSearchResult]);
      expect(searchService.getCurrentSearchResults()).toHaveLength(2);

      // Clear results
      searchService.clearSearchResults();
      expect(searchService.getCurrentSearchResults()).toHaveLength(0);
    });
  });

  describe('detectNewsSources', () => {
    it('should detect and clean news sources from query', () => {
      const testCases = [
        { query: 'climate change nyt', expected: { sources: ['nytimes.com'], cleanedQuery: 'climate change' } },
        { query: 'tech news from wsj and reuters', expected: { sources: ['wsj.com', 'reuters.com'], cleanedQuery: 'tech news' } },
        { query: 'NYT article about AI', expected: { sources: ['nytimes.com'], cleanedQuery: 'article about AI' } },
        { query: 'general search query', expected: { sources: [], cleanedQuery: 'general search query' } },
        { query: 'nyt wsj reuters', expected: { sources: ['nytimes.com', 'wsj.com', 'reuters.com'], cleanedQuery: '' } },
      ];

      testCases.forEach(({ query, expected }) => {
        const result = searchService.detectNewsSources(query);
        expect(result).toEqual(expected);
      });
    });
  });

  describe('searchNews', () => {
    it('should use multi-source search when sources are detected', async () => {
      const query = 'climate change nyt wsj';
      const results = await searchService.searchNews(query);

      expect(exaService.search).toHaveBeenCalledTimes(2);
      expect(exaService.search).toHaveBeenCalledWith(
        expect.stringContaining('site:nytimes.com'),
        expect.any(Object)
      );
      expect(exaService.search).toHaveBeenCalledWith(
        expect.stringContaining('site:wsj.com'),
        expect.any(Object)
      );
      expect(results).toHaveLength(2);
    });

    it('should use general news search when no sources are detected', async () => {
      const query = 'climate change news';
      const results = await searchService.searchNews(query);

      expect(hybridSearchService.searchNews).toHaveBeenCalledWith(
        'climate change news',
        expect.objectContaining({ numResults: 10 })
      );
      expect(results).toEqual([mockWebSearchResult]);
    });

    it('should handle search errors gracefully', async () => {
      exaService.search = vi.fn().mockRejectedValue(new Error('Search failed'));
      const results = await searchService.searchNews('news from nyt');

      expect(results).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        '[SearchService] Failed to search nytimes.com:',
        expect.any(Error)
      );
    });
  });

  describe('processSearchResultsToSlices', () => {
    it('should process web results correctly', async () => {
      const slices = await searchService.processSearchResultsToSlices([mockWebSearchResult]);

      expect(slices).toHaveLength(1);
      expect(slices[0]).toMatchObject({
        id: mockWebSearchResult.id,
        content: expect.stringContaining(mockWebSearchResult.content.substring(0, 500)),
        title: mockWebSearchResult.title,
        sourceUri: mockWebSearchResult.url,
        sourceType: 'web',
      });
    });

    it('should process local results with slice service', async () => {
      const slices = await searchService.processSearchResultsToSlices([mockLocalSearchResult]);

      expect(sliceService.getDetailsForSlices).toHaveBeenCalledWith([456]);
      expect(slices).toHaveLength(1);
      expect(slices[0]).toMatchObject({
        id: 'local-456',
        title: 'Local Document',
        sourceUri: 'local://object/123',
        content: 'Test content',
        summary: 'Test summary',
        sourceType: 'local',
      });
    });

    it('should handle mixed results and deduplication', async () => {
      const duplicateResults = [
        mockWebSearchResult,
        { ...mockWebSearchResult, id: 'web-2', score: 0.8 },
        mockLocalSearchResult,
      ];

      const slices = await searchService.processSearchResultsToSlices(duplicateResults);
      expect(slices).toHaveLength(2); // One web result (deduplicated) + one local result
    });

    it('should limit results to 100', async () => {
      const manyResults = Array(150).fill(null).map((_, i) => ({
        ...mockWebSearchResult,
        id: `web-${i}`,
        url: `https://example.com/article-${i}`,
      }));

      const slices = await searchService.processSearchResultsToSlices(manyResults);
      expect(slices).toHaveLength(100);
    });

    it('should handle slice service failures with fallback', async () => {
      sliceService.getDetailsForSlices = vi.fn().mockRejectedValue(new Error('Slice service error'));
      
      const slices = await searchService.processSearchResultsToSlices([mockLocalSearchResult]);
      
      expect(slices).toHaveLength(1);
      expect(slices[0]).toMatchObject({
        id: mockLocalSearchResult.id,
        content: expect.stringContaining(mockLocalSearchResult.content.substring(0, 500)),
        title: mockLocalSearchResult.title,
        sourceUri: mockLocalSearchResult.url,
        sourceType: 'local',
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle full news search flow with accumulation', async () => {
      // First search
      const results1 = await searchService.searchNews('AI news from nyt');
      searchService.accumulateSearchResults(results1);
      expect(searchService.getCurrentSearchResults()).toHaveLength(1);

      // Second search
      hybridSearchService.searchNews = vi.fn().mockResolvedValue([mockLocalSearchResult]);
      const results2 = await searchService.searchNews('local AI research');
      searchService.accumulateSearchResults(results2);
      expect(searchService.getCurrentSearchResults()).toHaveLength(2);

      // Process all results
      const slices = await searchService.processSearchResultsToSlices(
        searchService.getCurrentSearchResults()
      );
      expect(slices).toHaveLength(2);
    });

    it('should handle concurrent operations safely', async () => {
      const searches = Promise.all([
        searchService.searchNews('query1').then(r => {
          searchService.accumulateSearchResults(r);
          return r;
        }),
        searchService.searchNews('query2').then(r => {
          searchService.accumulateSearchResults(r);
          return r;
        }),
        searchService.searchNews('query3').then(r => {
          searchService.accumulateSearchResults(r);
          return r;
        }),
      ]);

      await expect(searches).resolves.toBeDefined();
      expect(searchService.getCurrentSearchResults().length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle results with missing optional fields', async () => {
      const minimalResult: HybridSearchResult = {
        id: 'minimal-1',
        title: 'Minimal Result',
        content: 'Content',
        score: 0.5,
        source: 'exa',
      };

      const slices = await searchService.processSearchResultsToSlices([minimalResult]);
      
      expect(slices).toHaveLength(1);
      expect(slices[0]).toMatchObject({
        id: 'minimal-1',
        title: 'Minimal Result',
        sourceUri: null,
        sourceType: 'web',
      });
    });

    it('should handle very long content appropriately', async () => {
      const longContentResult = {
        ...mockWebSearchResult,
        content: 'x'.repeat(1000),
      };

      const slices = await searchService.processSearchResultsToSlices([longContentResult]);
      expect(slices[0].content).toHaveLength(500); // Truncated to 500
    });

    it('should handle empty slice details gracefully', async () => {
      sliceService.getDetailsForSlices = vi.fn().mockResolvedValue([]);
      const slices = await searchService.processSearchResultsToSlices([mockLocalSearchResult]);
      expect(slices).toEqual([]);
    });

    it('should handle malformed local results', async () => {
      const malformedResult: HybridSearchResult = {
        ...mockLocalSearchResult,
        chunkId: undefined,
      };

      const slices = await searchService.processSearchResultsToSlices([malformedResult]);
      expect(sliceService.getDetailsForSlices).not.toHaveBeenCalled();
      expect(slices).toEqual([]);
    });
  });
});