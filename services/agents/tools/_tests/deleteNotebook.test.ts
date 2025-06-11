import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { deleteNotebook } from '../deleteNotebook';
import { ToolContext } from '../types';
import { logger } from '../../../../utils/logger';

// Mock the logger
vi.mock('../../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('deleteNotebook', () => {
  let mockContext: ToolContext;
  let mockGetAllRegularNotebooks: Mock;
  let mockDeleteNotebook: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockGetAllRegularNotebooks = vi.fn();
    mockDeleteNotebook = vi.fn();
    
    mockContext = {
      services: {
        notebookService: {
          getAllRegularNotebooks: mockGetAllRegularNotebooks,
          deleteNotebook: mockDeleteNotebook,
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
      expect(deleteNotebook.name).toBe('delete_notebook');
      expect(deleteNotebook.description).toContain('Deletes an existing notebook');
      expect(deleteNotebook.description).toContain('Always confirm the notebook name');
    });

    it('should have correct parameter schema', () => {
      expect(deleteNotebook.parameters).toEqual({
        type: 'object',
        properties: {
          notebook_name: {
            type: 'string',
            description: 'The exact name or title of the notebook to delete',
          },
        },
        required: ['notebook_name'],
      });
    });
  });

  describe('handle method', () => {
    const mockNotebooks = [
      { id: 'nb-1', title: 'My First Notebook' },
      { id: 'nb-2', title: 'Project Notes' },
      { id: 'nb-3', title: 'Meeting Minutes' },
    ];

    it('should successfully delete a notebook', async () => {
      mockGetAllRegularNotebooks.mockResolvedValue(mockNotebooks);
      mockDeleteNotebook.mockResolvedValue(undefined);

      const result = await deleteNotebook.handle(
        { notebook_name: 'Project Notes' },
        mockContext
      );

      expect(mockGetAllRegularNotebooks).toHaveBeenCalled();
      expect(mockDeleteNotebook).toHaveBeenCalledWith('nb-2');
      expect(logger.info).toHaveBeenCalledWith(
        '[deleteNotebook] Deleted notebook "Project Notes" (ID: nb-2)'
      );
      expect(result).toEqual({
        content: 'Deleted notebook: Project Notes',
        immediateReturn: {
          type: 'chat_reply',
          message: 'I\'ve deleted "Project Notes" for you.',
        },
      });
    });

    it('should handle case-insensitive notebook name matching', async () => {
      mockGetAllRegularNotebooks.mockResolvedValue(mockNotebooks);
      mockDeleteNotebook.mockResolvedValue(undefined);

      const result = await deleteNotebook.handle(
        { notebook_name: 'MEETING MINUTES' },
        mockContext
      );

      expect(mockDeleteNotebook).toHaveBeenCalledWith('nb-3');
      expect(result.content).toBe('Deleted notebook: Meeting Minutes');
    });

    it('should handle missing notebook_name parameter', async () => {
      const result = await deleteNotebook.handle({}, mockContext);

      expect(result).toEqual({
        content: 'Error: Notebook name was unclear.',
      });
      expect(mockGetAllRegularNotebooks).not.toHaveBeenCalled();
      expect(mockDeleteNotebook).not.toHaveBeenCalled();
    });

    it('should handle null notebook_name parameter', async () => {
      const result = await deleteNotebook.handle({ notebook_name: null }, mockContext);

      expect(result).toEqual({
        content: 'Error: Notebook name was unclear.',
      });
      expect(mockGetAllRegularNotebooks).not.toHaveBeenCalled();
    });

    it('should handle empty string notebook_name', async () => {
      const result = await deleteNotebook.handle({ notebook_name: '' }, mockContext);

      expect(result).toEqual({
        content: 'Error: Notebook name was unclear.',
      });
      expect(mockGetAllRegularNotebooks).not.toHaveBeenCalled();
    });

    it('should handle notebook not found', async () => {
      mockGetAllRegularNotebooks.mockResolvedValue(mockNotebooks);

      const result = await deleteNotebook.handle(
        { notebook_name: 'Non-existent Notebook' },
        mockContext
      );

      expect(mockGetAllRegularNotebooks).toHaveBeenCalled();
      expect(mockDeleteNotebook).not.toHaveBeenCalled();
      expect(result).toEqual({
        content: 'Notebook "Non-existent Notebook" not found.',
      });
    });

    it('should handle empty notebook list', async () => {
      mockGetAllRegularNotebooks.mockResolvedValue([]);

      const result = await deleteNotebook.handle(
        { notebook_name: 'Any Notebook' },
        mockContext
      );

      expect(result).toEqual({
        content: 'Notebook "Any Notebook" not found.',
      });
    });

    it('should handle deletion service errors gracefully', async () => {
      const error = new Error('Permission denied');
      mockGetAllRegularNotebooks.mockResolvedValue(mockNotebooks);
      mockDeleteNotebook.mockRejectedValue(error);

      const result = await deleteNotebook.handle(
        { notebook_name: 'Project Notes' },
        mockContext
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[deleteNotebook] Error deleting notebook:',
        error
      );
      expect(result).toEqual({
        content: 'Failed to delete notebook: Permission denied',
      });
    });

    it('should handle non-Error objects thrown by service', async () => {
      mockGetAllRegularNotebooks.mockResolvedValue(mockNotebooks);
      mockDeleteNotebook.mockRejectedValue('String error');

      const result = await deleteNotebook.handle(
        { notebook_name: 'Project Notes' },
        mockContext
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[deleteNotebook] Error deleting notebook:',
        'String error'
      );
      expect(result).toEqual({
        content: 'Failed to delete notebook: Unknown error',
      });
    });

    it('should handle error when fetching notebooks', async () => {
      const error = new Error('Database unavailable');
      mockGetAllRegularNotebooks.mockRejectedValue(error);

      await expect(
        deleteNotebook.handle({ notebook_name: 'Any Notebook' }, mockContext)
      ).rejects.toThrow('Database unavailable');
    });

    it('should handle notebooks with special characters', async () => {
      const specialNotebooks = [
        { id: 'nb-special', title: 'Notes & Ideas: "Project #1"' },
      ];
      mockGetAllRegularNotebooks.mockResolvedValue(specialNotebooks);
      mockDeleteNotebook.mockResolvedValue(undefined);

      const result = await deleteNotebook.handle(
        { notebook_name: 'Notes & Ideas: "Project #1"' },
        mockContext
      );

      expect(mockDeleteNotebook).toHaveBeenCalledWith('nb-special');
      expect(result.content).toBe('Deleted notebook: Notes & Ideas: "Project #1"');
    });

    it('should match notebook with leading/trailing spaces', async () => {
      const spacedNotebooks = [
        { id: 'nb-spaced', title: '  Spaced Notebook  ' },
      ];
      mockGetAllRegularNotebooks.mockResolvedValue(spacedNotebooks);
      mockDeleteNotebook.mockResolvedValue(undefined);

      const result = await deleteNotebook.handle(
        { notebook_name: 'spaced notebook' },
        mockContext
      );

      expect(mockDeleteNotebook).toHaveBeenCalledWith('nb-spaced');
      expect(result.content).toBe('Deleted notebook:   Spaced Notebook  ');
    });
  });
});