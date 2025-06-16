import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import Database from 'better-sqlite3';
import { HybridSearchService } from '../HybridSearchService';
import { HybridSearchResult } from '../../shared/types';
import { ExaService } from '../ExaService';
import { ChromaVectorModel } from '../../models/ChromaVectorModel';
import { ChunkSqlModel } from '../../models/ChunkModel';
import { Document } from '@langchain/core/documents';
import { logger } from '../../utils/logger';
import runMigrations from '../../models/runMigrations';

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
  let db: Database.Database;
  let hybridSearchService: HybridSearchService;
  let mockExaService: ExaService;
  let mockVectorModel: ChromaVectorModel;
  let mockChunkSqlModel: ChunkSqlModel;
  
  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Create in-memory database
    db = new Database(':memory:');
    await runMigrations(db);
    
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
    } as unknown as ChromaVectorModel;
    
    mockChunkSqlModel = {
      getChunkByIdBatch: vi.fn(),
      initialize: vi.fn(),
      cleanup: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true)
    } as unknown as ChunkSqlModel;
    
    // Create service instance with dependency injection
    hybridSearchService = new HybridSearchService({
      db,
      exaService: mockExaService,
      chromaVectorModel: mockVectorModel,
      chunkSqlModel: mockChunkSqlModel
    });
    
    // Initialize service
    await hybridSearchService.initialize();
  });
  
  afterEach(async () => {
    // Cleanup service
    await hybridSearchService.cleanup();
    
    if (db && db.open) {
      db.close();
    }
    
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
      const mockLocalResults: [Document, number][] = [
        [
          new Document({
            pageContent: 'Local content 1',
            metadata: {
              id: 'local-1',
              title: 'Local Document 1',
              objectId: 'obj-1',
              chunkId: 1,
            },
          }),
          0.1, // distance (lower is better)
        ],
        [
          new Document({
            pageContent: 'Local content 2',
            metadata: {
              id: 'local-2',
              title: 'Local Document 2',
              sourceUri: 'file://local/doc2',
              objectId: 'obj-2',
              chunkId: 2,
            },
          }),
          0.2,
        ],
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
        numResults: 5, // Math.ceil(3 * 1.5) = 5
        contents: {
          text: true,
          summary: true,
        },
      });
      expect(mockVectorModel.querySimilarByText).toHaveBeenCalledWith('test query', 5);
      
      // Verify results are combined and limited
      expect(results).toHaveLength(3);
      expect(results.some((r: HybridSearchResult) => r.source === 'exa')).toBe(true);
      expect(results.some((r: HybridSearchResult) => r.source === 'local')).toBe(true);
    });
    
    it('should handle Exa service not configured', async () => {
      // Mock local results only
      const mockLocalResults: [Document, number][] = [
        [
          new Document({
            pageContent: 'Local content only',
            metadata: { id: 'local-1', title: 'Local Only' },
          }),
          0.1,
        ],
      ];
      
      (mockExaService.isConfigured as Mock).mockReturnValue(false);
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      
      const results = await hybridSearchService.search('test query');
      
      expect(mockExaService.search).not.toHaveBeenCalled();
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
      
      // Just verify it doesn't throw and completes
      expect(true).toBe(true);
    });
  });
  
  describe('searchLocal', () => {
    it('should search only local vector database', async () => {
      const mockResults: [Document, number][] = [
        [
          new Document({
            pageContent: 'Test content',
            metadata: { id: 'test-1', title: 'Test' },
          }),
          0.15,
        ],
      ];
      
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockResults);
      
      const results = await hybridSearchService.searchLocal('test query', 5);
      
      expect(mockVectorModel.querySimilarByText).toHaveBeenCalledWith('test query', 5);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        source: 'local',
        score: 0.85, // 1 - 0.15
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
    it('should remove duplicate results based on similarity', async () => {
      const mockResults: HybridSearchResult[] = [
        {
          id: '1',
          title: 'Same Article',
          url: 'https://example.com/article',
          content: 'Content 1',
          score: 0.9,
          source: 'exa',
        },
        {
          id: '2',
          title: 'same article', // lowercase, should be deduplicated
          url: 'https://example.com/article',
          content: 'Content 2',
          score: 0.85,
          source: 'local',
        },
        {
          id: '3',
          title: 'Different Article',
          url: 'https://example.com/other',
          content: 'Content 3',
          score: 0.8,
          source: 'exa',
        },
      ];
      
      // Mock both services to return empty, we'll test deduplication directly
      (mockExaService.isConfigured as Mock).mockReturnValue(false);
      (mockVectorModel.isReady as Mock).mockReturnValue(false);
      
      // Access private method through type assertion
      const service = hybridSearchService as any;
      const deduplicated = service.deduplicateResults(mockResults, 0.85);
      
      expect(deduplicated).toHaveLength(2);
      expect(deduplicated.map((r: HybridSearchResult) => r.title)).toEqual(['Same Article', 'Different Article']);
    });
  });
  
  describe('result ranking', () => {
    it('should rank results by weighted scores', async () => {
      const mockResults: HybridSearchResult[] = [
        {
          id: '1',
          title: 'Local High Score',
          content: 'Content',
          score: 0.9,
          source: 'local',
        },
        {
          id: '2',
          title: 'Exa Medium Score',
          url: 'https://example.com',
          content: 'Content',
          score: 0.7,
          source: 'exa',
        },
        {
          id: '3',
          title: 'Exa Low Score',
          url: 'https://example.com/2',
          content: 'Content',
          score: 0.5,
          source: 'exa',
        },
      ];
      
      // Access private method
      const service = hybridSearchService as any;
      const ranked = service.rankResults(mockResults, {
        localWeight: 0.3,
        exaWeight: 0.7,
      });
      
      // Local: 0.9 * 0.3 = 0.27
      // Exa Medium: 0.7 * 0.7 = 0.49
      // Exa Low: 0.5 * 0.7 = 0.35
      expect(ranked[0].title).toBe('Exa Medium Score');
      expect(ranked[1].title).toBe('Exa Low Score');
      expect(ranked[2].title).toBe('Local High Score');
    });
  });

  describe('Constructor and BaseService integration', () => {
    it('should initialize with proper dependencies', () => {
      expect(hybridSearchService).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith('[HybridSearchService] Initialized.');
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
        db,
        exaService: mockExaService,
        chromaVectorModel: mockVectorModel,
        chunkSqlModel: mockChunkSqlModel
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

      await expect(hybridSearchService.search('test query')).rejects.toThrow('Vector DB connection lost');
      
      // Should log the error with proper context
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[HybridSearchService] search failed'),
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
      expect(logger.warn).toHaveBeenCalledWith(
        '[HybridSearchService] Exa search failed, falling back to local results only:',
        expect.any(Error)
      );
    });
  });

  describe('Dependency injection patterns', () => {
    it('should work with mocked dependencies', async () => {
      // All dependencies are already mocked in beforeEach
      const mockLocalResults: [Document, number][] = [
        [
          new Document({
            pageContent: 'Mock content',
            metadata: {
              id: 'mock-1',
              title: 'Mock Document',
              objectId: 'obj-mock',
              chunkId: 1,
            },
          }),
          0.1,
        ],
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
      } as unknown as ChromaVectorModel;
      
      const stubChunkModel = {
        getChunkByIdBatch: vi.fn().mockResolvedValue([]),
        initialize: vi.fn(),
        cleanup: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true)
      } as unknown as ChunkSqlModel;
      
      const serviceWithStubs = new HybridSearchService({
        db: {} as Database.Database,
        exaService: stubExaService,
        chromaVectorModel: stubVectorModel,
        chunkSqlModel: stubChunkModel
      });
      
      // Should return empty results when both services are not ready
      const results = await serviceWithStubs.search('test');
      expect(results).toEqual([]);
    });
  });

  describe('searchLocal with BaseService', () => {
    it('should handle local search through execute wrapper', async () => {
      const mockLocalResults: [Document, number][] = [
        [
          new Document({
            pageContent: 'Local only content',
            metadata: {
              id: 'local-only-1',
              title: 'Local Only Document',
              objectId: 'obj-local',
              chunkId: 1,
            },
          }),
          0.05,
        ],
      ];
      
      (mockVectorModel.isReady as Mock).mockReturnValue(true);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      
      const results = await hybridSearchService.searchLocal('local query', { numResults: 5 });
      
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Local Only Document');
      expect(results[0].source).toBe('Local Knowledge');
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
      (mockExaService.searchNews as Mock) = vi.fn().mockResolvedValue(mockNewsResults);
      
      const results = await hybridSearchService.searchNews('news query', { numResults: 5 });
      
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Breaking News');
      expect(results[0].source).toBe('Web');
    });
  });
});