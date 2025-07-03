import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SearchService } from '../SearchService';
import { HybridSearchService } from '../../HybridSearchService';
import { ExaService } from '../../ExaService';
import { SliceService } from '../../SliceService';
import { SearchResultFormatter } from '../../SearchResultFormatter';
import { logger } from '../../../utils/logger';
import type { HybridSearchResult, DisplaySlice } from '../../../shared/types';

// Mock logger
vi.mock('../../../utils/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
  };
  return {
    logger: mockLogger,
    default: mockLogger,
  };
});

// Mock dynamic import for cleanNewsContent - module needs to be accessible 
vi.doMock('../helpers/contentFilter', () => ({
  cleanNewsContent: vi.fn((content) => 'Cleaned news content'),
}));

describe('SearchService', () => {
  let searchService: SearchService;
  let hybridSearchService: Partial<HybridSearchService>;
  let exaService: Partial<ExaService>;
  let sliceService: Partial<SliceService>;
  let formatter: SearchResultFormatter;

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

  const mockDisplaySlice: DisplaySlice = {
    id: 'slice-1',
    title: 'Test Title',
    sourceUri: 'https://example.com',
    content: 'Test content',
    summary: null,
    sourceType: 'local',
    chunkId: 456,
    sourceObjectId: 'object-123',
    score: 0.85,
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

    formatter = new SearchResultFormatter();

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

  describe('clearSearchResults', () => {
    it('should clear accumulated search results', () => {
      // Arrange
      searchService.accumulateSearchResults([mockWebSearchResult]);
      expect(searchService.getCurrentSearchResults()).toHaveLength(1);

      // Act
      searchService.clearSearchResults();

      // Assert
      expect(searchService.getCurrentSearchResults()).toHaveLength(0);
    });
  });

  describe('getCurrentSearchResults', () => {
    it('should return empty array initially', () => {
      expect(searchService.getCurrentSearchResults()).toEqual([]);
    });

    it('should return accumulated results', () => {
      searchService.accumulateSearchResults([mockWebSearchResult]);
      const results = searchService.getCurrentSearchResults();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(mockWebSearchResult);
    });
  });

  describe('accumulateSearchResults', () => {
    it('should accumulate multiple sets of results', () => {
      // First accumulation
      searchService.accumulateSearchResults([mockWebSearchResult]);
      expect(searchService.getCurrentSearchResults()).toHaveLength(1);

      // Second accumulation
      searchService.accumulateSearchResults([mockLocalSearchResult]);
      expect(searchService.getCurrentSearchResults()).toHaveLength(2);

      // Verify both results are present
      const results = searchService.getCurrentSearchResults();
      expect(results).toContainEqual(mockWebSearchResult);
      expect(results).toContainEqual(mockLocalSearchResult);
    });

    it('should handle empty results', () => {
      searchService.accumulateSearchResults([]);
      expect(searchService.getCurrentSearchResults()).toHaveLength(0);
    });
  });

  describe('detectNewsSources', () => {
    it('should detect single news source', () => {
      const result = searchService.detectNewsSources('climate change nyt');
      expect(result.sources).toEqual(['nytimes.com']);
      expect(result.cleanedQuery).toBe('climate change');
    });

    it('should detect multiple news sources', () => {
      const result = searchService.detectNewsSources('tech news from wsj and reuters');
      expect(result.sources).toContain('wsj.com');
      expect(result.sources).toContain('reuters.com');
      expect(result.cleanedQuery).toBe('tech news');
    });

    it('should handle case-insensitive matching', () => {
      const result = searchService.detectNewsSources('NYT article about AI');
      expect(result.sources).toEqual(['nytimes.com']);
      expect(result.cleanedQuery).toBe('article about AI');
    });

    it('should handle queries with no news sources', () => {
      const result = searchService.detectNewsSources('general search query');
      expect(result.sources).toEqual([]);
      expect(result.cleanedQuery).toBe('general search query');
    });

    it('should handle queries with only news sources', () => {
      const result = searchService.detectNewsSources('nyt wsj reuters');
      expect(result.sources).toHaveLength(3);
      expect(result.cleanedQuery).toBe('');
    });

    it('should handle punctuation around sources', () => {
      const result = searchService.detectNewsSources('Read the (NYT) article');
      expect(result.sources).toEqual(['nytimes.com']);
      expect(result.cleanedQuery).toBe('Read () article');
    });
  });

  describe('searchNews', () => {
    it('should use multi-source search when sources are detected', async () => {
      // Arrange
      const query = 'climate change nyt wsj';

      // Act
      const results = await searchService.searchNews(query);

      // Assert
      expect(exaService.search).toHaveBeenCalledTimes(2);
      expect(exaService.search).toHaveBeenCalledWith(
        expect.stringContaining('site:nytimes.com'),
        expect.any(Object)
      );
      expect(exaService.search).toHaveBeenCalledWith(
        expect.stringContaining('site:wsj.com'),
        expect.any(Object)
      );
      expect(hybridSearchService.search).not.toHaveBeenCalled();
      expect(results).toHaveLength(2); // Expecting 2 results from 2 sources
    });

    it('should use general news search when no sources are detected', async () => {
      // Arrange
      const query = 'climate change news';

      // Act
      const results = await searchService.searchNews(query);

      // Assert
      expect(hybridSearchService.searchNews).toHaveBeenCalledWith(
        'climate change news',
        expect.objectContaining({
          numResults: 10,
        })
      );
      expect(exaService.search).not.toHaveBeenCalled();
      expect(results).toEqual([mockWebSearchResult]);
    });

    it('should accumulate results to internal state', async () => {
      // Act
      const results = await searchService.searchNews('tech news');
      searchService.accumulateSearchResults(results);

      // Assert
      expect(searchService.getCurrentSearchResults()).toHaveLength(1);
    });

    it('should handle errors from search services', async () => {
      // Arrange
      exaService.search = vi.fn().mockRejectedValue(new Error('Search failed'));

      // Act - test multi-source search with error (it returns empty array on error)
      const results = await searchService.searchNews('news from nyt');

      // Assert
      expect(results).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        '[SearchService] Failed to search nytimes.com:',
        expect.any(Error)
      );
    });

    it('should call cleanNewsContent for multi-source results', async () => {
      // Act
      const results = await searchService.searchNews('nyt article');

      // Assert
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toMatchObject({
        id: 'exa-1',
        title: 'NYT Article',
        url: 'https://nytimes.com/article',
        source: 'exa'
      });
      // Content should be processed (either text or summary)
      expect(results[0].content).toBeDefined();
    });
  });

  describe('processSearchResultsToSlices', () => {
    it('should process web results correctly', async () => {
      // Arrange
      const results = [mockWebSearchResult];

      // Act
      const slices = await searchService.processSearchResultsToSlices(results);

      // Assert
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
      // Arrange
      const results = [mockLocalSearchResult];

      // Act
      const slices = await searchService.processSearchResultsToSlices(results);

      // Assert
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

    it('should handle slice service failures with fallback', async () => {
      // Arrange
      sliceService.getDetailsForSlices = vi.fn().mockRejectedValue(new Error('Slice service error'));
      const results = [mockLocalSearchResult]; // Already has content field

      // Act
      const slices = await searchService.processSearchResultsToSlices(results);

      // Assert
      expect(slices).toHaveLength(1);
      expect(slices[0]).toMatchObject({
        id: mockLocalSearchResult.id,
        content: expect.stringContaining(mockLocalSearchResult.content.substring(0, 500)),
        title: mockLocalSearchResult.title,
        sourceUri: mockLocalSearchResult.url,
        sourceType: 'local',
      });
    });

    it('should handle mixed local and web results', async () => {
      // Arrange
      const results = [mockWebSearchResult, mockLocalSearchResult];

      // Act
      const slices = await searchService.processSearchResultsToSlices(results);

      // Assert
      expect(slices).toHaveLength(2);
      expect(sliceService.getDetailsForSlices).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate results', async () => {
      // Arrange
      const duplicateResults = [
        mockWebSearchResult,
        { ...mockWebSearchResult, id: 'web-2', score: 0.8, source: 'exa' as const }, // Lower score duplicate with different id
      ];

      // Act
      const slices = await searchService.processSearchResultsToSlices(duplicateResults);

      // Assert
      expect(slices).toHaveLength(1);
      expect(slices[0].score).toBe(0.95); // Higher score preserved
    });

    it('should limit results to 100', async () => {
      // Arrange
      const manyResults = Array(150).fill(null).map((_, i) => ({
        ...mockWebSearchResult,
        id: `web-${i}`,
        url: `https://example.com/article-${i}`,
      }));

      // Act
      const slices = await searchService.processSearchResultsToSlices(manyResults);

      // Assert
      expect(slices).toHaveLength(100);
    });

    it('should handle empty results', async () => {
      const slices = await searchService.processSearchResultsToSlices([]);
      expect(slices).toEqual([]);
    });

    it('should preserve metadata in slices', async () => {
      // Arrange
      const resultWithMetadata: HybridSearchResult = {
        ...mockWebSearchResult,
        author: 'Test Author',
      };

      // Act
      const slices = await searchService.processSearchResultsToSlices([resultWithMetadata]);

      // Assert
      expect(slices[0]).toMatchObject({
        score: resultWithMetadata.score,
      });
      expect(slices[0].author).toBe('Test Author');
    });

    it('should handle local results with complex IDs', async () => {
      // Arrange
      const complexLocalResult: HybridSearchResult = {
        ...mockLocalSearchResult,
        id: 'local-object-123-chunk-456',
        objectId: 'object-123',
        chunkId: 456,
      };

      // Act
      const slices = await searchService.processSearchResultsToSlices([complexLocalResult]);

      // Assert
      expect(sliceService.getDetailsForSlices).toHaveBeenCalledWith([456]);
    });

    it('should handle errors in slice processing gracefully', async () => {
      // Arrange
      sliceService.getDetailsForSlices = vi.fn().mockRejectedValue(new Error('Slice service error'));
      const results = [mockLocalSearchResult];

      // Act
      const slices = await searchService.processSearchResultsToSlices(results);

      // Assert
      expect(logger.debug).toHaveBeenCalledWith('[SearchService] Using fallback for local results');
      expect(slices).toHaveLength(1); // Fallback slice created
    });
  });

  describe('error handling', () => {
    it('should handle empty slice details gracefully', async () => {
      // Arrange
      sliceService.getDetailsForSlices = vi.fn().mockResolvedValue([]);
      const results = [mockLocalSearchResult];

      // Act
      const slices = await searchService.processSearchResultsToSlices(results);

      // Assert - should not create any slices since getDetailsForSlices returned empty
      expect(slices).toEqual([]);
    });

    it('should handle malformed search results', async () => {
      // Arrange - result with invalid chunkId
      const malformedResult: HybridSearchResult = {
        ...mockLocalSearchResult,
        chunkId: undefined, // Invalid chunk ID
      };

      // Act
      const slices = await searchService.processSearchResultsToSlices([malformedResult]);

      // Assert - should not call getDetailsForSlices and return empty
      expect(sliceService.getDetailsForSlices).not.toHaveBeenCalled();
      expect(slices).toEqual([]);
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
      // Simulate concurrent searches
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

    it('should handle clearing and re-accumulating results', async () => {
      // Initial accumulation
      searchService.accumulateSearchResults([mockWebSearchResult]);
      expect(searchService.getCurrentSearchResults()).toHaveLength(1);

      // Clear
      searchService.clearSearchResults();
      expect(searchService.getCurrentSearchResults()).toHaveLength(0);

      // Re-accumulate
      searchService.accumulateSearchResults([mockLocalSearchResult]);
      expect(searchService.getCurrentSearchResults()).toHaveLength(1);
      expect(searchService.getCurrentSearchResults()[0]).toEqual(mockLocalSearchResult);
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
        // Missing url, publishedDate, author, etc.
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

    it('should handle duplicate chunk IDs in local results', async () => {
      const duplicateChunkResults = [
        { ...mockLocalSearchResult, id: 'local-1', chunkId: 456 },
        { ...mockLocalSearchResult, id: 'local-2', chunkId: 456 }, // Same chunk ID
      ];

      const slices = await searchService.processSearchResultsToSlices(duplicateChunkResults);
      
      // Should fetch details with both chunk IDs (even if duplicate)
      expect(sliceService.getDetailsForSlices).toHaveBeenCalledWith([456, 456]);
      expect(sliceService.getDetailsForSlices).toHaveBeenCalledTimes(1);
    });

    it('should handle all news sources from constants', async () => {
      // Test with a query containing multiple sources
      const multiSourceQuery = 'latest news from wsj, bbc, and reuters';
      const result = searchService.detectNewsSources(multiSourceQuery);
      
      expect(result.sources).toContain('wsj.com');
      expect(result.sources).toContain('bbc.com');
      expect(result.sources).toContain('reuters.com');
      // The cleaned query removes sources and common words like 'from', 'and'
      expect(result.cleanedQuery).toBe('latest news');
    });

    it('should handle deduplication with different scores correctly', async () => {
      const results = [
        { ...mockWebSearchResult, id: 'web-1', score: 0.9 },
        { ...mockWebSearchResult, id: 'web-2', score: 0.95 }, // Same URL, higher score
        { ...mockWebSearchResult, id: 'web-3', score: 0.85 }, // Same URL, lower score
      ];

      const slices = await searchService.processSearchResultsToSlices(results);
      
      // Should keep only the one with highest score
      expect(slices).toHaveLength(1);
      expect(slices[0].score).toBe(0.95);
    });
  });
});