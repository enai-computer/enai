import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IpcMain, IpcMainInvokeEvent, BrowserWindow, WebContents } from 'electron';
import { registerPdfIngestionHandler } from '../pdfIngestionHandler';
import { PdfIngestionService } from '../../../services/ingestion/PdfIngestionService';
import { IngestionQueueService } from '../../../services/ingestion/IngestionQueueService';
import { logger } from '../../../utils/logger';
import { 
  PDF_INGEST_REQUEST, 
  PDF_INGEST_PROGRESS,
  PDF_INGEST_BATCH_COMPLETE,
  PDF_INGEST_CANCEL 
} from '../../../shared/ipcChannels';
import * as fs from 'fs/promises';

// Mock logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}));

// Mock fs
vi.mock('fs/promises', () => ({
  access: vi.fn(),
  constants: { F_OK: 0 }
}));

describe('pdfIngestionHandler', () => {
  let mockIpcMain: Partial<IpcMain>;
  let mockPdfService: Partial<PdfIngestionService>;
  let mockQueueService: Partial<IngestionQueueService>;
  let mockMainWindow: Partial<BrowserWindow>;
  let mockWebContents: Partial<WebContents>;
  let handlers: Map<string, Function>;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Initialize handler map
    handlers = new Map();

    // Mock IpcMain
    mockIpcMain = {
      handle: vi.fn((channel: string, handler: Function) => {
        handlers.set(channel, handler);
        return mockIpcMain as IpcMain;
      }),
      on: vi.fn((channel: string, handler: Function) => {
        handlers.set(channel, handler);
        return mockIpcMain as IpcMain;
      }),
      removeHandler: vi.fn()
    };

    // Mock WebContents
    mockWebContents = {
      id: 1,
      send: vi.fn()
    };

    // Mock BrowserWindow (mainWindow)
    mockMainWindow = {
      webContents: mockWebContents as WebContents
    };

    // Mock services
    mockPdfService = {
      ingestPdf: vi.fn()
    };

    mockQueueService = {
      addJob: vi.fn().mockResolvedValue('job-123'),
      on: vi.fn(),
      off: vi.fn(),
      processJob: vi.fn()
    };
  });

  afterEach(() => {
    handlers.clear();
    vi.useRealTimers();
  });

  describe('registration', () => {
    it('should register handlers correctly', () => {
      registerPdfIngestionHandler(
        mockIpcMain as IpcMain,
        mockPdfService as PdfIngestionService,
        mockMainWindow as BrowserWindow,
        mockQueueService as IngestionQueueService
      );

      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        PDF_INGEST_REQUEST,
        expect.any(Function)
      );
      expect(mockIpcMain.on).toHaveBeenCalledWith(
        PDF_INGEST_CANCEL,
        expect.any(Function)
      );
      expect(handlers.has(PDF_INGEST_REQUEST)).toBe(true);
      expect(handlers.has(PDF_INGEST_CANCEL)).toBe(true);
    });
  });

  describe('PDF_INGEST_REQUEST handler', () => {
    let mockEvent: Partial<IpcMainInvokeEvent>;

    beforeEach(() => {
      mockEvent = {
        sender: {} as any
      };
    });

    it('should validate input parameters', async () => {
      registerPdfIngestionHandler(
        mockIpcMain as IpcMain,
        mockPdfService as PdfIngestionService,
        mockMainWindow as BrowserWindow,
        mockQueueService as IngestionQueueService
      );
      const handler = handlers.get(PDF_INGEST_REQUEST)!;

      // Test missing filePaths
      await expect(handler(mockEvent, {})).rejects.toThrow('Invalid file paths provided');
      
      // Test invalid filePaths type
      await expect(handler(mockEvent, { filePaths: 'not-an-array' })).rejects.toThrow('Invalid file paths provided');
      
      // Test empty filePaths
      await expect(handler(mockEvent, { filePaths: [] })).rejects.toThrow('Invalid file paths provided');
    });

    it('should queue PDF files for ingestion', async () => {
      mockQueueService.addJob = vi.fn()
        .mockResolvedValueOnce('job-1')
        .mockResolvedValueOnce('job-2');

      registerPdfIngestionHandler(
        mockIpcMain as IpcMain,
        mockPdfService as PdfIngestionService,
        mockMainWindow as BrowserWindow,
        mockQueueService as IngestionQueueService
      );
      const handler = handlers.get(PDF_INGEST_REQUEST)!;

      await handler(mockEvent, {
        filePaths: ['/path/to/file1.pdf', '/path/to/file2.pdf']
      });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting batch PDF ingestion for 2 files')
      );

      expect(mockQueueService.addJob).toHaveBeenCalledTimes(2);
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        'pdf-ingestion',
        expect.objectContaining({
          filePath: '/path/to/file1.pdf',
          fileIndex: 0,
          totalFiles: 2
        })
      );
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        'pdf-ingestion',
        expect.objectContaining({
          filePath: '/path/to/file2.pdf',
          fileIndex: 1,
          totalFiles: 2
        })
      );
    });

    it('should track job progress events', async () => {
      mockQueueService.addJob = vi.fn().mockResolvedValue('job-123');
      
      const eventCallbacks: Map<string, Function> = new Map();
      mockQueueService.on = vi.fn((event: string, callback: Function) => {
        eventCallbacks.set(event, callback);
      });

      registerPdfIngestionHandler(
        mockIpcMain as IpcMain,
        mockPdfService as PdfIngestionService,
        mockMainWindow as BrowserWindow,
        mockQueueService as IngestionQueueService
      );
      const handler = handlers.get(PDF_INGEST_REQUEST)!;

      await handler(mockEvent, {
        filePaths: ['/path/to/file.pdf']
      });

      // Simulate progress event
      const progressCallback = eventCallbacks.get('job:progress:job-123');
      expect(progressCallback).toBeDefined();

      progressCallback!({
        id: 'job-123',
        progress: 50
      });

      expect(mockWebContents.send).toHaveBeenCalledWith(
        PDF_INGEST_PROGRESS,
        expect.objectContaining({
          currentFileIndex: 0,
          totalFiles: 1,
          currentFile: '/path/to/file.pdf',
          progress: 50
        })
      );
    });

    it('should handle job completion and send batch complete', async () => {
      mockQueueService.addJob = vi.fn()
        .mockResolvedValueOnce('job-1')
        .mockResolvedValueOnce('job-2');
      
      const eventCallbacks: Map<string, Function> = new Map();
      mockQueueService.on = vi.fn((event: string, callback: Function) => {
        eventCallbacks.set(event, callback);
      });

      registerPdfIngestionHandler(
        mockIpcMain as IpcMain,
        mockPdfService as PdfIngestionService,
        mockMainWindow as BrowserWindow,
        mockQueueService as IngestionQueueService
      );
      const handler = handlers.get(PDF_INGEST_REQUEST)!;

      await handler(mockEvent, {
        filePaths: ['/path/to/file1.pdf', '/path/to/file2.pdf']
      });

      // Simulate completion of both jobs
      const completeCallback1 = eventCallbacks.get('job:complete:job-1');
      const completeCallback2 = eventCallbacks.get('job:complete:job-2');
      
      completeCallback1!({
        id: 'job-1',
        result: { 
          status: 'success', 
          objectId: 'obj-1',
          filePath: '/path/to/file1.pdf'
        }
      });
      
      completeCallback2!({
        id: 'job-2',
        result: { 
          status: 'success', 
          objectId: 'obj-2',
          filePath: '/path/to/file2.pdf'
        }
      });

      // Should send batch complete after all jobs finish
      expect(mockWebContents.send).toHaveBeenCalledWith(
        PDF_INGEST_BATCH_COMPLETE,
        expect.objectContaining({
          results: expect.arrayContaining([
            expect.objectContaining({ 
              status: 'success',
              filePath: '/path/to/file1.pdf'
            }),
            expect.objectContaining({ 
              status: 'success',
              filePath: '/path/to/file2.pdf'
            })
          ])
        })
      );
    });

    it('should handle job errors', async () => {
      mockQueueService.addJob = vi.fn().mockResolvedValue('job-123');
      
      const eventCallbacks: Map<string, Function> = new Map();
      mockQueueService.on = vi.fn((event: string, callback: Function) => {
        eventCallbacks.set(event, callback);
      });

      registerPdfIngestionHandler(
        mockIpcMain as IpcMain,
        mockPdfService as PdfIngestionService,
        mockMainWindow as BrowserWindow,
        mockQueueService as IngestionQueueService
      );
      const handler = handlers.get(PDF_INGEST_REQUEST)!;

      await handler(mockEvent, {
        filePaths: ['/path/to/file.pdf']
      });

      // Simulate error event
      const errorCallback = eventCallbacks.get('job:error:job-123');
      errorCallback!({
        id: 'job-123',
        error: new Error('Processing failed')
      });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Job job-123 failed'),
        expect.any(Error)
      );

      // Simulate completion with error status
      const completeCallback = eventCallbacks.get('job:complete:job-123');
      completeCallback!({
        id: 'job-123',
        result: { 
          status: 'error', 
          error: 'Processing failed',
          filePath: '/path/to/file.pdf'
        }
      });

      expect(mockWebContents.send).toHaveBeenCalledWith(
        PDF_INGEST_BATCH_COMPLETE,
        expect.objectContaining({
          results: expect.arrayContaining([
            expect.objectContaining({ 
              status: 'error',
              error: 'Processing failed'
            })
          ])
        })
      );
    });

    it('should cleanup listeners after batch completion', async () => {
      mockQueueService.addJob = vi.fn().mockResolvedValue('job-123');
      
      const eventCallbacks: Map<string, Function> = new Map();
      mockQueueService.on = vi.fn((event: string, callback: Function) => {
        eventCallbacks.set(event, callback);
      });

      registerPdfIngestionHandler(
        mockIpcMain as IpcMain,
        mockPdfService as PdfIngestionService,
        mockMainWindow as BrowserWindow,
        mockQueueService as IngestionQueueService
      );
      const handler = handlers.get(PDF_INGEST_REQUEST)!;

      await handler(mockEvent, {
        filePaths: ['/path/to/file.pdf']
      });

      // Complete the job
      const completeCallback = eventCallbacks.get('job:complete:job-123');
      completeCallback!({
        id: 'job-123',
        result: { status: 'success' }
      });

      // Should cleanup listeners
      expect(mockQueueService.off).toHaveBeenCalledWith('job:progress:job-123', expect.any(Function));
      expect(mockQueueService.off).toHaveBeenCalledWith('job:error:job-123', expect.any(Function));
      expect(mockQueueService.off).toHaveBeenCalledWith('job:complete:job-123', expect.any(Function));
    });

    it('should handle cancellation', async () => {
      mockQueueService.addJob = vi.fn()
        .mockResolvedValueOnce('job-1')
        .mockResolvedValueOnce('job-2');

      registerPdfIngestionHandler(
        mockIpcMain as IpcMain,
        mockPdfService as PdfIngestionService,
        mockMainWindow as BrowserWindow,
        mockQueueService as IngestionQueueService
      );
      
      const requestHandler = handlers.get(PDF_INGEST_REQUEST)!;
      const cancelHandler = handlers.get(PDF_INGEST_CANCEL)!;

      await requestHandler(mockEvent, {
        filePaths: ['/path/to/file1.pdf', '/path/to/file2.pdf']
      });

      // Cancel during processing
      cancelHandler({}, {});

      expect(logger.info).toHaveBeenCalledWith(
        '[PdfIngestionHandler] Cancellation requested'
      );
    });
  });

  describe('PDF_INGEST_CANCEL handler', () => {
    it('should log cancellation request', () => {
      registerPdfIngestionHandler(
        mockIpcMain as IpcMain,
        mockPdfService as PdfIngestionService,
        mockMainWindow as BrowserWindow,
        mockQueueService as IngestionQueueService
      );
      const handler = handlers.get(PDF_INGEST_CANCEL)!;

      handler({}, {});

      expect(logger.info).toHaveBeenCalledWith(
        '[PdfIngestionHandler] Cancellation requested'
      );
    });
  });

  describe('error handling', () => {
    it('should handle queue service errors', async () => {
      mockQueueService.addJob = vi.fn().mockRejectedValue(new Error('Queue service error'));

      registerPdfIngestionHandler(
        mockIpcMain as IpcMain,
        mockPdfService as PdfIngestionService,
        mockMainWindow as BrowserWindow,
        mockQueueService as IngestionQueueService
      );
      const handler = handlers.get(PDF_INGEST_REQUEST)!;

      await expect(handler(
        { sender: {} },
        { filePaths: ['/path/to/file.pdf'] }
      )).rejects.toThrow('Queue service error');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing PDF ingestion request'),
        expect.any(Error)
      );
    });

    it('should handle unexpected errors in event callbacks', async () => {
      mockQueueService.addJob = vi.fn().mockResolvedValue('job-123');
      mockWebContents.send = vi.fn().mockImplementation(() => {
        throw new Error('Send failed');
      });
      
      const eventCallbacks: Map<string, Function> = new Map();
      mockQueueService.on = vi.fn((event: string, callback: Function) => {
        eventCallbacks.set(event, callback);
      });

      registerPdfIngestionHandler(
        mockIpcMain as IpcMain,
        mockPdfService as PdfIngestionService,
        mockMainWindow as BrowserWindow,
        mockQueueService as IngestionQueueService
      );
      const handler = handlers.get(PDF_INGEST_REQUEST)!;

      await handler({ sender: {} }, { filePaths: ['/path/to/file.pdf'] });

      // Simulate progress event that will fail
      const progressCallback = eventCallbacks.get('job:progress:job-123');
      
      // Should not throw (error is caught internally)
      expect(() => progressCallback!({ id: 'job-123', progress: 50 })).not.toThrow();
    });
  });
});