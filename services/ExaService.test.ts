import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExaService } from './ExaService';

// Mock the global fetch
global.fetch = vi.fn();

describe('ExaService', () => {
  let exaService: ExaService;
  const mockApiKey = 'test-api-key';
  
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    
    // Mock environment variable
    process.env.EXA_API_KEY = mockApiKey;
    
    // Create new instance for each test
    exaService = new ExaService();
  });
  
  afterEach(() => {
    // Clean up environment
    delete process.env.EXA_API_KEY;
  });
  
  describe('constructor and configuration', () => {
    it('should initialize with API key from environment', () => {
      expect(exaService.isConfigured()).toBe(true);
    });
    
    it('should handle missing API key gracefully', () => {
      delete process.env.EXA_API_KEY;
      const serviceWithoutKey = new ExaService();
      expect(serviceWithoutKey.isConfigured()).toBe(false);
    });
  });
  
  describe('search', () => {
    it('should perform a search with default options', async () => {
      const mockResponse = {
        results: [
          {
            id: 'result-1',
            score: 0.95,
            title: 'Test Result',
            url: 'https://example.com',
            text: 'Test content',
          },
        ],
        autopromptString: 'Enhanced query',
      };
      
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });
      
      const result = await exaService.search('test query');
      
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.exa.ai/search',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': mockApiKey,
          },
          body: JSON.stringify({
            query: 'test query',
            numResults: 10,
            type: 'neural',
            useAutoprompt: true,
          }),
        }
      );
      
      expect(result).toEqual(mockResponse);
    });
    
    it('should handle custom search options', async () => {
      const mockResponse = { results: [] };
      
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });
      
      await exaService.search('test query', {
        numResults: 5,
        type: 'keyword',
        useAutoprompt: false,
        includeDomains: ['example.com'],
        contents: {
          text: true,
          summary: true,
        },
      });
      
      const callArgs = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callArgs).toMatchObject({
        query: 'test query',
        numResults: 5,
        type: 'keyword',
        useAutoprompt: false,
        includeDomains: ['example.com'],
        contents: {
          text: true,
          summary: true,
        },
      });
    });
    
    it('should throw error when API key is missing', async () => {
      delete process.env.EXA_API_KEY;
      const serviceWithoutKey = new ExaService();
      
      await expect(serviceWithoutKey.search('test')).rejects.toThrow(
        'ExaService is not configured. Missing EXA_API_KEY.'
      );
    });
    
    it('should handle API errors gracefully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid API key',
      });
      
      await expect(exaService.search('test')).rejects.toThrow('Exa API Error: Unauthorized');
    });
    
    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));
      
      await expect(exaService.search('test')).rejects.toThrow('Network error');
    });
  });
  
  describe('getContents', () => {
    it('should retrieve contents for given IDs', async () => {
      const mockResponse = {
        results: [
          {
            id: 'result-1',
            title: 'Content Title',
            url: 'https://example.com',
            text: 'Full content text',
          },
        ],
      };
      
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });
      
      const result = await exaService.getContents(['result-1'], {
        text: true,
        summary: false,
      });
      
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.exa.ai/contents',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': mockApiKey,
          },
          body: JSON.stringify({
            ids: ['result-1'],
            text: true,
            highlights: false,
            summary: false,
          }),
        }
      );
      
      expect(result).toEqual(mockResponse);
    });
    
    it('should handle empty IDs array', async () => {
      const result = await exaService.getContents([]);
      
      expect(global.fetch).not.toHaveBeenCalled();
      expect(result).toEqual({ results: [] });
    });
    
    it('should use default options when not specified', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });
      
      await exaService.getContents(['id-1']);
      
      const callArgs = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callArgs).toMatchObject({
        ids: ['id-1'],
        text: true,
        highlights: false,
        summary: false,
      });
    });
  });
  
  describe('findSimilar', () => {
    it('should find similar content for a given URL', async () => {
      const mockResponse = {
        results: [
          {
            id: 'similar-1',
            score: 0.85,
            title: 'Similar Article',
            url: 'https://similar.com',
          },
        ],
      };
      
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });
      
      const result = await exaService.findSimilar({
        url: 'https://example.com/article',
        numResults: 5,
      });
      
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.exa.ai/findSimilar',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': mockApiKey,
          },
          body: JSON.stringify({
            url: 'https://example.com/article',
            excludeSourceDomain: true,
            numResults: 5,
          }),
        }
      );
      
      expect(result).toEqual(mockResponse);
    });
    
    it('should allow including source domain', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });
      
      await exaService.findSimilar({
        url: 'https://example.com',
        excludeSourceDomain: false,
      });
      
      const callArgs = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callArgs.excludeSourceDomain).toBe(false);
    });
  });
});