import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { WebContentsView } from 'electron';
import { ClassicBrowserService } from '../ClassicBrowserService';
import { ON_CLASSIC_BROWSER_CMD_CLICK, CLASSIC_BROWSER_VIEW_FOCUSED } from '../../shared/ipcChannels';
import { logger } from '../../utils/logger';

// Type definitions
interface MockWebContents {
  on: ReturnType<typeof vi.fn>;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
  executeJavaScript: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  getURL: ReturnType<typeof vi.fn>;
  getTitle: ReturnType<typeof vi.fn>;
  canGoBack: ReturnType<typeof vi.fn>;
  canGoForward: ReturnType<typeof vi.fn>;
  goBack: ReturnType<typeof vi.fn>;
  goForward: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  isLoading: ReturnType<typeof vi.fn>;
  isCrashed: ReturnType<typeof vi.fn>;
  setAudioMuted: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

interface MockView {
  webContents: MockWebContents;
  setBounds: ReturnType<typeof vi.fn>;
  setVisible: ReturnType<typeof vi.fn>;
  setBorderRadius: ReturnType<typeof vi.fn>;
  setBackgroundColor: ReturnType<typeof vi.fn>;
}

interface MockMainWindow {
  webContents: {
    send: ReturnType<typeof vi.fn>;
  };
  contentView: {
    addChildView: ReturnType<typeof vi.fn>;
    removeChildView: ReturnType<typeof vi.fn>;
    children: MockView[];
  };
  isDestroyed: ReturnType<typeof vi.fn>;
}

type EventHandler = (...args: unknown[]) => void;

// Mock Electron modules
vi.mock('electron', () => {
  const mockWebContents = {
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    executeJavaScript: vi.fn(),
    loadURL: vi.fn(),
    getURL: vi.fn(),
    getTitle: vi.fn(),
    canGoBack: vi.fn(),
    canGoForward: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    isDestroyed: vi.fn(),
    isLoading: vi.fn(),
    isCrashed: vi.fn(),
    setAudioMuted: vi.fn(),
  };

  const mockWebContentsView = {
    webContents: mockWebContents,
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    setBorderRadius: vi.fn(),
    setBackgroundColor: vi.fn(),
  };

  const mockBrowserWindow = {
    webContents: {
      send: vi.fn(),
    },
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
      children: [],
    },
    isDestroyed: vi.fn().mockReturnValue(false),
  };

  return {
    BrowserWindow: vi.fn().mockReturnValue(mockBrowserWindow),
    WebContentsView: vi.fn().mockImplementation(() => mockWebContentsView),
    ipcMain: {
      handle: vi.fn(),
    },
  };
});

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock ActivityLogService
vi.mock('../ActivityLogService', () => ({
  getActivityLogService: vi.fn().mockReturnValue({
    logActivity: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('ClassicBrowserService', () => {
  let service: ClassicBrowserService;
  let mockMainWindow: MockMainWindow;
  let mockView: MockView;
  let mockWebContents: MockWebContents;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create fresh mock instances for each test
    mockWebContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined),
      getURL: vi.fn().mockReturnValue('https://example.com'),
      getTitle: vi.fn().mockReturnValue('Test Page'),
      canGoBack: vi.fn().mockReturnValue(false),
      canGoForward: vi.fn().mockReturnValue(false),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      stop: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      isLoading: vi.fn().mockReturnValue(false),
      isCrashed: vi.fn().mockReturnValue(false),
      setAudioMuted: vi.fn(),
      destroy: vi.fn(),
    };

    mockView = {
      webContents: mockWebContents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      setBorderRadius: vi.fn(),
      setBackgroundColor: vi.fn(),
    };

    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
        children: [],
      },
      isDestroyed: vi.fn().mockReturnValue(false),
    };

    // Override WebContentsView constructor to return our mock
    (WebContentsView as unknown as Mock).mockImplementation(() => mockView);
    
    // Create service with mocked window
    service = new ClassicBrowserService(mockMainWindow as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('CMD+click interceptor script injection', () => {
    it('should inject CMD+click interceptor script on dom-ready', async () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      // Setup event handler captures
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      mockWebContents.executeJavaScript.mockResolvedValue(undefined);
      
      // Create browser view
      service.createBrowserView(windowId, bounds);
      
      // Simulate dom-ready event
      await eventHandlers['dom-ready']?.();
      
      // Verify script injection
      expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining("document.addEventListener('click'")
      );
      
      // Verify the script contains CMD+click handling logic
      const injectedScript = mockWebContents.executeJavaScript.mock.calls[0][0];
      expect(injectedScript).toContain('event.metaKey || event.ctrlKey');
      expect(injectedScript).toContain('event.preventDefault()');
      expect(injectedScript).toContain('jeffers-ipc://cmd-click/');
      expect(injectedScript).toContain('encodeURIComponent(targetUrl)');
    });

    it('should handle script injection errors gracefully', async () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      // Mock script injection failure
      mockWebContents.executeJavaScript.mockRejectedValue(new Error('Injection failed'));
      
      service.createBrowserView(windowId, bounds);
      
      // Simulate dom-ready event
      await eventHandlers['dom-ready']?.();
      
      // Verify error was logged
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to inject CMD+click interceptor script'),
        expect.any(Error)
      );
    });
  });

  describe('CMD+click IPC communication', () => {
    it('should send IPC message on CMD+click via custom protocol', () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      const targetUrl = 'https://example.com/article';
      
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      service.createBrowserView(windowId, bounds);
      
      // Create mock event
      const mockEvent = { preventDefault: vi.fn() };
      
      // Simulate will-navigate with custom protocol
      const customProtocolUrl = `jeffers-ipc://cmd-click/${encodeURIComponent(targetUrl)}`;
      eventHandlers['will-navigate']?.(mockEvent, customProtocolUrl);
      
      // Verify event was prevented
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      
      // Verify IPC message was sent
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_CMD_CLICK,
        {
          sourceWindowId: windowId,
          targetUrl: targetUrl,
        }
      );
    });

    it('should handle malformed custom protocol URLs', () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      service.createBrowserView(windowId, bounds);
      
      const mockEvent = { preventDefault: vi.fn() };
      
      // Simulate will-navigate with malformed URL
      const malformedUrl = 'jeffers-ipc://cmd-click/%INVALID%';
      eventHandlers['will-navigate']?.(mockEvent, malformedUrl);
      
      // Verify error was logged
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to decode CMD+click IPC URL'),
        expect.any(Error)
      );
      
      // IPC should not be sent
      expect(mockMainWindow.webContents.send).not.toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_CMD_CLICK,
        expect.anything()
      );
    });
  });

  describe('Regular clicks', () => {
    it('should not trigger IPC for regular navigation', () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      const regularUrl = 'https://example.com/page';
      
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      service.createBrowserView(windowId, bounds);
      
      const mockEvent = { preventDefault: vi.fn() };
      
      // Simulate regular navigation
      eventHandlers['will-navigate']?.(mockEvent, regularUrl);
      
      // Event should not be prevented for regular navigation
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
      
      // IPC should not be sent
      expect(mockMainWindow.webContents.send).not.toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_CMD_CLICK,
        expect.anything()
      );
    });
  });

  describe('setWindowOpenHandler', () => {
    it('should handle CMD+click via setWindowOpenHandler for new window requests', () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      const targetUrl = 'https://example.com/new-page';
      
      let windowOpenHandler: EventHandler | undefined;
      mockWebContents.setWindowOpenHandler.mockImplementation((handler: EventHandler) => {
        windowOpenHandler = handler;
      });
      
      service.createBrowserView(windowId, bounds);
      
      // Verify handler was set
      expect(mockWebContents.setWindowOpenHandler).toHaveBeenCalled();
      
      // Test new window request (CMD+click behavior)
      const result = windowOpenHandler?.({
        url: targetUrl,
        disposition: 'foreground-tab',
        features: '',
        postBody: null,
        referrer: { url: '', policy: 'default' }
      });
      
      // Verify IPC was sent
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_CMD_CLICK,
        {
          sourceWindowId: windowId,
          targetUrl: targetUrl,
        }
      );
      
      // Verify window creation was denied
      expect(result).toEqual({ action: 'deny' });
    });

    it('should handle background-tab disposition as CMD+click', () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      const targetUrl = 'https://example.com/background';
      
      let windowOpenHandler: EventHandler | undefined;
      mockWebContents.setWindowOpenHandler.mockImplementation((handler: EventHandler) => {
        windowOpenHandler = handler;
      });
      
      service.createBrowserView(windowId, bounds);
      
      const result = windowOpenHandler?.({
        url: targetUrl,
        disposition: 'background-tab',
        features: '',
        postBody: null,
        referrer: { url: '', policy: 'default' }
      });
      
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_CMD_CLICK,
        {
          sourceWindowId: windowId,
          targetUrl: targetUrl,
        }
      );
      
      expect(result).toEqual({ action: 'deny' });
    });

    it('should navigate in same window for regular link clicks', () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      const targetUrl = 'https://example.com/regular-link';
      
      let windowOpenHandler: EventHandler | undefined;
      mockWebContents.setWindowOpenHandler.mockImplementation((handler: EventHandler) => {
        windowOpenHandler = handler;
      });
      
      // Mock loadUrl method
      const loadUrlSpy = vi.spyOn(service, 'loadUrl').mockResolvedValue(undefined);
      
      service.createBrowserView(windowId, bounds);
      
      const result = windowOpenHandler?.({
        url: targetUrl,
        disposition: 'current-tab',
        features: '',
        postBody: null,
        referrer: { url: '', policy: 'default' }
      });
      
      // Should not send CMD+click IPC
      expect(mockMainWindow.webContents.send).not.toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_CMD_CLICK,
        expect.anything()
      );
      
      // Should navigate in same window
      expect(loadUrlSpy).toHaveBeenCalledWith(windowId, targetUrl);
      
      expect(result).toEqual({ action: 'deny' });
    });
  });

  describe('Edge cases', () => {
    it('should handle links without href gracefully', async () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      mockWebContents.executeJavaScript.mockResolvedValue(undefined);
      
      service.createBrowserView(windowId, bounds);
      
      // The injected script should handle clicks on elements without href
      await eventHandlers['dom-ready']?.();
      
      const injectedScript = mockWebContents.executeJavaScript.mock.calls[0][0];
      
      // Verify script checks for href existence
      expect(injectedScript).toContain('if (targetUrl)');
      expect(injectedScript).toContain('link.href');
    });

    it('should handle dynamically added links via event delegation', async () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      mockWebContents.executeJavaScript.mockResolvedValue(undefined);
      
      service.createBrowserView(windowId, bounds);
      
      await eventHandlers['dom-ready']?.();
      
      const injectedScript = mockWebContents.executeJavaScript.mock.calls[0][0];
      
      // Verify script uses event delegation on document
      expect(injectedScript).toContain("document.addEventListener('click'");
      expect(injectedScript).toContain("event.target.closest('a')");
      expect(injectedScript).toContain("true"); // Capture phase
    });

    it('should handle destroyed main window gracefully', () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      const targetUrl = 'https://example.com/test';
      
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      // Create browser view first while window is not destroyed
      service.createBrowserView(windowId, bounds);
      
      // Now mock the window as destroyed
      mockMainWindow.isDestroyed.mockReturnValue(true);
      
      const mockEvent = { preventDefault: vi.fn() };
      
      // Try to send CMD+click IPC with destroyed window
      const customProtocolUrl = `jeffers-ipc://cmd-click/${encodeURIComponent(targetUrl)}`;
      eventHandlers['will-navigate']?.(mockEvent, customProtocolUrl);
      
      // Should not throw error
      expect(() => eventHandlers['will-navigate']?.(mockEvent, customProtocolUrl)).not.toThrow();
      
      // IPC should not be sent
      expect(mockMainWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('should handle iframe navigation attempts', () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      service.createBrowserView(windowId, bounds);
      
      // Mock iframe webContents
      const mockIframeWebContents = {
        setWindowOpenHandler: vi.fn(),
      };
      
      // Simulate iframe attachment
      eventHandlers['did-attach-webview']?.({}, mockIframeWebContents);
      
      // Verify handler was set on iframe
      expect(mockIframeWebContents.setWindowOpenHandler).toHaveBeenCalled();
      
      // Test iframe window open attempt
      let iframeWindowOpenHandler: EventHandler | undefined;
      mockIframeWebContents.setWindowOpenHandler.mockImplementation((handler: EventHandler) => {
        iframeWindowOpenHandler = handler;
      });
      
      // Re-run to capture handler
      eventHandlers['did-attach-webview']?.({}, mockIframeWebContents);
      
      const loadUrlSpy = vi.spyOn(service, 'loadUrl').mockResolvedValue(undefined);
      
      const result = iframeWindowOpenHandler?.({
        url: 'https://example.com/iframe-link',
        disposition: 'new-window',
      });
      
      // Should navigate in parent window
      expect(loadUrlSpy).toHaveBeenCalledWith(windowId, 'https://example.com/iframe-link');
      expect(result).toEqual({ action: 'deny' });
    });
  });

  describe('Focus handling', () => {
    it('should bring view to front and notify renderer on focus', () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      service.createBrowserView(windowId, bounds);
      
      // Add view to children array to simulate it being attached
      mockMainWindow.contentView.children.push(mockView);
      
      // Simulate focus event
      eventHandlers['focus']?.();
      
      // Verify view was re-added (brings to front)
      expect(mockMainWindow.contentView.addChildView).toHaveBeenCalledWith(mockView);
      
      // Verify renderer was notified
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        CLASSIC_BROWSER_VIEW_FOCUSED,
        { windowId }
      );
    });
  });

  describe('Cleanup and teardown', () => {
    it('should properly clean up on destroy', async () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      service.createBrowserView(windowId, bounds);
      
      // Verify view was created
      expect(service.getView(windowId)).toBeDefined();
      
      // Mock webContents state
      mockWebContents.isDestroyed.mockReturnValue(false);
      mockWebContents.isLoading.mockReturnValue(false);
      mockWebContents.isCrashed.mockReturnValue(false);
      
      // Add view to children
      mockMainWindow.contentView.children.push(mockView);
      
      await service.destroyBrowserView(windowId);
      
      // Verify cleanup
      expect(mockWebContents.setAudioMuted).toHaveBeenCalledWith(true);
      expect(mockWebContents.stop).toHaveBeenCalled();
      expect(mockMainWindow.contentView.removeChildView).toHaveBeenCalledWith(mockView);
      
      // Verify view was removed from service
      expect(service.getView(windowId)).toBeUndefined();
    });

    it('should handle multiple concurrent destroy calls', async () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      service.createBrowserView(windowId, bounds);
      
      // Call destroy multiple times concurrently
      const destroyPromises = [
        service.destroyBrowserView(windowId),
        service.destroyBrowserView(windowId),
        service.destroyBrowserView(windowId),
      ];
      
      await Promise.all(destroyPromises);
      
      // Should handle gracefully without errors
      // First call should succeed, second and third should log warnings
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No WebContentsView found')
      );
    });
  });

  describe('Additional CMD+click edge cases', () => {
    it('should handle clicks on nested elements within links', async () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      mockWebContents.executeJavaScript.mockResolvedValue(undefined);
      
      service.createBrowserView(windowId, bounds);
      
      // Simulate dom-ready event
      await eventHandlers['dom-ready']?.();
      
      const injectedScript = mockWebContents.executeJavaScript.mock.calls[0][0];
      
      // Verify script uses closest() to find parent <a> tag
      expect(injectedScript).toContain("event.target.closest('a')");
      expect(injectedScript).toContain('const link = event.target.closest');
    });

    it('should not interfere with regular form submissions', () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      service.createBrowserView(windowId, bounds);
      
      const mockEvent = { preventDefault: vi.fn() };
      
      // Simulate form submission URL
      const formSubmitUrl = 'https://example.com/submit';
      eventHandlers['will-navigate']?.(mockEvent, formSubmitUrl);
      
      // Should not prevent default for regular navigation
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
      
      // Should not send CMD+click IPC
      expect(mockMainWindow.webContents.send).not.toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_CMD_CLICK,
        expect.anything()
      );
    });

    it('should handle CMD+click on javascript: URLs', () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      service.createBrowserView(windowId, bounds);
      
      const mockEvent = { preventDefault: vi.fn() };
      
      // Simulate CMD+click with javascript: URL
      const jsUrl = `jeffers-ipc://cmd-click/${encodeURIComponent('javascript:void(0)')}`;
      eventHandlers['will-navigate']?.(mockEvent, jsUrl);
      
      // Should prevent default
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      
      // Should send IPC even for javascript: URLs
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_CMD_CLICK,
        {
          sourceWindowId: windowId,
          targetUrl: 'javascript:void(0)',
        }
      );
    });

    it('should handle rapid consecutive CMD+clicks', () => {
      const windowId = 'test-window';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      const eventHandlers: Record<string, EventHandler> = {};
      mockWebContents.on.mockImplementation((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      });
      
      service.createBrowserView(windowId, bounds);
      
      const mockEvent = { preventDefault: vi.fn() };
      
      // Simulate rapid CMD+clicks
      const urls = [
        'https://example.com/1',
        'https://example.com/2',
        'https://example.com/3',
      ];
      
      urls.forEach((url) => {
        const customProtocolUrl = `jeffers-ipc://cmd-click/${encodeURIComponent(url)}`;
        eventHandlers['will-navigate']?.(mockEvent, customProtocolUrl);
      });
      
      // All clicks should be processed
      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(3);
      expect(mockMainWindow.webContents.send).toHaveBeenCalledTimes(3);
      
      // Verify each URL was sent
      urls.forEach((url, index) => {
        expect(mockMainWindow.webContents.send).toHaveBeenNthCalledWith(
          index + 1,
          ON_CLASSIC_BROWSER_CMD_CLICK,
          {
            sourceWindowId: windowId,
            targetUrl: url,
          }
        );
      });
    });
  });
});