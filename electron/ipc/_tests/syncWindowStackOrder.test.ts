import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ipcMain } from 'electron';
import { registerSyncWindowStackOrderHandler } from '../syncWindowStackOrder';
import { ClassicBrowserService } from '../../../services/browser/ClassicBrowserService';
import { logger } from '../../../utils/logger';
import { SYNC_WINDOW_STACK_ORDER } from '../../../shared/ipcChannels';

// Mock logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('syncWindowStackOrderHandler', () => {
  let mockClassicBrowserService: any;
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock ClassicBrowserService
    mockClassicBrowserService = {
      syncViewStackingOrder: vi.fn(),
    };

    // Register handler and capture the handler function
    registerSyncWindowStackOrderHandler(mockClassicBrowserService as ClassicBrowserService);
    
    // Get the handler that was registered
    expect(ipcMain.handle).toHaveBeenCalledWith(SYNC_WINDOW_STACK_ORDER, expect.any(Function));
    handler = (ipcMain.handle as any).mock.calls[0][1];
  });

  it('should register handler with correct channel', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(SYNC_WINDOW_STACK_ORDER, expect.any(Function));
  });

  it('should sync window stack order successfully', async () => {
    const orderedWindowIds = ['window-1', 'window-2', 'window-3'];
    const mockEvent = {};

    const result = await handler(mockEvent, orderedWindowIds);

    expect(mockClassicBrowserService.syncViewStackingOrder).toHaveBeenCalledWith(orderedWindowIds);
    expect(logger.debug).toHaveBeenCalledWith(
      '[syncWindowStackOrder] Received stack order update:',
      {
        windowCount: 3,
        windowIds: orderedWindowIds,
      }
    );
    expect(logger.debug).toHaveBeenCalledWith(
      '[syncWindowStackOrder] Successfully synced window stack order'
    );
    expect(result).toEqual({ success: true });
  });

  it('should validate input is an array', async () => {
    const mockEvent = {};
    const invalidInput = 'not-an-array';

    await expect(handler(mockEvent, invalidInput)).rejects.toThrow(
      'orderedWindowIds must be an array of window IDs'
    );

    expect(mockClassicBrowserService.syncViewStackingOrder).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[syncWindowStackOrder] Error syncing window stack order:',
      expect.any(Error)
    );
  });

  it('should handle empty array', async () => {
    const orderedWindowIds: string[] = [];
    const mockEvent = {};

    const result = await handler(mockEvent, orderedWindowIds);

    expect(mockClassicBrowserService.syncViewStackingOrder).toHaveBeenCalledWith(orderedWindowIds);
    expect(logger.debug).toHaveBeenCalledWith(
      '[syncWindowStackOrder] Received stack order update:',
      {
        windowCount: 0,
        windowIds: orderedWindowIds,
      }
    );
    expect(result).toEqual({ success: true });
  });

  it('should handle service errors', async () => {
    const orderedWindowIds = ['window-1', 'window-2'];
    const mockEvent = {};
    const error = new Error('Service error');

    mockClassicBrowserService.syncViewStackingOrder.mockImplementation(() => {
      throw error;
    });

    await expect(handler(mockEvent, orderedWindowIds)).rejects.toThrow('Service error');

    expect(logger.error).toHaveBeenCalledWith(
      '[syncWindowStackOrder] Error syncing window stack order:',
      error
    );
  });

  it('should handle null input', async () => {
    const mockEvent = {};

    await expect(handler(mockEvent, null)).rejects.toThrow(
      "Cannot read properties of null (reading 'length')"
    );

    expect(mockClassicBrowserService.syncViewStackingOrder).not.toHaveBeenCalled();
  });

  it('should handle undefined input', async () => {
    const mockEvent = {};

    await expect(handler(mockEvent, undefined)).rejects.toThrow(
      "Cannot read properties of undefined (reading 'length')"
    );

    expect(mockClassicBrowserService.syncViewStackingOrder).not.toHaveBeenCalled();
  });

  it('should handle array with non-string values', async () => {
    const orderedWindowIds = ['window-1', 123, 'window-3', null, undefined];
    const mockEvent = {};

    // The handler doesn't validate individual elements, it passes them through
    const result = await handler(mockEvent, orderedWindowIds);

    expect(mockClassicBrowserService.syncViewStackingOrder).toHaveBeenCalledWith(orderedWindowIds);
    expect(result).toEqual({ success: true });
  });
});