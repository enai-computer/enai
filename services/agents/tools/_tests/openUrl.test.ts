import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openUrl } from '../openUrl';
import { ToolContext } from '../types';

describe('openUrl', () => {
  let mockContext: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockContext = {
      services: {
        notebookService: {},
        hybridSearchService: {},
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
      expect(openUrl.name).toBe('open_url');
      expect(openUrl.description).toContain('Opens a URL in the WebLayer browser');
    });

    it('should have correct parameter schema', () => {
      expect(openUrl.parameters).toEqual({
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to open in the browser. Protocol (https://) will be added automatically if missing',
          },
        },
        required: ['url'],
      });
    });
  });

  describe('handle method', () => {
    it('should successfully open a URL with protocol', async () => {
      const result = await openUrl.handle(
        { url: 'https://example.com' },
        mockContext
      );

      expect(result).toEqual({
        content: 'Opened URL: https://example.com',
        immediateReturn: {
          type: 'open_url',
          url: 'https://example.com',
          message: 'Right on, I\'ll open that for you.',
        },
      });
    });

    it('should add https:// protocol if missing', async () => {
      const result = await openUrl.handle(
        { url: 'example.com' },
        mockContext
      );

      expect(result).toEqual({
        content: 'Opened URL: https://example.com',
        immediateReturn: {
          type: 'open_url',
          url: 'https://example.com',
          message: 'Right on, I\'ll open that for you.',
        },
      });
    });

    it('should preserve http:// protocol', async () => {
      const result = await openUrl.handle(
        { url: 'http://example.com' },
        mockContext
      );

      expect(result).toEqual({
        content: 'Opened URL: http://example.com',
        immediateReturn: {
          type: 'open_url',
          url: 'http://example.com',
          message: 'Right on, I\'ll open that for you.',
        },
      });
    });

    it('should handle URLs with paths and query parameters', async () => {
      const complexUrl = 'example.com/path/to/page?query=value&param=123#section';
      const result = await openUrl.handle(
        { url: complexUrl },
        mockContext
      );

      expect(result.immediateReturn?.url).toBe(`https://${complexUrl}`);
      expect(result.content).toBe(`Opened URL: https://${complexUrl}`);
    });

    it('should handle missing url parameter', async () => {
      const result = await openUrl.handle({}, mockContext);

      expect(result).toEqual({
        content: 'Error: URL was unclear.',
      });
    });

    it('should handle null url parameter', async () => {
      const result = await openUrl.handle({ url: null }, mockContext);

      expect(result).toEqual({
        content: 'Error: URL was unclear.',
      });
    });

    it('should handle empty string url', async () => {
      const result = await openUrl.handle({ url: '' }, mockContext);

      expect(result).toEqual({
        content: 'Error: URL was unclear.',
      });
    });

    it('should handle URLs with special characters', async () => {
      const specialUrl = 'example.com/search?q=hello%20world&filter=a%3Db';
      const result = await openUrl.handle(
        { url: specialUrl },
        mockContext
      );

      expect(result.immediateReturn?.url).toBe(`https://${specialUrl}`);
    });

    it('should handle international domain names', async () => {
      const idnUrl = 'münchen.de';
      const result = await openUrl.handle(
        { url: idnUrl },
        mockContext
      );

      expect(result.immediateReturn?.url).toBe(`https://${idnUrl}`);
    });

    it('should handle URLs with port numbers', async () => {
      const portUrl = 'localhost:3000/api';
      const result = await openUrl.handle(
        { url: portUrl },
        mockContext
      );

      expect(result.immediateReturn?.url).toBe(`https://${portUrl}`);
    });

    it('should preserve https:// in URLs', async () => {
      const secureUrl = 'https://secure.example.com';
      const result = await openUrl.handle(
        { url: secureUrl },
        mockContext
      );

      expect(result.immediateReturn?.url).toBe(secureUrl);
    });

    it('should handle file:// protocol URLs', async () => {
      const fileUrl = 'file:///Users/test/document.html';
      const result = await openUrl.handle(
        { url: fileUrl },
        mockContext
      );

      expect(result.immediateReturn?.url).toBe(fileUrl);
    });

    it('should handle ftp:// protocol URLs', async () => {
      const ftpUrl = 'ftp://ftp.example.com/files';
      const result = await openUrl.handle(
        { url: ftpUrl },
        mockContext
      );

      expect(result.immediateReturn?.url).toBe(ftpUrl);
    });

    it('should handle URLs with authentication', async () => {
      const authUrl = 'https://user:pass@example.com';
      const result = await openUrl.handle(
        { url: authUrl },
        mockContext
      );

      expect(result.immediateReturn?.url).toBe(authUrl);
    });

    it('should handle URLs with only spaces', async () => {
      const result = await openUrl.handle(
        { url: '   ' },
        mockContext
      );

      expect(result.immediateReturn?.url).toBe('https://   ');
    });
  });
});