import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { HybridSearchService } from '../HybridSearchService';
import { HybridSearchResult } from '../../shared/types';
import { ExaService } from '../ExaService';
import { IVectorStoreModel } from '../../shared/types/vector.types';
import { VectorSearchResult, VectorRecord } from '../../shared/types/vector.types';
import { logger } from '../../utils/logger';

// Mock logger to prevent console output during tests
vi.mock('../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('HybridSearchService with BaseService', () => {
  let hybridSearchService: HybridSearchService;
  let mockExaService: ExaService;
  let mockVectorModel: IVectorStoreModel;
  
  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Create mock instances
    mockExaService = {
      isConfigured: vi.fn().mockReturnValue(true),
      search: vi.fn(),
      initialize: vi.fn(),
      cleanup: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true)
    } as unknown as ExaService;
    
    mockVectorModel = {
      isReady: vi.fn().mockReturnValue(true),
      querySimilarByText: vi.fn(),
      initialize: vi.fn(),
      cleanup: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true)
    } as unknown as IVectorStoreModel;
    
    
    // Create service instance with dependency injection
    hybridSearchService = new HybridSearchService({
      exaService: mockExaService,
      vectorModel: mockVectorModel
    });
    
    // Initialize service
    await hybridSearchService.initialize();
  });
  
  afterEach(async () => {
    // Cleanup service
    await hybridSearchService.cleanup();
    
    vi.clearAllMocks();
  });
  
  describe('search', () => {
    it('should combine results from Exa and local vector store', async () => {
      // Mock Exa results
      const mockExaResults = {
        results: [
          {
            id: 'exa-1',
            score: 0.95,
            title: 'Exa Result 1',
            url: 'https://example.com/1',
            text: 'Content from Exa',
          },
          {
            id: 'exa-2',
            score: 0.85,
            title: 'Exa Result 2',
            url: 'https://example.com/2',
            summary: 'Summary from Exa',
          },
        ],
      };
      
      // Mock local vector results
      const mockLocalResults: VectorSearchResult[] = [
        {
          record: {
            id: 'local-1',
            recordType: 'chunk',
            mediaType: 'webpage',
            layer: 'lom',
            processingDepth: 'chunk',
            content: 'Local content 1',
            createdAt: Date.now(),
            objectId: 'obj-1',
            sqlChunkId: 1,
            title: 'Local Document 1',
          } as VectorRecord,
          score: 0.9, // similarity score (higher is better)
          distance: 0.1,
        },
        {
          record: {
            id: 'local-2',
            recordType: 'chunk',
            mediaType: 'webpage',
            layer: 'lom',
            processingDepth: 'chunk',
            content: 'Local content 2',
            createdAt: Date.now(),
            objectId: 'obj-2',
            sqlChunkId: 2,
            title: 'Local Document 2',
            sourceUri: 'file://local/doc2',
          } as VectorRecord,
          score: 0.8,
          distance: 0.2,
        },
      ];
      
      // Setup mocks
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockExaService.search as Mock).mockResolvedValue(mockExaResults);
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      
      // Perform search
      const results = await hybridSearchService.search('test query', {
        numResults: 3,
        localWeight: 0.4,
        exaWeight: 0.6,
      });
      
      // Verify search was called on both services
      expect(mockExaService.search).toHaveBeenCalledWith('test query', {
        numResults: 3, // No overfetch at orchestrator level for Exa
        contents: {
          text: true,
          summary: true,
        },
      });
      expect(mockVectorModel.querySimilarByText).toHaveBeenCalledWith('test query', { 
        k: 24, // 3 * 8 (TWO_STAGE_OVERFETCH_MULTIPLIER)
        filter: { layer: ['wom', 'lom'] } 
      });
      
      // Verify results are combined and limited
      expect(results).toHaveLength(3);
      expect(results.some((r: HybridSearchResult) => r.source === 'exa')).toBe(true);
      expect(results.some((r: HybridSearchResult) => r.source === 'local')).toBe(true);
    });
    
    it('should handle Exa service not configured', async () => {
      // Mock local results only
      const mockLocalResults: VectorSearchResult[] = [
        {
          record: {
            id: 'local-1',
            recordType: 'object',
            mediaType: 'webpage',
            layer: 'lom',
            processingDepth: 'summary',
            content: 'Local content only',
            createdAt: Date.now(),
            title: 'Local Only',
            objectId: 'obj-1', // Add objectId for proper deduplication
          } as VectorRecord,
          score: 0.9,
          distance: 0.1,
        },
      ];
      
      (mockExaService.isConfigured as Mock).mockReturnValue(false);
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      
      const results = await hybridSearchService.search('test query');
      
      
      // When Exa is not configured, it still attempts to use it by default (useExa=true)
      // But searchExa returns empty array when not configured
      expect(mockExaService.search).not.toHaveBeenCalled();
      
      // searchLocalWithLayers should have been called
      expect(mockVectorModel.querySimilarByText).toHaveBeenCalled();
      
      // Should have local results
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('local');
    });
    
    it('should handle vector model not ready', async () => {
      const mockExaResults = {
        results: [{
          id: 'exa-1',
          score: 0.9,
          title: 'Exa Only',
          url: 'https://example.com',
          text: 'Content',
        }],
      };
      
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockExaService.search as Mock).mockResolvedValue(mockExaResults);
      (mockVectorModel.isReady as Mock).mockReturnValue(false);
      (mockVectorModel.initialize as Mock).mockRejectedValue(new Error('Init failed'));
      
      const results = await hybridSearchService.search('test query');
      
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('exa');
    });
    
    it('should normalize weights if they do not sum to 1', async () => {
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockExaService.search as Mock).mockResolvedValue({ results: [] });
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue([]);
      
      await hybridSearchService.search('test', {
        localWeight: 0.3,
        exaWeight: 0.5, // Sum = 0.8, not 1.0
      });
      
      // Weights should be normalized automatically
      expect(mockExaService.search).toHaveBeenCalled();
      expect(mockVectorModel.querySimilarByText).toHaveBeenCalled();
    });
  });
  
  describe('searchLocal', () => {
    it('should search only local vector database', async () => {
      const mockResults: VectorSearchResult[] = [
        {
          record: {
            id: 'test-1',
            recordType: 'chunk',
            mediaType: 'webpage',
            layer: 'lom',
            processingDepth: 'chunk',
            content: 'Test content',
            createdAt: Date.now(),
            title: 'Test',
          } as VectorRecord,
          score: 0.85,
          distance: 0.15,
        },
      ];
      
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockResults);
      
      const results = await hybridSearchService.searchLocal('test query', 5);
      
      expect(mockVectorModel.querySimilarByText).toHaveBeenCalledWith('test query', { k: 5 }); // searchLocal doesn't use overfetch
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        source: 'local',
        score: 0.85,
        content: 'Test content',
      });
    });
    
    it('should initialize vector model if not ready', async () => {
      (mockVectorModel.isReady as Mock).mockReturnValue(false);
      (mockVectorModel.initialize as Mock).mockResolvedValue(undefined);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue([]);
      
      await hybridSearchService.searchLocal('test', 5);
      
      expect(mockVectorModel.initialize).toHaveBeenCalled();
    });
  });
  
  describe('deduplication', () => {
    it('should remove duplicate results based on objectId for local and URL for Exa', async () => {
      // Mock Exa to return articles with same URL
      const mockExaResults = {
        results: [
          {
            id: 'exa-1',
            score: 0.9,
            title: 'Same Article v1',
            url: 'https://example.com/article',
            text: 'Content from Exa v1',
          },
          {
            id: 'exa-2', 
            score: 0.8,
            title: 'Same Article v2',
            url: 'https://example.com/article', // Same URL - will be deduplicated
            text: 'Content from Exa v2',
          },
          {
            id: 'exa-3',
            score: 0.7,
            title: 'Different Article',
            url: 'https://example.com/other',
            text: 'Different content',
          },
        ],
      };
      
      // Mock local to return chunks with same objectId
      const mockLocalResults: VectorSearchResult[] = [
        {
          record: {
            id: 'local-1',
            recordType: 'chunk',
            mediaType: 'webpage',
            layer: 'lom',
            processingDepth: 'chunk',
            content: 'Local chunk 1',
            createdAt: Date.now(),
            objectId: 'obj-1',
            sqlChunkId: 1,
            title: 'Local Doc Chunk 1',
          } as VectorRecord,
          score: 0.85,
          distance: 0.15,
        },
        {
          record: {
            id: 'local-2',
            recordType: 'chunk',
            mediaType: 'webpage',
            layer: 'lom',
            processingDepth: 'chunk',
            content: 'Local chunk 2',
            createdAt: Date.now(),
            objectId: 'obj-1', // Same objectId - will be deduplicated
            sqlChunkId: 2,
            title: 'Local Doc Chunk 2',
          } as VectorRecord,
          score: 0.80,
          distance: 0.20,
        },
      ];
      
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockExaService.search as Mock).mockResolvedValue(mockExaResults);
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      
      // Test with deduplication enabled (default)
      const results = await hybridSearchService.search('test query', {
        numResults: 10,
        deduplicate: true,
      });
      
      // Should have 3 results: 2 unique Exa URLs + 1 unique local objectId
      expect(results).toHaveLength(3);
      
      // Verify deduplication kept first occurrence
      const exaArticles = results.filter(r => r.source === 'exa');
      expect(exaArticles).toHaveLength(2);
      expect(exaArticles[0].title).toBe('Same Article v1'); // First occurrence wins
      expect(exaArticles[1].title).toBe('Different Article');
      
      const localArticles = results.filter(r => r.source === 'local');
      expect(localArticles).toHaveLength(1);
      expect(localArticles[0].title).toBe('Local Doc Chunk 1'); // First occurrence wins
    });

    it('should keep all results when deduplicate option is false', async () => {
      // Setup same mocks as above
      const mockExaResults = {
        results: [
          {
            id: 'exa-1',
            score: 0.9,
            title: 'Same Article',
            url: 'https://example.com/article',
            text: 'Content from Exa',
          },
        ],
      };
      
      const mockLocalResults: VectorSearchResult[] = [
        {
          record: {
            id: 'local-1',
            recordType: 'chunk',
            mediaType: 'webpage',
            layer: 'lom',
            processingDepth: 'chunk',
            content: 'Local version of same article',
            createdAt: Date.now(),
            objectId: 'obj-1',
            title: 'same article',
            sourceUri: 'https://example.com/article',
          } as VectorRecord,
          score: 0.85,
          distance: 0.15,
        },
      ];
      
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockExaService.search as Mock).mockResolvedValue(mockExaResults);
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      
      // Test with deduplication disabled
      const results = await hybridSearchService.search('test query', {
        numResults: 10,
        deduplicate: false,
      });
      
      // Should have both versions
      expect(results).toHaveLength(2);
    });
  });
  
  describe('result ranking', () => {
    it('should rank results by weighted scores', async () => {
      // Mock Exa results with different scores
      const mockExaResults = {
        results: [
          {
            id: 'exa-1',
            score: 0.7,
            title: 'Exa Medium Score',
            url: 'https://example.com',
            text: 'Content',
          },
          {
            id: 'exa-2',
            score: 0.5,
            title: 'Exa Low Score',
            url: 'https://example.com/2',
            text: 'Content',
          },
        ],
      };
      
      // Mock local result with high score
      const mockLocalResults: VectorSearchResult[] = [
        {
          record: {
            id: 'local-1',
            recordType: 'chunk',
            mediaType: 'webpage',
            layer: 'lom',
            processingDepth: 'chunk',
            content: 'Content',
            createdAt: Date.now(),
            title: 'Local High Score',
            objectId: 'obj-local-1', // Add objectId
          } as VectorRecord,
          score: 0.9,
          distance: 0.1,
        },
      ];
      
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockExaService.search as Mock).mockResolvedValue(mockExaResults);
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      
      // Test with custom weights favoring Exa
      const results = await hybridSearchService.search('test query', {
        numResults: 3, // Request only 3 to match our test data
        localWeight: 0.3,
        exaWeight: 0.7,
        deduplicate: false, // Keep all to see ranking
      });
      
      // With weights applied:
      // Local: 0.9 * 0.3 = 0.27
      // Exa Medium: 0.7 * 0.7 = 0.49
      // Exa Low: 0.5 * 0.7 = 0.35
      // Verify results are ordered by weighted score
      expect(results).toHaveLength(3);
      expect(results[0].title).toBe('Exa Medium Score');
      expect(results[1].title).toBe('Exa Low Score');
      expect(results[2].title).toBe('Local High Score');
    });

    it('should favor local results with different weights', async () => {
      // Setup same mocks
      const mockExaResults = {
        results: [
          {
            id: 'exa-1',
            score: 0.8,
            title: 'Exa High Score',
            url: 'https://example.com',
            text: 'Content',
          },
        ],
      };
      
      const mockLocalResults: VectorSearchResult[] = [
        {
          record: {
            id: 'local-1',
            recordType: 'chunk',
            mediaType: 'webpage',
            layer: 'lom',
            processingDepth: 'chunk',
            content: 'Content',
            createdAt: Date.now(),
            title: 'Local Medium Score',
            objectId: 'obj-local-2',
          } as VectorRecord,
          score: 0.6,
          distance: 0.4,
        },
      ];
      
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockExaService.search as Mock).mockResolvedValue(mockExaResults);
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      
      // Test with custom weights favoring local
      const results = await hybridSearchService.search('test query', {
        numResults: 2, // Request only 2 to match our test data
        localWeight: 0.8,
        exaWeight: 0.2,
        deduplicate: false,
      });
      
      // With weights applied:
      // Local: 0.6 * 0.8 = 0.48
      // Exa: 0.8 * 0.2 = 0.16
      expect(results[0].title).toBe('Local Medium Score');
      expect(results[1].title).toBe('Exa High Score');
    });
  });

  describe('Constructor and BaseService integration', () => {
    it('should initialize with proper dependencies', () => {
      expect(hybridSearchService).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith('[HybridSearchService] Initialized with ExaService and vector model');
    });

    it('should inherit BaseService functionality', async () => {
      // Setup mocks for a simple search
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue([]);
      (mockExaService.isConfigured as Mock).mockReturnValue(false);
      
      // Test that execute wrapper works
      const results = await hybridSearchService.search('test query');
      
      // Should log the operation with execute wrapper format
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[HybridSearchService] search started')
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[HybridSearchService] search completed')
      );
    });
  });

  describe('Lifecycle methods', () => {
    it('should support initialize method', async () => {
      // Already called in beforeEach, create a new instance to test
      const newService = new HybridSearchService({
        exaService: mockExaService,
        vectorModel: mockVectorModel
      });
      await expect(newService.initialize()).resolves.toBeUndefined();
    });

    it('should support cleanup method', async () => {
      // HybridSearchService doesn't have resources to clean up, so it should be a no-op
      await expect(hybridSearchService.cleanup()).resolves.toBeUndefined();
    });

    it('should support health check', async () => {
      const isHealthy = await hybridSearchService.healthCheck();
      expect(isHealthy).toBe(true);
    });
  });

  describe('Error handling with BaseService', () => {
    it('should use execute wrapper for error handling', async () => {
      // Mock the vector model to throw an error
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockRejectedValue(new Error('Vector DB connection lost'));

      // When vector search fails but Exa is configured, search fails
      (mockExaService.isConfigured as Mock).mockReturnValue(false);
      const results = await hybridSearchService.search('test query');
      expect(results).toEqual([]); // Vector search failed and Exa not configured
      
      // Should log the vector search error
      expect(logger.error).toHaveBeenCalledWith(
        '[HybridSearchService] Local search with layers error:',
        expect.any(Error)
      );
    });

    it('should handle Exa service errors gracefully', async () => {
      // Setup vector model to work
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue([]);
      
      // Setup Exa to fail
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockExaService.search as Mock).mockRejectedValue(new Error('Exa API error'));
      
      // Should not throw, but return local results only
      const results = await hybridSearchService.search('test query');
      
      expect(results).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        '[HybridSearchService] Exa search failed:',
        expect.any(Error)
      );
    });
  });

  describe('Dependency injection patterns', () => {
    it('should work with mocked dependencies', async () => {
      // All dependencies are already mocked in beforeEach
      const mockLocalResults: VectorSearchResult[] = [
        {
          record: {
            id: 'mock-1',
            recordType: 'chunk',
            mediaType: 'webpage',
            layer: 'lom',
            processingDepth: 'chunk',
            content: 'Mock content',
            createdAt: Date.now(),
            objectId: 'obj-mock',
            sqlChunkId: 1,
            title: 'Mock Document',
          } as VectorRecord,
          score: 0.9,
          distance: 0.1,
        },
      ];
      
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      (mockExaService.isConfigured as Mock).mockReturnValue(false);
      
      const results = await hybridSearchService.search('mock query');
      
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Mock Document');
    });

    it('should allow testing without real services', async () => {
      // Create service with minimal mocks
      const stubExaService = {
        isConfigured: vi.fn().mockReturnValue(false),
        search: vi.fn(),
        initialize: vi.fn(),
        cleanup: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true)
      } as unknown as ExaService;
      
      const stubVectorModel = {
        isReady: vi.fn().mockReturnValue(false),
        querySimilarByText: vi.fn(),
        initialize: vi.fn(),
        cleanup: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true)
      } as unknown as IVectorStoreModel;
      
      const serviceWithStubs = new HybridSearchService({
        exaService: stubExaService,
        vectorModel: stubVectorModel
      });
      
      // Should return empty results when both services are not ready
      const results = await serviceWithStubs.search('test');
      expect(results).toEqual([]);
    });
  });

  describe('searchLocal with BaseService', () => {
    it('should handle local search through execute wrapper', async () => {
      const mockLocalResults: VectorSearchResult[] = [
        {
          record: {
            id: 'local-only-1',
            recordType: 'chunk',
            mediaType: 'webpage',
            layer: 'lom',
            processingDepth: 'chunk',
            content: 'Local only content',
            createdAt: Date.now(),
            objectId: 'obj-local',
            sqlChunkId: 1,
            title: 'Local Only Document',
          } as VectorRecord,
          score: 0.95,
          distance: 0.05,
        },
      ];
      
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      
      const results = await hybridSearchService.searchLocal('local query', 5);
      
      expect(mockVectorModel.querySimilarByText).toHaveBeenCalledWith('local query', { k: 5 });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Local Only Document');
      expect(results[0].source).toBe('local');
    });
  });

  describe('searchNews with BaseService', () => {
    it('should handle news search through execute wrapper', async () => {
      const mockNewsResults = {
        results: [
          {
            id: 'news-1',
            score: 0.9,
            title: 'Breaking News',
            url: 'https://news.example.com/article',
            text: 'News content',
            publishedDate: '2024-01-20',
          },
        ],
      };
      
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockExaService as any).searchNews = vi.fn().mockResolvedValue(mockNewsResults);
      
      const results = await hybridSearchService.searchNews('news query', { numResults: 5 });
      
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Breaking News');
      expect(results[0].source).toBe('exa');
    });
  });
});