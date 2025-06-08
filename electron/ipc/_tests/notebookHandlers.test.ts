import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { registerNotebookIpcHandlers } from '../notebookHandlers';
import { NotebookService } from '../../../services/NotebookService';
import { logger } from '../../../utils/logger';
import {
  NOTEBOOK_GET_BY_ID,
  NOTEBOOK_GET_ALL,
  NOTEBOOK_UPDATE,
  NOTEBOOK_DELETE,
  NOTEBOOK_GET_CHUNKS,
  NOTEBOOK_GET_RECENTLY_VIEWED
} from '../../../shared/ipcChannels';

// Mock logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}));

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}));

describe('notebookHandlers', () => {
  let mockNotebookService: Partial<NotebookService>;
  let mockEvent: Partial<IpcMainInvokeEvent>;
  let handlers: Map<string, Function>;

  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();

    // Initialize handler map
    handlers = new Map();

    // Get the mocked ipcMain
    const { ipcMain } = await import('electron');
    
    // Setup ipcMain mock to capture handlers
    (ipcMain.handle as any).mockImplementation((channel: string, handler: Function) => {
      handlers.set(channel, handler);
      return ipcMain;
    });

    // Mock NotebookService
    mockNotebookService = {
      getNotebookById: vi.fn(),
      getAllNotebooks: vi.fn(),
      updateNotebook: vi.fn(),
      deleteNotebook: vi.fn(),
      getNotebookChunks: vi.fn(),
      getRecentlyViewedNotebooks: vi.fn(),
      getVectorStats: vi.fn()
    };

    // Mock event
    mockEvent = {
      sender: {} as any
    };
  });

  afterEach(() => {
    handlers.clear();
  });

  describe('registration', () => {
    it('should register all handlers correctly', async () => {
      registerNotebookIpcHandlers(mockNotebookService as NotebookService);

      const expectedChannels = [
        NOTEBOOK_GET_BY_ID,
        NOTEBOOK_GET_ALL,
        NOTEBOOK_UPDATE,
        NOTEBOOK_DELETE,
        NOTEBOOK_GET_CHUNKS,
        NOTEBOOK_GET_RECENTLY_VIEWED
      ];

      const { ipcMain } = await import('electron');
      expectedChannels.forEach(channel => {
        expect(ipcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
        expect(handlers.has(channel)).toBe(true);
      });

      expect(ipcMain.handle).toHaveBeenCalledTimes(6);
    });

    it('should prevent double registration', async () => {
      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      
      // Try to register again
      registerNotebookIpcHandlers(mockNotebookService as NotebookService);

      const { ipcMain } = await import('electron');
      expect(ipcMain.handle).toHaveBeenCalledTimes(6); // Only called once
      expect(logger.warn).toHaveBeenCalledWith(
        '[IPC:Notebook] Handlers already registered. Skipping registration.'
      );
    });
  });

  describe('NOTEBOOK_GET_BY_ID handler', () => {
    it('should validate id parameter', async () => {
      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_BY_ID)!;

      await expect(handler(mockEvent, '')).rejects.toThrow('Invalid ID for getting notebook');
      await expect(handler(mockEvent, '  ')).rejects.toThrow('Invalid ID for getting notebook');
      await expect(handler(mockEvent, null)).rejects.toThrow('Invalid ID for getting notebook');
    });

    it('should return notebook when found', async () => {
      const mockNotebook = {
        id: 'notebook-123',
        title: 'Test Notebook',
        content: 'Test content'
      };
      mockNotebookService.getNotebookById = vi.fn().mockResolvedValue(mockNotebook);

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_BY_ID)!;

      const result = await handler(mockEvent, 'notebook-123');

      expect(result).toEqual(mockNotebook);
      expect(mockNotebookService.getNotebookById).toHaveBeenCalledWith('notebook-123');
    });

    it('should return null when notebook not found', async () => {
      mockNotebookService.getNotebookById = vi.fn().mockResolvedValue(null);

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_BY_ID)!;

      const result = await handler(mockEvent, 'nonexistent');

      expect(result).toBeNull();
    });

    it('should handle service errors', async () => {
      mockNotebookService.getNotebookById = vi.fn().mockRejectedValue(new Error('Database error'));

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_BY_ID)!;

      await expect(handler(mockEvent, 'notebook-123'))
        .rejects.toThrow('Database error');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error handling NOTEBOOK_GET_BY_ID'),
        expect.any(Error)
      );
    });
  });

  describe('NOTEBOOK_GET_ALL handler', () => {
    it('should return all notebooks', async () => {
      const mockNotebooks = [
        { id: 'notebook-1', title: 'Notebook 1', isNotebookCover: false },
        { id: 'notebook-2', title: 'Notebook 2', isNotebookCover: false },
        { id: 'cover-123', title: 'Cover', isNotebookCover: true }
      ];
      mockNotebookService.getAllNotebooks = vi.fn().mockResolvedValue(mockNotebooks);

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_ALL)!;

      const result = await handler(mockEvent, {});

      // Should return all notebooks (no filtering in handler)
      expect(result).toEqual(mockNotebooks);
    });

    it('should handle empty notebook list', async () => {
      mockNotebookService.getAllNotebooks = vi.fn().mockResolvedValue([]);

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_ALL)!;

      const result = await handler(mockEvent, {});

      expect(result).toEqual([]);
    });

    it('should handle service errors', async () => {
      mockNotebookService.getAllNotebooks = vi.fn().mockRejectedValue(new Error('Service error'));

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_ALL)!;

      await expect(handler(mockEvent, {})).rejects.toThrow('Service error');
    });
  });

  describe('NOTEBOOK_UPDATE handler', () => {
    it('should validate required parameters', async () => {
      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_UPDATE)!;

      await expect(handler(mockEvent, '', {})).rejects.toThrow('Invalid ID for updating notebook');
      await expect(handler(mockEvent, 'id', null)).rejects.toThrow('Invalid updates for notebook');
      await expect(handler(mockEvent, 'id', {})).rejects.toThrow('Invalid updates for notebook');
    });

    it('should update notebook successfully', async () => {
      mockNotebookService.updateNotebook = vi.fn().mockResolvedValue({
        id: 'notebook-123',
        title: 'Updated Title'
      });

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_UPDATE)!;

      const result = await handler(mockEvent, 'notebook-123', { title: 'Updated Title' });

      expect(result).toEqual({
        id: 'notebook-123',
        title: 'Updated Title'
      });
      expect(mockNotebookService.updateNotebook).toHaveBeenCalledWith(
        'notebook-123',
        { title: 'Updated Title' }
      );
    });

    it('should prevent updating system notebooks', async () => {
      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_UPDATE)!;

      await expect(handler(mockEvent, 'cover-123', { title: 'New Title' }))
        .rejects.toThrow('Cannot update system notebook');

      expect(mockNotebookService.updateNotebook).not.toHaveBeenCalled();
    });

    it('should handle update errors', async () => {
      mockNotebookService.updateNotebook = vi.fn().mockRejectedValue(new Error('Update failed'));

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_UPDATE)!;

      await expect(handler(mockEvent, 'notebook-123', { title: 'New Title' }))
        .rejects.toThrow('Update failed');
    });
  });

  describe('NOTEBOOK_DELETE handler', () => {
    it('should validate id parameter', async () => {
      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_DELETE)!;

      await expect(handler(mockEvent, '')).rejects.toThrow('Invalid ID for deleting notebook');
      await expect(handler(mockEvent, '  ')).rejects.toThrow('Invalid ID for deleting notebook');
    });

    it('should delete notebook successfully', async () => {
      mockNotebookService.deleteNotebook = vi.fn().mockResolvedValue(true);

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_DELETE)!;

      const result = await handler(mockEvent, 'notebook-123');

      expect(result).toBe(true);
      expect(mockNotebookService.deleteNotebook).toHaveBeenCalledWith('notebook-123');
    });

    it('should prevent deleting system notebooks', async () => {
      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_DELETE)!;

      await expect(handler(mockEvent, 'cover-123'))
        .rejects.toThrow('Cannot delete system notebook');

      expect(mockNotebookService.deleteNotebook).not.toHaveBeenCalled();
    });

    it('should handle deletion errors', async () => {
      mockNotebookService.deleteNotebook = vi.fn().mockRejectedValue(new Error('Deletion failed'));

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_DELETE)!;

      await expect(handler(mockEvent, 'notebook-123'))
        .rejects.toThrow('Deletion failed');
    });
  });

  describe('NOTEBOOK_GET_CHUNKS handler', () => {
    it('should validate notebookId parameter', async () => {
      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_CHUNKS)!;

      await expect(handler(mockEvent, '')).rejects.toThrow('Invalid notebookId for getting chunks');
    });

    it('should return notebook chunks with stats', async () => {
      const mockChunks = [
        { id: 'chunk-1', content: 'Chunk 1' },
        { id: 'chunk-2', content: 'Chunk 2' }
      ];
      mockNotebookService.getNotebookChunks = vi.fn().mockResolvedValue(mockChunks);
      mockNotebookService.getVectorStats = vi.fn().mockResolvedValue({
        totalVectors: 100,
        notebookVectors: 50
      });

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_CHUNKS)!;

      const result = await handler(mockEvent, 'notebook-123');

      expect(result).toEqual({
        chunks: mockChunks,
        stats: { totalVectors: 100, notebookVectors: 50 }
      });
      expect(mockNotebookService.getNotebookChunks).toHaveBeenCalledWith('notebook-123');
      expect(mockNotebookService.getVectorStats).toHaveBeenCalledWith('notebook-123');
    });

    it('should handle service errors', async () => {
      mockNotebookService.getNotebookChunks = vi.fn().mockRejectedValue(new Error('Chunks error'));

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_CHUNKS)!;

      await expect(handler(mockEvent, 'notebook-123'))
        .rejects.toThrow('Chunks error');
    });

    it('should handle stats retrieval errors gracefully', async () => {
      mockNotebookService.getNotebookChunks = vi.fn().mockResolvedValue([]);
      mockNotebookService.getVectorStats = vi.fn().mockRejectedValue(new Error('Stats error'));

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_CHUNKS)!;

      const result = await handler(mockEvent, 'notebook-123');

      // Should still return chunks even if stats fail
      expect(result).toEqual({
        chunks: [],
        stats: {
          totalVectors: 0,
          notebookVectors: 0
        }
      });
    });
  });

  describe('NOTEBOOK_GET_RECENTLY_VIEWED handler', () => {
    it('should return recently viewed notebooks', async () => {
      const mockRecentNotebooks = [
        { id: 'notebook-1', title: 'Recent 1', lastViewedAt: new Date() },
        { id: 'notebook-2', title: 'Recent 2', lastViewedAt: new Date() }
      ];
      mockNotebookService.getRecentlyViewedNotebooks = vi.fn().mockResolvedValue(mockRecentNotebooks);

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_RECENTLY_VIEWED)!;

      const result = await handler(mockEvent, 10);

      expect(result).toEqual(mockRecentNotebooks);
      expect(mockNotebookService.getRecentlyViewedNotebooks).toHaveBeenCalledWith(10);
    });

    it('should use default limit when not provided', async () => {
      mockNotebookService.getRecentlyViewedNotebooks = vi.fn().mockResolvedValue([]);

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_RECENTLY_VIEWED)!;

      await handler(mockEvent, undefined);

      expect(mockNotebookService.getRecentlyViewedNotebooks).toHaveBeenCalledWith(5);
    });

    it('should handle service errors', async () => {
      mockNotebookService.getRecentlyViewedNotebooks = vi.fn()
        .mockRejectedValue(new Error('Recent notebooks error'));

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_RECENTLY_VIEWED)!;

      await expect(handler(mockEvent, 5)).rejects.toThrow('Recent notebooks error');
    });
  });

  describe('error handling', () => {
    it('should log and re-throw all errors', async () => {
      mockNotebookService.getNotebookById = vi.fn().mockRejectedValue(new Error('Test error'));

      registerNotebookIpcHandlers(mockNotebookService as NotebookService);
      const handler = handlers.get(NOTEBOOK_GET_BY_ID)!;

      await expect(handler(mockEvent, 'test'))
        .rejects.toThrow('Test error');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error handling NOTEBOOK_GET_BY_ID'),
        expect.any(Error)
      );
    });
  });
});