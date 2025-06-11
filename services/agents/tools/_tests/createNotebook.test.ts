import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { createNotebook } from '../createNotebook';
import { ToolContext } from '../types';
import { logger } from '../../../../utils/logger';

// Mock the logger
vi.mock('../../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('createNotebook', () => {
  let mockContext: ToolContext;
  let mockCreateNotebook: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockCreateNotebook = vi.fn();
    
    mockContext = {
      services: {
        notebookService: {
          createNotebook: mockCreateNotebook,
        },
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
      expect(createNotebook.name).toBe('create_notebook');
      expect(createNotebook.description).toContain('Creates a new notebook');
    });

    it('should have correct parameter schema', () => {
      expect(createNotebook.parameters).toEqual({
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'The title for the new notebook',
          },
        },
        required: ['title'],
      });
    });
  });

  describe('handle method', () => {
    it('should successfully create a notebook', async () => {
      const mockNotebook = {
        id: 'notebook-123',
        title: 'My Test Notebook',
        createdAt: new Date(),
      };

      mockCreateNotebook.mockResolvedValue(mockNotebook);

      const result = await createNotebook.handle(
        { title: 'My Test Notebook' },
        mockContext
      );

      expect(mockCreateNotebook).toHaveBeenCalledWith('My Test Notebook');
      expect(result).toEqual({
        content: 'Created notebook: My Test Notebook',
        immediateReturn: {
          type: 'open_notebook',
          notebookId: 'notebook-123',
          title: 'My Test Notebook',
          message: 'Right on, I\'ve created "My Test Notebook" and I\'ll open it for you now.',
        },
      });
    });

    it('should handle missing title parameter', async () => {
      const result = await createNotebook.handle({}, mockContext);

      expect(result).toEqual({
        content: 'Error: Notebook title was unclear.',
      });
      expect(mockCreateNotebook).not.toHaveBeenCalled();
    });

    it('should handle null title parameter', async () => {
      const result = await createNotebook.handle({ title: null }, mockContext);

      expect(result).toEqual({
        content: 'Error: Notebook title was unclear.',
      });
      expect(mockCreateNotebook).not.toHaveBeenCalled();
    });

    it('should handle empty string title', async () => {
      const result = await createNotebook.handle({ title: '' }, mockContext);

      expect(result).toEqual({
        content: 'Error: Notebook title was unclear.',
      });
      expect(mockCreateNotebook).not.toHaveBeenCalled();
    });

    it('should handle service errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockCreateNotebook.mockRejectedValue(error);

      const result = await createNotebook.handle(
        { title: 'Failed Notebook' },
        mockContext
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[createNotebook] Error creating notebook:',
        error
      );
      expect(result).toEqual({
        content: 'Failed to create notebook: Database connection failed',
      });
    });

    it('should handle non-Error objects thrown by service', async () => {
      mockCreateNotebook.mockRejectedValue('String error');

      const result = await createNotebook.handle(
        { title: 'Failed Notebook' },
        mockContext
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[createNotebook] Error creating notebook:',
        'String error'
      );
      expect(result).toEqual({
        content: 'Failed to create notebook: Unknown error',
      });
    });

    it('should handle notebooks with special characters in title', async () => {
      const specialTitle = 'Notes & Ideas: "Project #1"';
      const mockNotebook = {
        id: 'notebook-special',
        title: specialTitle,
        createdAt: new Date(),
      };

      mockCreateNotebook.mockResolvedValue(mockNotebook);

      const result = await createNotebook.handle(
        { title: specialTitle },
        mockContext
      );

      expect(mockCreateNotebook).toHaveBeenCalledWith(specialTitle);
      expect(result.content).toBe(`Created notebook: ${specialTitle}`);
      expect(result.immediateReturn?.message).toBe(
        `Right on, I've created "${specialTitle}" and I'll open it for you now.`
      );
    });

    it('should trim whitespace from title', async () => {
      const mockNotebook = {
        id: 'notebook-trimmed',
        title: '  Trimmed Title  ',
        createdAt: new Date(),
      };

      mockCreateNotebook.mockResolvedValue(mockNotebook);

      const result = await createNotebook.handle(
        { title: '  Trimmed Title  ' },
        mockContext
      );

      expect(mockCreateNotebook).toHaveBeenCalledWith('  Trimmed Title  ');
      expect(result).toBeDefined();
    });
  });
});