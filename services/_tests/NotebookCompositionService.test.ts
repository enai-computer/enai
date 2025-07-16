import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs-extra';
import { app } from 'electron';
import { NotebookCompositionService } from '../NotebookCompositionService';
import { NotebookService } from '../NotebookService';
import { ObjectModelCore } from '../../models/ObjectModelCore';
import { ClassicBrowserService } from '../browser/ClassicBrowserService';
import { v4 as uuidv4 } from 'uuid';
import { TabState, ClassicBrowserPayload } from '../../shared/types';

// Mock modules
vi.mock('fs-extra', () => ({
  ensureDir: vi.fn(),
  writeJson: vi.fn(),
}));
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
  },
}));
vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('uuid', () => {
  let counter = 0;
  return {
    v4: vi.fn(() => {
      counter++;
      return `mock-uuid-${counter}`;
    }),
  };
});

describe('NotebookCompositionService', () => {
  let notebookService: NotebookService;
  let objectModelCore: ObjectModelCore;
  let classicBrowserService: ClassicBrowserService;
  let compositionService: NotebookCompositionService;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset UUID counter - uuidv4 is already mocked in vi.mock block above
    
    // Mock services
    notebookService = {
      createNotebook: vi.fn().mockResolvedValue({ id: 'notebook-123', title: 'Test Notebook' }),
    } as any;
    
    objectModelCore = {
      getById: vi.fn(),
    } as any;
    
    classicBrowserService = {
      prefetchFaviconsForWindows: vi.fn().mockResolvedValue(new Map()),
    } as any;
    
    compositionService = new NotebookCompositionService({
      notebookService,
      objectModelCore,
      classicBrowserService
    });
    
    // Mock fs methods
    vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
    vi.mocked(fs.writeJson).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('compose', () => {
    it('should create an empty notebook when no source objects are provided', async () => {
      const result = await compositionService.compose({
        title: 'Empty Notebook',
        description: 'Test description',
        sourceObjectIds: [],
      });

      expect(notebookService.createNotebook).toHaveBeenCalledWith('Empty Notebook', 'Test description');
      expect(result).toEqual({ notebookId: 'notebook-123' });
      expect(objectModelCore.getById).not.toHaveBeenCalled();
      expect(fs.writeJson).not.toHaveBeenCalled();
    });

    it('should create a single window with multiple tabs for multiple source objects', async () => {
      const sourceObjects = [
        {
          id: 'obj-1',
          objectType: 'webpage' as const,
          title: 'Article 1',
          sourceUri: 'https://example.com/article1',
          status: 'complete' as const,
          rawContentRef: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          internalFilePath: null,
        },
        {
          id: 'obj-2',
          objectType: 'webpage' as const,
          title: 'Article 2',
          sourceUri: 'https://example.com/article2',
          status: 'complete' as const,
          rawContentRef: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          internalFilePath: null,
        },
        {
          id: 'obj-3',
          objectType: 'pdf' as const,
          title: 'PDF Document',
          sourceUri: 'https://example.com/doc.pdf',
          status: 'pdf_processed' as const,
          rawContentRef: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          internalFilePath: '/path/to/doc.pdf',
        },
      ];

      vi.mocked(objectModelCore.getById)
        .mockResolvedValueOnce(sourceObjects[0])
        .mockResolvedValueOnce(sourceObjects[1])
        .mockResolvedValueOnce(sourceObjects[2]);

      const result = await compositionService.compose({
        title: 'Test Notebook',
        sourceObjectIds: ['obj-1', 'obj-2', 'obj-3'],
      });

      expect(result).toEqual({ notebookId: 'notebook-123' });

      // Verify the state file was written
      expect(fs.writeJson).toHaveBeenCalledTimes(1);
      const [filePath, stateObject] = vi.mocked(fs.writeJson).mock.calls[0];
      
      expect(filePath).toBe('/mock/userData/notebook_layouts/notebook-layout-notebook-123.json');
      expect(stateObject.version).toBe(2);
      expect(stateObject.state.windows).toHaveLength(1);

      // Verify single window with multiple tabs
      const window = stateObject.state.windows[0];
      expect(window.type).toBe('classic-browser');
      expect(window.title).toBe('Composed Space');
      expect(window.x).toBe(380);
      expect(window.y).toBe(10);
      expect(window.isMinimized).toBe(false);
      expect(window.isFocused).toBe(true);

      const payload = window.payload as ClassicBrowserPayload;
      expect(payload.tabs).toHaveLength(3);
      
      // Check first tab (web URL)
      expect(payload.tabs[0]).toMatchObject({
        url: 'https://example.com/article1',
        title: 'Article 1',
        faviconUrl: null,
        isLoading: false,
      });

      // Check second tab (web URL)
      expect(payload.tabs[1]).toMatchObject({
        url: 'https://example.com/article2',
        title: 'Article 2',
        faviconUrl: null,
        isLoading: false,
      });

      // Check third tab (PDF with file:// URL)
      expect(payload.tabs[2]).toMatchObject({
        url: 'file:///path/to/doc.pdf',
        title: 'PDF Document',
        faviconUrl: null,
        isLoading: false,
      });

      // First tab should be active
      expect(payload.activeTabId).toBe(payload.tabs[0].id);
    });

    it('should skip objects that cannot be found', async () => {
      vi.mocked(objectModelCore.getById)
        .mockResolvedValueOnce(null) // First object not found
        .mockResolvedValueOnce({
          id: 'obj-2',
          objectType: 'webpage' as const,
          title: 'Found Article',
          sourceUri: 'https://example.com/found',
          status: 'complete' as const,
          rawContentRef: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

      const result = await compositionService.compose({
        title: 'Test Notebook',
        sourceObjectIds: ['obj-1', 'obj-2'],
      });

      expect(result).toEqual({ notebookId: 'notebook-123' });

      const [, stateObject] = vi.mocked(fs.writeJson).mock.calls[0];
      const window = stateObject.state.windows[0];
      const payload = window.payload as ClassicBrowserPayload;
      
      // Should only have one tab (the found object)
      expect(payload.tabs).toHaveLength(1);
      expect(payload.tabs[0].title).toBe('Found Article');
    });

    it('should prefetch favicons for web URLs but not file URLs', async () => {
      const sourceObjects = [
        {
          id: 'obj-1',
          objectType: 'webpage' as const,
          title: 'Web Article',
          sourceUri: 'https://example.com/article',
          status: 'complete' as const,
          rawContentRef: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'obj-2',
          objectType: 'pdf' as const,
          title: 'Local PDF',
          sourceUri: 'https://example.com/doc.pdf',
          status: 'pdf_processed' as const,
          rawContentRef: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          internalFilePath: '/path/to/doc.pdf',
        },
        {
          id: 'obj-3',
          objectType: 'webpage' as const,
          title: 'Another Web Page',
          sourceUri: 'https://example.com/page',
          status: 'complete' as const,
          rawContentRef: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      vi.mocked(objectModelCore.getById)
        .mockResolvedValueOnce(sourceObjects[0])
        .mockResolvedValueOnce(sourceObjects[1])
        .mockResolvedValueOnce(sourceObjects[2]);

      // We need to match the actual tab IDs that will be passed to prefetchFaviconsForWindows
      // Let's capture them from the mock call and return appropriate favicons
      vi.mocked(classicBrowserService.prefetchFaviconsForWindows).mockImplementation(async (windows) => {
        const faviconMap = new Map();
        windows.forEach((w: any) => {
          if (w.url === 'https://example.com/article') {
            faviconMap.set(w.windowId, 'https://example.com/favicon1.ico');
          } else if (w.url === 'https://example.com/page') {
            faviconMap.set(w.windowId, 'https://example.com/favicon2.ico');
          }
        });
        return faviconMap;
      });

      await compositionService.compose({
        title: 'Test Notebook',
        sourceObjectIds: ['obj-1', 'obj-2', 'obj-3'],
      });

      // Verify prefetch was called only for non-file URLs
      expect(classicBrowserService.prefetchFaviconsForWindows).toHaveBeenCalledTimes(1);
      const prefetchCall = vi.mocked(classicBrowserService.prefetchFaviconsForWindows).mock.calls[0][0];
      expect(prefetchCall).toHaveLength(2);
      expect(prefetchCall[0]).toMatchObject({ url: 'https://example.com/article' });
      expect(prefetchCall[1]).toMatchObject({ url: 'https://example.com/page' });

      // Verify favicons were merged into tabs
      const [, stateObject] = vi.mocked(fs.writeJson).mock.calls[0];
      const window = stateObject.state.windows[0];
      const payload = window.payload as ClassicBrowserPayload;
      
      // Web tabs should have favicons, PDF tab should not
      expect(payload.tabs[0].faviconUrl).toBeTruthy();
      expect(payload.tabs[1].faviconUrl).toBeNull(); // PDF
      expect(payload.tabs[2].faviconUrl).toBeTruthy();
    });

    it('should handle favicon prefetch errors gracefully', async () => {
      const sourceObject = {
        id: 'obj-1',
        objectType: 'webpage' as const,
        title: 'Web Article',
        sourceUri: 'https://example.com/article',
        status: 'complete' as const,
        rawContentRef: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(objectModelCore.getById).mockResolvedValue(sourceObject);
      vi.mocked(classicBrowserService.prefetchFaviconsForWindows).mockRejectedValue(
        new Error('Network error')
      );

      const result = await compositionService.compose({
        title: 'Test Notebook',
        sourceObjectIds: ['obj-1'],
      });

      // Should still succeed
      expect(result).toEqual({ notebookId: 'notebook-123' });

      // Verify tab was created without favicon
      const [, stateObject] = vi.mocked(fs.writeJson).mock.calls[0];
      const window = stateObject.state.windows[0];
      const payload = window.payload as ClassicBrowserPayload;
      
      expect(payload.tabs[0].faviconUrl).toBeNull();
    });

    it('should handle composition without ClassicBrowserService', async () => {
      // Create service without ClassicBrowserService
      const serviceWithoutBrowser = new NotebookCompositionService({
        notebookService,
        objectModelCore
      });

      const sourceObject = {
        id: 'obj-1',
        objectType: 'webpage' as const,
        title: 'Web Article',
        sourceUri: 'https://example.com/article',
        status: 'complete' as const,
        rawContentRef: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(objectModelCore.getById).mockResolvedValue(sourceObject);

      const result = await serviceWithoutBrowser.compose({
        title: 'Test Notebook',
        sourceObjectIds: ['obj-1'],
      });

      expect(result).toEqual({ notebookId: 'notebook-123' });

      // Should not attempt favicon prefetch
      expect(classicBrowserService.prefetchFaviconsForWindows).not.toHaveBeenCalled();
    });

    it('should create proper window metadata structure', async () => {
      const sourceObject = {
        id: 'obj-1',
        objectType: 'webpage' as const,
        title: 'Test Article',
        sourceUri: 'https://example.com/test',
        status: 'complete' as const,
        rawContentRef: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(objectModelCore.getById).mockResolvedValue(sourceObject);

      await compositionService.compose({
        title: 'Test Notebook',
        sourceObjectIds: ['obj-1'],
      });

      const [, stateObject] = vi.mocked(fs.writeJson).mock.calls[0];
      const window = stateObject.state.windows[0];

      // Verify all window metadata fields
      expect(window).toMatchObject({
        id: expect.stringContaining('mock-uuid'),
        type: 'classic-browser',
        title: 'Composed Space',
        x: 380,
        y: 10,
        width: 1075,
        height: 915,
        zIndex: 10,
        isFocused: true,
        isMinimized: false,
      });
    });

    it('should ensure notebook layout directory exists', async () => {
      const sourceObject = {
        id: 'obj-1',
        objectType: 'webpage' as const,
        title: 'Test Article',
        sourceUri: 'https://example.com/test',
        status: 'complete' as const,
        rawContentRef: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(objectModelCore.getById).mockResolvedValue(sourceObject);

      await compositionService.compose({
        title: 'Test Notebook',
        sourceObjectIds: ['obj-1'],
      });

      expect(fs.ensureDir).toHaveBeenCalledWith('/mock/userData/notebook_layouts');
    });
  });
});