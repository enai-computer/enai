import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { ExaSearchTool } from './ExaSearchTool';
import { ExaService } from '../../ExaService';
import { HybridSearchService, HybridSearchResult } from '../../HybridSearchService';

// Mock the dependencies
vi.mock('../../ExaService');
vi.mock('../../HybridSearchService');

describe('ExaSearchTool', () => {
  let exaSearchTool: ExaSearchTool;
  let mockExaService: ExaService;
  let mockHybridSearchService: HybridSearchService;
  
  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Create mock instances
    mockExaService = new ExaService();
    mockHybridSearchService = new HybridSearchService(mockExaService, {} as any);
    
    // Create tool instance
    exaSearchTool = new ExaSearchTool(mockExaService, mockHybridSearchService);
  });
  
  describe('tool properties', () => {
    it('should have correct name and description', () => {
      expect(exaSearchTool.name).toBe('exa_search');
      expect(exaSearchTool.description).toContain('Exa.ai\'s neural search');
    });
  });
  
  describe('_call method', () => {
    it('should perform hybrid search by default', async () => {
      const mockResults: HybridSearchResult[] = [
        {
          id: '1',
          title: 'Test Result 1',
          url: 'https://example.com/1',
          content: 'This is test content from the web',
          score: 0.95,
          source: 'exa',
          publishedDate: '2024-01-15',
          author: 'Test Author',
        },
        {
          id: '2',
          title: 'Local Document',
          content: 'This is local content',
          score: 0.85,
          source: 'local',
          objectId: 'obj-123',
          chunkId: 5,
        },
      ];
      
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockHybridSearchService.search as Mock).mockResolvedValue(mockResults);
      
      const result = await exaSearchTool._call({
        query: 'test query',
        useHybrid: true,
        numResults: 5,
        type: 'neural',
      });
      
      expect(mockHybridSearchService.search).toHaveBeenCalledWith('test query', {
        numResults: 5,
        type: 'neural',
      });
      
      // Check formatted output
      expect(result).toContain('Found 2 search results');
      expect(result).toContain('Test Result 1');
      expect(result).toContain('Source: Web');
      expect(result).toContain('Published: 2024-01-15');
      expect(result).toContain('Author: Test Author');
      expect(result).toContain('Local Document');
      expect(result).toContain('Source: Local Knowledge');
    });
    
    it('should perform Exa-only search when useHybrid is false', async () => {
      const mockExaResponse = {
        results: [
          {
            id: 'exa-1',
            title: 'Exa Only Result',
            url: 'https://example.com',
            text: 'Full text content from Exa',
            summary: 'Summary of content',
            score: 0.9,
          },
        ],
      };
      
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockExaService.search as Mock).mockResolvedValue(mockExaResponse);
      
      const result = await exaSearchTool._call({
        query: 'test query',
        useHybrid: false,
        numResults: 3,
        type: 'keyword',
      });
      
      expect(mockExaService.search).toHaveBeenCalledWith('test query', {
        numResults: 3,
        type: 'keyword',
        contents: {
          text: true,
          summary: true,
        },
      });
      expect(mockHybridSearchService.search).not.toHaveBeenCalled();
      
      expect(result).toContain('Exa Only Result');
      expect(result).toContain('Full text content from Exa');
    });
    
    it('should fall back to local search when Exa is not configured', async () => {
      const mockLocalResults: HybridSearchResult[] = [
        {
          id: 'local-1',
          title: 'Local Only Result',
          content: 'Local content',
          score: 0.8,
          source: 'local',
        },
      ];
      
      (mockExaService.isConfigured as Mock).mockReturnValue(false);
      (mockHybridSearchService.searchLocal as Mock).mockResolvedValue(mockLocalResults);
      
      const result = await exaSearchTool._call({
        query: 'test query',
        useHybrid: true,
        numResults: 5,
        type: 'neural',
      });
      
      expect(mockHybridSearchService.searchLocal).toHaveBeenCalledWith('test query', 5);
      expect(mockHybridSearchService.search).not.toHaveBeenCalled();
      
      expect(result).toContain('Local Only Result');
    });
    
    it('should handle empty results', async () => {
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockHybridSearchService.search as Mock).mockResolvedValue([]);
      
      const result = await exaSearchTool._call({
        query: 'no results query',
        useHybrid: true,
        numResults: 5,
        type: 'neural',
      });
      
      expect(result).toBe('No search results found.');
    });
    
    it('should truncate long content', async () => {
      const longContent = 'x'.repeat(600);
      const mockResults: HybridSearchResult[] = [
        {
          id: '1',
          title: 'Long Content Result',
          content: longContent,
          score: 0.9,
          source: 'exa',
        },
      ];
      
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockHybridSearchService.search as Mock).mockResolvedValue(mockResults);
      
      const result = await exaSearchTool._call({
        query: 'test',
        useHybrid: true,
        numResults: 5,
        type: 'neural',
      });
      
      // Should truncate to 500 chars + '...'
      expect(result).toContain('x'.repeat(500) + '...');
      expect(result).not.toContain('x'.repeat(501));
    });
    
    it('should handle errors gracefully', async () => {
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockHybridSearchService.search as Mock).mockRejectedValue(new Error('Search failed'));
      
      await expect(exaSearchTool._call({
        query: 'error query',
        useHybrid: true,
        numResults: 5,
        type: 'neural',
      })).rejects.toThrow('Search failed: Search failed');
    });
    
    it('should format results with proper indexing and separators', async () => {
      const mockResults: HybridSearchResult[] = [
        {
          id: '1',
          title: 'First Result',
          url: 'https://first.com',
          content: 'First content',
          score: 0.95,
          source: 'exa',
        },
        {
          id: '2',
          title: 'Second Result',
          content: 'Second content',
          score: 0.85,
          source: 'local',
        },
        {
          id: '3',
          title: 'Third Result',
          url: 'https://third.com',
          content: 'Third content',
          score: 0.75,
          source: 'exa',
        },
      ];
      
      (mockExaService.isConfigured as Mock).mockReturnValue(true);
      (mockHybridSearchService.search as Mock).mockResolvedValue(mockResults);
      
      const result = await exaSearchTool._call({
        query: 'test',
        useHybrid: true,
        numResults: 5,
        type: 'neural',
      });
      
      // Check proper indexing
      expect(result).toContain('[1] First Result');
      expect(result).toContain('[2] Second Result');
      expect(result).toContain('[3] Third Result');
      
      // Check separators
      const separatorCount = (result.match(/---/g) || []).length;
      expect(separatorCount).toBe(2); // Two separators for three results
      
      // Check scores are formatted to 3 decimal places
      expect(result).toContain('Score: 0.950');
      expect(result).toContain('Score: 0.850');
      expect(result).toContain('Score: 0.750');
    });
  });
});