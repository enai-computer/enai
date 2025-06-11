import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { openNotebook } from '../openNotebook';
import { ToolContext } from '../types';
import { logger } from '../../../../utils/logger';

// Mock the logger
vi.mock('../../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('openNotebook', () => {
  let mockContext: ToolContext;
  let mockGetAllRegularNotebooks: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockGetAllRegularNotebooks = vi.fn();
    
    mockContext = {
      services: {
        notebookService: {
          getAllRegularNotebooks: mockGetAllRegularNotebooks,
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
      expect(openNotebook.name).toBe('open_notebook');
      expect(openNotebook.description).toContain('Opens an existing notebook');
      expect(openNotebook.description).toContain('open, find, or show');
    });

    it('should have correct parameter schema', () => {
      expect(openNotebook.parameters).toEqual({
        type: 'object',
        properties: {
          notebook_name: {
            type: 'string',
            description: 'The exact name or title of the notebook to open',
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

    it('should successfully open a notebook', async () => {
      mockGetAllRegularNotebooks.mockResolvedValue(mockNotebooks);

      const result = await openNotebook.handle(
        { notebook_name: 'Project Notes' },
        mockContext
      );

      expect(mockGetAllRegularNotebooks).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[openNotebook] Looking for "Project Notes" among 3 regular notebooks:',
        ['My First Notebook', 'Project Notes', 'Meeting Minutes']
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[openNotebook] Found notebook: "Project Notes" (ID: nb-2)'
      );
      expect(result).toEqual({
        content: 'Opened notebook: Project Notes',
        immediateReturn: {
          type: 'open_notebook',
          notebookId: 'nb-2',
          title: 'Project Notes',
          message: 'Right on, I\'ll open "Project Notes" for you.',
        },
      });
    });

    it('should handle case-insensitive notebook name matching', async () => {
      mockGetAllRegularNotebooks.mockResolvedValue(mockNotebooks);

      const result = await openNotebook.handle(
        { notebook_name: 'MEETING MINUTES' },
        mockContext
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[openNotebook] Found notebook: "Meeting Minutes" (ID: nb-3)'
      );
      expect(result.content).toBe('Opened notebook: Meeting Minutes');
      expect(result.immediateReturn?.notebookId).toBe('nb-3');
    });

    it('should handle missing notebook_name parameter', async () => {
      const result = await openNotebook.handle({}, mockContext);

      expect(result).toEqual({
        content: 'Error: Notebook name was unclear.',
      });
      expect(mockGetAllRegularNotebooks).not.toHaveBeenCalled();
    });

    it('should handle null notebook_name parameter', async () => {
      const result = await openNotebook.handle({ notebook_name: null }, mockContext);

      expect(result).toEqual({
        content: 'Error: Notebook name was unclear.',
      });
      expect(mockGetAllRegularNotebooks).not.toHaveBeenCalled();
    });

    it('should handle empty string notebook_name', async () => {
      const result = await openNotebook.handle({ notebook_name: '' }, mockContext);

      expect(result).toEqual({
        content: 'Error: Notebook name was unclear.',
      });
      expect(mockGetAllRegularNotebooks).not.toHaveBeenCalled();
    });

    it('should handle notebook not found', async () => {
      mockGetAllRegularNotebooks.mockResolvedValue(mockNotebooks);

      const result = await openNotebook.handle(
        { notebook_name: 'Non-existent Notebook' },
        mockContext
      );

      expect(mockGetAllRegularNotebooks).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        '[openNotebook] Notebook "Non-existent Notebook" not found among available notebooks'
      );
      expect(result).toEqual({
        content: 'Notebook "Non-existent Notebook" not found.',
      });
    });

    it('should handle empty notebook list', async () => {
      mockGetAllRegularNotebooks.mockResolvedValue([]);

      const result = await openNotebook.handle(
        { notebook_name: 'Any Notebook' },
        mockContext
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[openNotebook] Looking for "Any Notebook" among 0 regular notebooks:',
        []
      );
      expect(logger.warn).toHaveBeenCalledWith(
        '[openNotebook] Notebook "Any Notebook" not found among available notebooks'
      );
      expect(result).toEqual({
        content: 'Notebook "Any Notebook" not found.',
      });
    });

    it('should handle error when fetching notebooks', async () => {
      const error = new Error('Database connection failed');
      mockGetAllRegularNotebooks.mockRejectedValue(error);

      await expect(
        openNotebook.handle({ notebook_name: 'Any Notebook' }, mockContext)
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle notebooks with special characters', async () => {
      const specialNotebooks = [
        { id: 'nb-special', title: 'Notes & Ideas: "Project #1"' },
      ];
      mockGetAllRegularNotebooks.mockResolvedValue(specialNotebooks);

      const result = await openNotebook.handle(
        { notebook_name: 'Notes & Ideas: "Project #1"' },
        mockContext
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[openNotebook] Found notebook: "Notes & Ideas: "Project #1"" (ID: nb-special)'
      );
      expect(result.content).toBe('Opened notebook: Notes & Ideas: "Project #1"');
      expect(result.immediateReturn?.message).toBe(
        'Right on, I\'ll open "Notes & Ideas: "Project #1"" for you.'
      );
    });

    it('should match notebook with leading/trailing spaces', async () => {
      const spacedNotebooks = [
        { id: 'nb-spaced', title: '  Spaced Notebook  ' },
      ];
      mockGetAllRegularNotebooks.mockResolvedValue(spacedNotebooks);

      const result = await openNotebook.handle(
        { notebook_name: 'spaced notebook' },
        mockContext
      );

      expect(result.content).toBe('Opened notebook:   Spaced Notebook  ');
      expect(result.immediateReturn?.notebookId).toBe('nb-spaced');
    });

    it('should find first matching notebook when multiple have same name', async () => {
      const duplicateNotebooks = [
        { id: 'nb-1', title: 'Duplicate Name' },
        { id: 'nb-2', title: 'Duplicate Name' },
        { id: 'nb-3', title: 'Other Notebook' },
      ];
      mockGetAllRegularNotebooks.mockResolvedValue(duplicateNotebooks);

      const result = await openNotebook.handle(
        { notebook_name: 'Duplicate Name' },
        mockContext
      );

      expect(result.immediateReturn?.notebookId).toBe('nb-1');
      expect(logger.info).toHaveBeenCalledWith(
        '[openNotebook] Found notebook: "Duplicate Name" (ID: nb-1)'
      );
    });

    it('should log all notebook titles when searching', async () => {
      const manyNotebooks = Array.from({ length: 5 }, (_, i) => ({
        id: `nb-${i}`,
        title: `Notebook ${i}`,
      }));
      mockGetAllRegularNotebooks.mockResolvedValue(manyNotebooks);

      await openNotebook.handle(
        { notebook_name: 'Notebook 3' },
        mockContext
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[openNotebook] Looking for "Notebook 3" among 5 regular notebooks:',
        ['Notebook 0', 'Notebook 1', 'Notebook 2', 'Notebook 3', 'Notebook 4']
      );
    });
  });
});