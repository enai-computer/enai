import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { registerClassicBrowserCreateTab } from '../../../electron/ipc/classicBrowserCreateTab';
import { registerClassicBrowserSwitchTab } from '../../../electron/ipc/classicBrowserSwitchTab';
import { registerClassicBrowserCloseTab } from '../../../electron/ipc/classicBrowserCloseTab';
import { 
  CLASSIC_BROWSER_CREATE_TAB,
  CLASSIC_BROWSER_SWITCH_TAB,
  CLASSIC_BROWSER_CLOSE_TAB
} from '../../../shared/ipcChannels';
import { createMockIpcMain, createMockBrowserWindow } from '../../utils/classicBrowserMocks';
import { logger } from '../../../utils/logger';

// Mock the logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}));

describe('ClassicBrowser IPC Handlers', () => {
  let mockIpcMain: ReturnType<typeof createMockIpcMain>;
  let mockService: ClassicBrowserService;
  let mockEvent: Partial<IpcMainInvokeEvent>;

  beforeEach(() => {
    mockIpcMain = createMockIpcMain();
    mockService = {
      createTab: vi.fn(),
      switchTab: vi.fn(),
      closeTab: vi.fn(),
      createBrowserView: vi.fn(),
      loadUrl: vi.fn(),
      navigate: vi.fn(),
      getBrowserState: vi.fn(),
      setBounds: vi.fn(),
      setVisibility: vi.fn(),
      setBackgroundColor: vi.fn(),
      captureAndHideView: vi.fn(),
      showAndFocusView: vi.fn(),
      destroyBrowserView: vi.fn()
    } as unknown as ClassicBrowserService;
    
    mockEvent = {
      sender: {
        id: 1
      }
    } as Partial<IpcMainInvokeEvent>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('classicBrowserCreateTab Handler', () => {
    beforeEach(() => {
      registerClassicBrowserCreateTab(mockIpcMain as any, mockService);
    });

    it('should successfully create a tab and return tab ID', async () => {
      // Arrange
      const windowId = 'test-window-123';
      const customUrl = 'https://example.com';
      const newTabId = 'new-tab-456';
      (mockService.createTab as any).mockReturnValue(newTabId);

      // Act
      const result = await mockIpcMain.trigger(
        CLASSIC_BROWSER_CREATE_TAB,
        mockEvent,
        windowId,
        customUrl
      );

      // Assert
      expect(mockService.createTab).toHaveBeenCalledWith(windowId, customUrl);
      expect(result).toEqual({ success: true, tabId: newTabId });
      expect(logger.debug).toHaveBeenCalledWith(
        `[registerClassicBrowserCreateTab] Creating new tab for window ${windowId} with URL: ${customUrl}`
      );
    });

    it('should handle undefined URL parameter', async () => {
      // Arrange
      const windowId = 'test-window-123';
      const newTabId = 'new-tab-789';
      (mockService.createTab as any).mockReturnValue(newTabId);

      // Act
      const result = await mockIpcMain.trigger(
        CLASSIC_BROWSER_CREATE_TAB,
        mockEvent,
        windowId,
        undefined
      );

      // Assert
      expect(mockService.createTab).toHaveBeenCalledWith(windowId, undefined);
      expect(result).toEqual({ success: true, tabId: newTabId });
    });

    it('should handle service errors gracefully', async () => {
      // Arrange
      const windowId = 'test-window-123';
      const error = new Error('Window not found');
      (mockService.createTab as any).mockImplementation(() => {
        throw error;
      });

      // Act
      const result = await mockIpcMain.trigger(
        CLASSIC_BROWSER_CREATE_TAB,
        mockEvent,
        windowId
      );

      // Assert
      expect(result).toEqual({ success: false, error: 'Window not found' });
      expect(logger.error).toHaveBeenCalledWith(
        '[registerClassicBrowserCreateTab] Error creating tab:',
        error
      );
    });

    it('should handle non-Error exceptions', async () => {
      // Arrange
      const windowId = 'test-window-123';
      (mockService.createTab as any).mockImplementation(() => {
        throw 'String error';
      });

      // Act
      const result = await mockIpcMain.trigger(
        CLASSIC_BROWSER_CREATE_TAB,
        mockEvent,
        windowId
      );

      // Assert
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  describe('classicBrowserSwitchTab Handler', () => {
    beforeEach(() => {
      registerClassicBrowserSwitchTab(mockIpcMain as any, mockService);
    });

    it('should successfully switch tabs', async () => {
      // Arrange
      const windowId = 'test-window-123';
      const tabId = 'tab-to-switch';

      // Act
      const result = await mockIpcMain.trigger(
        CLASSIC_BROWSER_SWITCH_TAB,
        mockEvent,
        windowId,
        tabId
      );

      // Assert
      expect(mockService.switchTab).toHaveBeenCalledWith(windowId, tabId);
      expect(result).toEqual({ success: true });
      expect(logger.debug).toHaveBeenCalledWith(
        `[registerClassicBrowserSwitchTab] Switching to tab ${tabId} in window ${windowId}`
      );
    });

    it('should handle non-existent tab ID error', async () => {
      // Arrange
      const windowId = 'test-window-123';
      const tabId = 'non-existent-tab';
      const error = new Error('Tab not found');
      (mockService.switchTab as any).mockImplementation(() => {
        throw error;
      });

      // Act
      const result = await mockIpcMain.trigger(
        CLASSIC_BROWSER_SWITCH_TAB,
        mockEvent,
        windowId,
        tabId
      );

      // Assert
      expect(result).toEqual({ success: false, error: 'Tab not found' });
      expect(logger.error).toHaveBeenCalled();
    });

    it('should be idempotent when switching to already active tab', async () => {
      // Arrange
      const windowId = 'test-window-123';
      const tabId = 'already-active-tab';

      // Act
      await mockIpcMain.trigger(
        CLASSIC_BROWSER_SWITCH_TAB,
        mockEvent,
        windowId,
        tabId
      );
      await mockIpcMain.trigger(
        CLASSIC_BROWSER_SWITCH_TAB,
        mockEvent,
        windowId,
        tabId
      );

      // Assert
      expect(mockService.switchTab).toHaveBeenCalledTimes(2);
      expect(mockService.switchTab).toHaveBeenCalledWith(windowId, tabId);
    });
  });

  describe('classicBrowserCloseTab Handler', () => {
    beforeEach(() => {
      registerClassicBrowserCloseTab(mockIpcMain as any, mockService);
    });

    it('should successfully close a tab', async () => {
      // Arrange
      const windowId = 'test-window-123';
      const tabId = 'tab-to-close';

      // Act
      const result = await mockIpcMain.trigger(
        CLASSIC_BROWSER_CLOSE_TAB,
        mockEvent,
        windowId,
        tabId
      );

      // Assert
      expect(mockService.closeTab).toHaveBeenCalledWith(windowId, tabId);
      expect(result).toEqual({ success: true });
      expect(logger.debug).toHaveBeenCalledWith(
        `[registerClassicBrowserCloseTab] Closing tab ${tabId} in window ${windowId}`
      );
    });

    it('should handle last tab replacement gracefully', async () => {
      // Arrange
      const windowId = 'test-window-123';
      const tabId = 'last-tab';
      
      // Service doesn't throw error for last tab, it replaces it
      (mockService.closeTab as any).mockImplementation(() => {
        // No error thrown
      });

      // Act
      const result = await mockIpcMain.trigger(
        CLASSIC_BROWSER_CLOSE_TAB,
        mockEvent,
        windowId,
        tabId
      );

      // Assert
      expect(result).toEqual({ success: true });
      expect(mockService.closeTab).toHaveBeenCalledWith(windowId, tabId);
    });

    it('should handle double-close attempts gracefully', async () => {
      // Arrange
      const windowId = 'test-window-123';
      const tabId = 'tab-to-close';
      
      // First call succeeds, second call throws error
      let callCount = 0;
      (mockService.closeTab as any).mockImplementation(() => {
        callCount++;
        if (callCount > 1) {
          throw new Error('Tab not found');
        }
      });

      // Act
      const result1 = await mockIpcMain.trigger(
        CLASSIC_BROWSER_CLOSE_TAB,
        mockEvent,
        windowId,
        tabId
      );
      const result2 = await mockIpcMain.trigger(
        CLASSIC_BROWSER_CLOSE_TAB,
        mockEvent,
        windowId,
        tabId
      );

      // Assert
      expect(result1).toEqual({ success: true });
      expect(result2).toEqual({ success: false, error: 'Tab not found' });
      expect(mockService.closeTab).toHaveBeenCalledTimes(2);
    });
  });

});