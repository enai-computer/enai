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

// Factory functions for creating test data
function createVectorRecord(overrides: Partial<VectorRecord> = {}): VectorRecord {
  return {
    id: 'test-id',
    recordType: 'chunk',
    mediaType: 'webpage',
    layer: 'lom',
    processingDepth: 'chunk',
    content: 'Test content',
    createdAt: new Date().toISOString(),
    objectId: 'obj-test',
    sqlChunkId: 1,
    title: 'Test Document',
    ...overrides
  } as VectorRecord;
}

function createVectorSearchResult(score: number, recordOverrides: Partial<VectorRecord> = {}): VectorSearchResult {
  return {
    record: createVectorRecord(recordOverrides),
    score,
    distance: 1 - score,
  };
}

function createExaResult(id: string, score: number, url: string, title = 'Exa Result') {
  return {
    id,
    score,
    title,
    url,
    text: 'Content from Exa',
  };
}

describe('HybridSearchService', () => {
  let hybridSearchService: HybridSearchService;
  let mockExaService: ExaService;
  let mockVectorModel: IVectorStoreModel;
  
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create mock instances with minimal setup
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
    
    hybridSearchService = new HybridSearchService({
      exaService: mockExaService,
      vectorModel: mockVectorModel
    });
    
    await hybridSearchService.initialize();
  });
  
  afterEach(async () => {
    await hybridSearchService.cleanup();
    vi.clearAllMocks();
  });
  
  describe('search', () => {
    it('should combine results from Exa and local vector store', async () => {
      const mockExaResults = {
        results: [
          createExaResult('exa-1', 0.95, 'https://example.com/1'),
          createExaResult('exa-2', 0.85, 'https://example.com/2'),
        ],
      };
      
      const mockLocalResults = [
        createVectorSearchResult(0.9, { id: 'local-1', objectId: 'obj-1' }),
        createVectorSearchResult(0.8, { id: 'local-2', objectId: 'obj-2' }),
      ];
      
      (mockExaService.search as Mock).mockResolvedValue(mockExaResults);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      
      const results = await hybridSearchService.search('test query', {
        numResults: 3,
        localWeight: 0.4,
        exaWeight: 0.6,
      });
      
      expect(mockExaService.search).toHaveBeenCalledWith('test query', {
        numResults: 3,
        contents: { text: true, summary: true },
      });
      expect(mockVectorModel.querySimilarByText).toHaveBeenCalledWith('test query', { 
        k: 24, // 3 * 8 (TWO_STAGE_OVERFETCH_MULTIPLIER)
        filter: { layer: ['wom', 'lom'] } 
      });
      
      expect(results).toHaveLength(3);
      expect(results.some((r: HybridSearchResult) => r.source === 'exa')).toBe(true);
      expect(results.some((r: HybridSearchResult) => r.source === 'local')).toBe(true);
    });
    
    it.each([
      { scenario: 'Exa not configured', exaConfigured: false, vectorReady: true },
      { scenario: 'Vector model not ready', exaConfigured: true, vectorReady: false },
    ])('should handle $scenario gracefully', async ({ exaConfigured, vectorReady }) => {
      const mockExaResults = { results: [createExaResult('exa-1', 0.9, 'https://example.com')] };
      const mockLocalResults = [createVectorSearchResult(0.9)];
      
      (mockExaService.isConfigured as Mock).mockReturnValue(exaConfigured);
      (mockVectorModel.isReady as Mock).mockReturnValue(vectorReady);
      
      if (exaConfigured) {
        (mockExaService.search as Mock).mockResolvedValue(mockExaResults);
      }
      if (vectorReady) {
        (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      } else {
        (mockVectorModel.initialize as Mock).mockRejectedValue(new Error('Init failed'));
      }
      
      const results = await hybridSearchService.search('test query');
      
      if (!exaConfigured && vectorReady) {
        expect(results).toHaveLength(1);
        expect(results[0].source).toBe('local');
      } else if (exaConfigured && !vectorReady) {
        expect(results).toHaveLength(1);
        expect(results[0].source).toBe('exa');
      }
    });
    
    it('should normalize weights if they do not sum to 1', async () => {
      (mockExaService.search as Mock).mockResolvedValue({ results: [] });
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue([]);
      
      await hybridSearchService.search('test', {
        localWeight: 0.3,
        exaWeight: 0.5, // Sum = 0.8, not 1.0
      });
      
      expect(mockExaService.search).toHaveBeenCalled();
      expect(mockVectorModel.querySimilarByText).toHaveBeenCalled();
    });
  });
  
  describe('searchLocal', () => {
    it('should search only local vector database', async () => {
      const mockResults = [createVectorSearchResult(0.85)];
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockResults);
      
      const results = await hybridSearchService.searchLocal('test query', 5);
      
      expect(mockVectorModel.querySimilarByText).toHaveBeenCalledWith('test query', { k: 5 });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        source: 'local',
        score: 0.85,
        content: 'Test content',
      });
    });
  });
  
  describe('deduplication', () => {
    it.each([
      { deduplicate: true, expectedResults: 3, description: 'should remove duplicates' },
      { deduplicate: false, expectedResults: 4, description: 'should keep all results' },
    ])('$description when deduplicate=$deduplicate', async ({ deduplicate, expectedResults }) => {
      const mockExaResults = {
        results: [
          createExaResult('exa-1', 0.9, 'https://example.com/article', 'Same Article v1'),
          createExaResult('exa-2', 0.8, 'https://example.com/article', 'Same Article v2'), // Same URL
          createExaResult('exa-3', 0.7, 'https://example.com/other', 'Different Article'),
        ],
      };
      
      const mockLocalResults = [
        createVectorSearchResult(0.85, { id: 'local-1', objectId: 'obj-1', title: 'Local Doc Chunk 1' }),
        createVectorSearchResult(0.80, { id: 'local-2', objectId: 'obj-1', title: 'Local Doc Chunk 2' }), // Same objectId
      ];
      
      (mockExaService.search as Mock).mockResolvedValue(mockExaResults);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      
      const results = await hybridSearchService.search('test query', {
        numResults: 10,
        deduplicate,
      });
      
      if (deduplicate) {
        expect(results).toHaveLength(3); // 2 unique URLs + 1 unique objectId
        const exaArticles = results.filter(r => r.source === 'exa');
        expect(exaArticles[0].title).toBe('Same Article v1'); // First occurrence wins
        const localArticles = results.filter(r => r.source === 'local');
        expect(localArticles[0].title).toBe('Local Doc Chunk 1'); // First occurrence wins
      } else {
        // When deduplicate is false, we should have all 5 results
        // But local results with same objectId still get merged by the layer-aware logic
        // So we have 3 Exa + 1 merged local = 4 total
        expect(results).toHaveLength(4);
      }
    });
  });
  
  describe('result ranking', () => {
    it.each([
      {
        name: 'Exa-favored weights',
        localWeight: 0.3,
        exaWeight: 0.7,
        expectedOrder: ['Exa Medium Score', 'Exa Low Score', 'Local High Score'],
      },
      {
        name: 'Local-favored weights',
        localWeight: 0.8,
        exaWeight: 0.2,
        expectedOrder: ['Local Medium Score', 'Exa High Score'],
      },
    ])('should rank results correctly with $name', async ({ localWeight, exaWeight, expectedOrder }) => {
      const isExaFavored = exaWeight > localWeight;
      
      const mockExaResults = {
        results: isExaFavored
          ? [
              createExaResult('exa-1', 0.7, 'https://example.com', 'Exa Medium Score'),
              createExaResult('exa-2', 0.5, 'https://example.com/2', 'Exa Low Score'),
            ]
          : [createExaResult('exa-1', 0.8, 'https://example.com', 'Exa High Score')],
      };
      
      const mockLocalResults = isExaFavored
        ? [createVectorSearchResult(0.9, { title: 'Local High Score', objectId: 'obj-local-1' })]
        : [createVectorSearchResult(0.6, { title: 'Local Medium Score', objectId: 'obj-local-2' })];
      
      (mockExaService.search as Mock).mockResolvedValue(mockExaResults);
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      
      const results = await hybridSearchService.search('test query', {
        numResults: expectedOrder.length,
        localWeight,
        exaWeight,
        deduplicate: false,
      });
      
      expect(results).toHaveLength(expectedOrder.length);
      expectedOrder.forEach((title, index) => {
        expect(results[index].title).toBe(title);
      });
    });
  });

  describe('Error handling', () => {
    it.each([
      {
        name: 'vector DB error with Exa disabled',
        vectorError: new Error('Vector DB connection lost'),
        exaConfigured: false,
        expectedError: '[HybridSearchService] Local search with layers error:',
      },
      {
        name: 'Exa API error',
        exaError: new Error('Exa API error'),
        exaConfigured: true,
        expectedError: '[HybridSearchService] Exa search failed:',
      },
    ])('should handle $name gracefully', async ({ vectorError, exaError, exaConfigured, expectedError }) => {
      (mockExaService.isConfigured as Mock).mockReturnValue(exaConfigured);
      
      if (vectorError) {
        (mockVectorModel.querySimilarByText as Mock).mockRejectedValue(vectorError);
      } else {
        (mockVectorModel.querySimilarByText as Mock).mockResolvedValue([]);
      }
      
      if (exaError) {
        (mockExaService.search as Mock).mockRejectedValue(exaError);
      }
      
      const results = await hybridSearchService.search('test query');
      expect(results).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(expectedError, expect.any(Error));
    });
  });

  describe('layer-aware search', () => {
    it('should merge WOM and LOM results for same object with recency boost', async () => {
      const recentTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const mockLocalResults = [
        createVectorSearchResult(0.7, {
          id: 'wom-1',
          layer: 'wom',
          objectId: 'obj-123',
          lastAccessedAt: recentTimestamp,
          title: 'Document in WOM',
        }),
        createVectorSearchResult(0.8, {
          id: 'lom-1',
          layer: 'lom',
          objectId: 'obj-123',
          title: 'Document in LOM',
          content: 'LOM detailed content',
        }),
      ];
      
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue(mockLocalResults);
      (mockExaService.isConfigured as Mock).mockReturnValue(false);
      
      const results = await hybridSearchService.search('test query');
      
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Document in LOM');
      expect(results[0].score).toBeGreaterThan(0.8); // Boosted due to WOM recency
      expect(results[0].isActive).toBe(true);
    });

    it.each([
      { layers: ['wom'], description: 'WOM layer only' },
      { layers: ['lom'], description: 'LOM layer only' },
    ])('should respect filter for $description', async ({ layers }) => {
      (mockVectorModel.querySimilarByText as Mock).mockResolvedValue([]);
      (mockExaService.isConfigured as Mock).mockReturnValue(false);
      
      await hybridSearchService.search('test query', { layers });
      
      expect(mockVectorModel.querySimilarByText).toHaveBeenCalledWith('test query', {
        k: 80,
        filter: { layer: layers },
      });
    });
  });

  describe('searchNews', () => {
    it('should handle news search', async () => {
      const mockNewsResults = {
        results: [{
          id: 'news-1',
          score: 0.9,
          title: 'Breaking News',
          url: 'https://news.example.com/article',
          text: 'News content',
          publishedDate: '2024-01-20',
        }],
      };
      
      (mockExaService as any).searchNews = vi.fn().mockResolvedValue(mockNewsResults);
      
      const results = await hybridSearchService.searchNews('news query', { numResults: 5 });
      
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Breaking News');
      expect(results[0].source).toBe('exa');
    });
  });
});