import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { WebContentsView } from 'electron';
import { EventEmitter } from 'events';
import { ClassicBrowserNavigationService } from '../ClassicBrowserNavigationService';
import { ClassicBrowserViewManager } from '../ClassicBrowserViewManager';
import { ClassicBrowserStateService } from '../ClassicBrowserStateService';

// Mock Electron
vi.mock('electron', () => ({
  WebContentsView: vi.fn()
}));

describe('ClassicBrowserNavigationService', () => {
  let service: ClassicBrowserNavigationService;
  let mockViewManager: ClassicBrowserViewManager;
  let mockStateService: ClassicBrowserStateService;
  let mockEventEmitter: EventEmitter;
  let mockWebContents: any;
  let mockView: WebContentsView;

  beforeEach(() => {
    // Create mock WebContents
    mockWebContents = {
      loadURL: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn(),
      stop: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      navigationHistory: {
        canGoBack: vi.fn().mockReturnValue(false),
        canGoForward: vi.fn().mockReturnValue(false)
      }
    };

    // Create mock WebContentsView
    mockView = {
      webContents: mockWebContents
    } as any;

    // Create mock dependencies
    mockViewManager = {
      getView: vi.fn().mockReturnValue(mockView)
    } as any;

    mockStateService = {
      sendStateUpdate: vi.fn()
    } as any;

    mockEventEmitter = new EventEmitter();

    // Create service instance
    service = new ClassicBrowserNavigationService({
      viewManager: mockViewManager,
      stateService: mockStateService,
      eventEmitter: mockEventEmitter
    });
  });

  afterEach(async () => {
    await service.cleanup();
    vi.clearAllMocks();
  });

  describe('loadUrl', () => {
    it('should load a valid URL', async () => {
      const windowId = 'test-window';
      const url = 'https://example.com';

      await service.loadUrl(windowId, url);

      expect(mockViewManager.getView).toHaveBeenCalledWith(windowId);
      expect(mockWebContents.loadURL).toHaveBeenCalledWith('https://example.com/');
      expect(mockStateService.sendStateUpdate).toHaveBeenCalledWith(windowId, {
        url: 'https://example.com/',
        isLoading: true,
        error: null
      });
    });

    it('should add https:// protocol to URLs without protocol', async () => {
      const windowId = 'test-window';
      const url = 'example.com';
      const expectedUrl = 'https://example.com';

      await service.loadUrl(windowId, url);

      expect(mockWebContents.loadURL).toHaveBeenCalledWith(expectedUrl);
      expect(mockStateService.sendStateUpdate).toHaveBeenCalledWith(windowId, {
        url: expectedUrl,
        isLoading: true,
        error: null
      });
    });

    it('should handle URLs with http:// protocol', async () => {
      const windowId = 'test-window';
      const url = 'http://example.com';

      await service.loadUrl(windowId, url);

      expect(mockWebContents.loadURL).toHaveBeenCalledWith('http://example.com/');
    });

    it('should handle file:// URLs', async () => {
      const windowId = 'test-window';
      const url = 'file:///path/to/file.html';

      await service.loadUrl(windowId, url);

      expect(mockWebContents.loadURL).toHaveBeenCalledWith(url);
    });

    it('should throw error if view not found', async () => {
      const windowId = 'non-existent';
      const url = 'https://example.com';
      mockViewManager.getView = vi.fn().mockReturnValue(null);

      await expect(service.loadUrl(windowId, url)).rejects.toThrow(
        `WebContentsView with ID ${windowId} not found.`
      );
    });

    it('should throw error for invalid URL', async () => {
      const windowId = 'test-window';
      const invalidUrl = '';

      await expect(service.loadUrl(windowId, invalidUrl)).rejects.toThrow(
        'Invalid URL provided.'
      );
    });

    it('should throw error for non-string URL', async () => {
      const windowId = 'test-window';
      const invalidUrl = null as any;

      await expect(service.loadUrl(windowId, invalidUrl)).rejects.toThrow(
        'Invalid URL provided.'
      );
    });

    it('should handle ERR_ABORTED error gracefully', async () => {
      const windowId = 'test-window';
      const url = 'https://example.com';
      const abortedError = new Error('Navigation aborted') as any;
      abortedError.code = 'ERR_ABORTED';
      abortedError.errno = -3;

      mockWebContents.loadURL = vi.fn().mockRejectedValue(abortedError);

      // Should not throw for ERR_ABORTED
      await expect(service.loadUrl(windowId, url)).resolves.toBeUndefined();
    });

    it('should handle other errors and update state', async () => {
      const windowId = 'test-window';
      const url = 'https://example.com';
      const error = new Error('Network error');

      mockWebContents.loadURL = vi.fn().mockRejectedValue(error);

      await expect(service.loadUrl(windowId, url)).rejects.toThrow('Network error');
      
      // Check error state update
      expect(mockStateService.sendStateUpdate).toHaveBeenCalledWith(windowId, {
        isLoading: false,
        error: `Failed to initiate loading for ${url}.`
      });
    });
  });

  describe('navigate', () => {
    it('should navigate back when history allows', () => {
      const windowId = 'test-window';
      mockWebContents.navigationHistory.canGoBack = vi.fn().mockReturnValue(true);

      service.navigate(windowId, 'back');

      expect(mockWebContents.goBack).toHaveBeenCalled();
      expect(mockStateService.sendStateUpdate).toHaveBeenCalledWith(windowId, {
        canGoBack: true,
        canGoForward: false,
        isLoading: false
      });
    });

    it('should not navigate back when no history', () => {
      const windowId = 'test-window';
      mockWebContents.navigationHistory.canGoBack = vi.fn().mockReturnValue(false);

      service.navigate(windowId, 'back');

      expect(mockWebContents.goBack).not.toHaveBeenCalled();
    });

    it('should navigate forward when history allows', () => {
      const windowId = 'test-window';
      mockWebContents.navigationHistory.canGoForward = vi.fn().mockReturnValue(true);

      service.navigate(windowId, 'forward');

      expect(mockWebContents.goForward).toHaveBeenCalled();
    });

    it('should not navigate forward when no forward history', () => {
      const windowId = 'test-window';
      mockWebContents.navigationHistory.canGoForward = vi.fn().mockReturnValue(false);

      service.navigate(windowId, 'forward');

      expect(mockWebContents.goForward).not.toHaveBeenCalled();
    });

    it('should reload the page', () => {
      const windowId = 'test-window';

      service.navigate(windowId, 'reload');

      expect(mockWebContents.reload).toHaveBeenCalled();
      expect(mockStateService.sendStateUpdate).toHaveBeenCalledWith(windowId, {
        canGoBack: false,
        canGoForward: false,
        isLoading: true
      });
    });

    it('should stop loading', () => {
      const windowId = 'test-window';

      service.navigate(windowId, 'stop');

      expect(mockWebContents.stop).toHaveBeenCalled();
    });

    it('should handle invalid action gracefully', () => {
      const windowId = 'test-window';
      
      // Should not throw
      expect(() => service.navigate(windowId, 'invalid' as any)).not.toThrow();
    });

    it('should handle missing view gracefully', () => {
      const windowId = 'non-existent';
      mockViewManager.getView = vi.fn().mockReturnValue(null);

      // Should not throw
      expect(() => service.navigate(windowId, 'back')).not.toThrow();
    });
  });

  describe('isSignificantNavigation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return true for first navigation', async () => {
      const windowId = 'test-window';
      const url = 'https://example.com/page1';

      const result = await service.isSignificantNavigation(windowId, url);

      expect(result).toBe(true);
    });

    it('should return true when base URL changes', async () => {
      const windowId = 'test-window';
      const url1 = 'https://example.com/page1';
      const url2 = 'https://different.com/page2';

      await service.isSignificantNavigation(windowId, url1);
      const result = await service.isSignificantNavigation(windowId, url2);

      expect(result).toBe(true);
    });

    it('should return false for same base URL within time threshold', async () => {
      const windowId = 'test-window';
      const url1 = 'https://example.com/page1';
      const url2 = 'https://example.com/page2';

      await service.isSignificantNavigation(windowId, url1);
      vi.advanceTimersByTime(5000); // 5 seconds
      const result = await service.isSignificantNavigation(windowId, url2);

      expect(result).toBe(false);
    });

    it('should return true after 30 seconds even with same base URL', async () => {
      const windowId = 'test-window';
      const url1 = 'https://example.com/page1';
      const url2 = 'https://example.com/page2';

      await service.isSignificantNavigation(windowId, url1);
      vi.advanceTimersByTime(31000); // 31 seconds
      const result = await service.isSignificantNavigation(windowId, url2);

      expect(result).toBe(true);
    });
  });

  describe('getBaseUrl', () => {
    it('should extract base URL correctly', () => {
      const url = 'https://example.com/path/to/page?query=1';
      const result = service.getBaseUrl(url);
      expect(result).toBe('https://example.com');
    });

    it('should handle URLs with port', () => {
      const url = 'http://localhost:3000/page';
      const result = service.getBaseUrl(url);
      expect(result).toBe('http://localhost');
    });

    it('should handle file URLs', () => {
      const url = 'file:///path/to/file.html';
      const result = service.getBaseUrl(url);
      expect(result).toBe('file://');
    });

    it('should return original URL if parsing fails', () => {
      const invalidUrl = 'not-a-valid-url';
      const result = service.getBaseUrl(invalidUrl);
      expect(result).toBe(invalidUrl);
    });
  });

  describe('clearNavigationTracking', () => {
    it('should clear tracking for specific window', async () => {
      const windowId = 'test-window';
      const url = 'https://example.com';

      // Add tracking
      await service.isSignificantNavigation(windowId, url);
      
      // Clear tracking
      service.clearNavigationTracking(windowId);

      // Next navigation should be significant
      const result = await service.isSignificantNavigation(windowId, url);
      expect(result).toBe(true);
    });
  });

  describe('clearAllNavigationTracking', () => {
    it('should clear all tracking', async () => {
      const windowId1 = 'window1';
      const windowId2 = 'window2';
      const url = 'https://example.com';

      // Add tracking for multiple windows
      await service.isSignificantNavigation(windowId1, url);
      await service.isSignificantNavigation(windowId2, url);
      
      // Clear all tracking
      service.clearAllNavigationTracking();

      // Next navigations should be significant
      const result1 = await service.isSignificantNavigation(windowId1, url);
      const result2 = await service.isSignificantNavigation(windowId2, url);
      
      expect(result1).toBe(true);
      expect(result2).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should clear all navigation tracking on cleanup', async () => {
      const windowId = 'test-window';
      const url = 'https://example.com';

      // Add tracking
      await service.isSignificantNavigation(windowId, url);
      
      // Cleanup
      await service.cleanup();

      // Next navigation should be significant (tracking cleared)
      const result = await service.isSignificantNavigation(windowId, url);
      expect(result).toBe(true);
    });
  });
});