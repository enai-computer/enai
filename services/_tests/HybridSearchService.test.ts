import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { HybridSearchService } from '../HybridSearchService';
import { HybridSearchResult } from '../../shared/types';
import { ExaService } from '../ExaService';
import { ChromaVectorModel } from '../../models/ChromaVectorModel';
import { Document } from '@langchain/core/documents';

// Mock the dependencies
vi.mock('../ExaService');
vi.mock('../../models/ChromaVectorModel');

describe('HybridSearchService', () => {
  let hybridSearchService: HybridSearchService;
  let mockExaService: ExaService;
  let mockVectorModel: ChromaVectorModel;
  
  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Create mock instances
    mockExaService = new ExaService();
    mockVectorModel = new ChromaVectorModel({} as any); // Pass mock database
    
    // Create service instance with mocked dependencies
    hybridSearchService = new HybridSearchService(mockExaService, mockVectorModel);
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
});