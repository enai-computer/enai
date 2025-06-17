import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserWindow, WebContentsView, BrowserView } from 'electron';
import { ClassicBrowserService } from '../ClassicBrowserService';
import { logger } from '../../utils/logger';

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  WebContentsView: vi.fn(),
  BrowserView: vi.fn(),
}));

describe('ClassicBrowserService', () => {
  let mockMainWindow: any;
  let service: ClassicBrowserService;
  let mockWebContentsViews: Map<string, any>;
  let mockBrowserViews: Map<string, any>;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    mockWebContentsViews = new Map();
    mockBrowserViews = new Map();

    // Mock main window
    mockMainWindow = {
      id: 1,
      webContents: {
        send: vi.fn(),
        id: 100,
      },
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
        children: [],
      },
      contentBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      isDestroyed: vi.fn().mockReturnValue(false),
      getBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 1920, height: 1080 }),
    };

    // Mock BrowserWindow.fromId
    (BrowserWindow as any).fromId = vi.fn().mockReturnValue(mockMainWindow);
    (BrowserWindow as any).fromWebContents = vi.fn().mockReturnValue(mockMainWindow);

    // Create service
    service = new ClassicBrowserService(mockMainWindow);
  });

  afterEach(() => {
    // Clean up
    mockWebContentsViews.clear();
    mockBrowserViews.clear();
  });

  describe('Constructor and BaseService integration', () => {
    it('should initialize with proper main window', () => {
      expect(service).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith('[ClassicBrowserService] Initialized.');
    });

    it('should inherit BaseService functionality', async () => {
      // Test that lifecycle methods are available
      await expect(service.initialize()).resolves.toBeUndefined();
      await expect(service.cleanup()).resolves.toBeUndefined();
      await expect(service.healthCheck()).resolves.toBe(true);
    });
  });

  describe('WebContentsView creation and management', () => {
    it('should create a WebContentsView for a window', async () => {
      const windowId = 'test-window-1';
      const bounds = { x: 100, y: 100, width: 800, height: 600 };
      const initialUrl = 'https://example.com';

      // Mock WebContentsView
      const mockWebContents = {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        getURL: vi.fn().mockReturnValue(initialUrl),
        getTitle: vi.fn().mockReturnValue('Example Site'),
        canGoBack: vi.fn().mockReturnValue(false),
        canGoForward: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        isDestroyed: vi.fn().mockReturnValue(false),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
        },
      };

      const mockView = {
        webContents: mockWebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
        setBackgroundColor: vi.fn(),
      };

      (WebContentsView as any).mockImplementation(() => {
        mockWebContentsViews.set(windowId, mockView);
        return mockView;
      });

      await service.createBrowserView(windowId, bounds, initialUrl);

      // Verify WebContentsView was created with correct config
      expect(WebContentsView).toHaveBeenCalledWith({
        webPreferences: {
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          preload: undefined,
          nodeIntegration: false,
          partition: `persist:browser-${windowId}`,
        },
      });

      // Verify view setup
      expect(mockView.setBounds).toHaveBeenCalledWith(bounds);
      expect(mockView.setVisible).toHaveBeenCalledWith(true);
      expect(mockView.setBorderRadius).toHaveBeenCalledWith(8);
      expect(mockView.setBackgroundColor).toHaveBeenCalledWith('#ffffff');

      // Verify URL loading
      expect(mockWebContents.loadURL).toHaveBeenCalledWith(initialUrl);

      // Verify view was added to window
      expect(mockMainWindow.contentView.addChildView).toHaveBeenCalledWith(mockView);
    });

    it('should handle idempotent creation', async () => {
      const windowId = 'test-window-2';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      const url = 'https://example.com';

      let createCount = 0;
      (WebContentsView as any).mockImplementation(() => {
        createCount++;
        const mockView = {
          webContents: {
            on: vi.fn(),
            setWindowOpenHandler: vi.fn(),
            loadURL: vi.fn().mockResolvedValue(undefined),
            getURL: vi.fn().mockReturnValue(url),
            getTitle: vi.fn().mockReturnValue('Test'),
            canGoBack: vi.fn().mockReturnValue(false),
            canGoForward: vi.fn().mockReturnValue(false),
            isLoading: vi.fn().mockReturnValue(false),
            isDestroyed: vi.fn().mockReturnValue(false),
            executeJavaScript: vi.fn().mockResolvedValue(undefined),
            navigationHistory: {
              canGoBack: vi.fn().mockReturnValue(false),
              canGoForward: vi.fn().mockReturnValue(false),
            },
          },
          setBounds: vi.fn(),
          setVisible: vi.fn(),
          setBorderRadius: vi.fn(),
          setBackgroundColor: vi.fn(),
        };
        mockWebContentsViews.set(windowId, mockView);
        return mockView;
      });

      // Create multiple times
      await service.createBrowserView(windowId, bounds, url);
      await service.createBrowserView(windowId, bounds, url);
      await service.createBrowserView(windowId, bounds, url);

      // Should only create once
      expect(createCount).toBe(1);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining(`View already exists for window ${windowId}`)
      );
    });
  });

  describe('Navigation and state management', () => {
    it('should navigate browser views', async () => {
      const windowId = 'nav-test';
      const mockWebContents = {
        goBack: vi.fn(),
        goForward: vi.fn(),
        reload: vi.fn(),
        canGoBack: vi.fn().mockReturnValue(true),
        canGoForward: vi.fn().mockReturnValue(true),
        isDestroyed: vi.fn().mockReturnValue(false),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(true),
          canGoForward: vi.fn().mockReturnValue(true),
        },
      };

      const mockView = {
        webContents: mockWebContents,
      };

      // Set up the view in the service's map
      (service as any).views.set(windowId, mockView);

      // Test navigation commands
      await service.navigateBrowserView(windowId, 'back');
      expect(mockWebContents.goBack).toHaveBeenCalled();

      await service.navigateBrowserView(windowId, 'forward');
      expect(mockWebContents.goForward).toHaveBeenCalled();

      await service.navigateBrowserView(windowId, 'reload');
      expect(mockWebContents.reload).toHaveBeenCalled();
    });

    it('should get browser state', async () => {
      const windowId = 'state-test';
      const url = 'https://state-test.com';
      const title = 'State Test Page';
      const faviconUrl = 'https://state-test.com/favicon.ico';

      const mockWebContents = {
        getURL: vi.fn().mockReturnValue(url),
        getTitle: vi.fn().mockReturnValue(title),
        canGoBack: vi.fn().mockReturnValue(true),
        canGoForward: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(true),
        isDestroyed: vi.fn().mockReturnValue(false),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(true),
          canGoForward: vi.fn().mockReturnValue(false),
        },
      };

      const mockView = {
        webContents: mockWebContents,
      };

      // Set up the view and favicon
      (service as any).views.set(windowId, mockView);
      (service as any).faviconUrls.set(windowId, faviconUrl);

      const state = await service.getBrowserState(windowId);

      expect(state).toEqual({
        url,
        title,
        canGoBack: true,
        canGoForward: false,
        isLoading: true,
        faviconUrl,
      });
    });

    it('should handle missing browser state', async () => {
      const state = await service.getBrowserState('non-existent');
      expect(state).toBeNull();
    });
  });

  describe('Event handling', () => {
    it('should handle page navigation events', async () => {
      const windowId = 'event-test';
      const eventHandlers: Record<string, Function> = {};

      const mockWebContents = {
        on: vi.fn((event: string, handler: Function) => {
          eventHandlers[event] = handler;
        }),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        getURL: vi.fn().mockReturnValue('https://test.com'),
        getTitle: vi.fn().mockReturnValue('Test'),
        canGoBack: vi.fn().mockReturnValue(false),
        canGoForward: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        isDestroyed: vi.fn().mockReturnValue(false),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
        },
      };

      const mockView = {
        webContents: mockWebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
        setBackgroundColor: vi.fn(),
      };

      (WebContentsView as any).mockImplementation(() => mockView);

      await service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 });

      // Verify event handlers were registered
      expect(mockWebContents.on).toHaveBeenCalledWith('page-title-updated', expect.any(Function));
      expect(mockWebContents.on).toHaveBeenCalledWith('page-favicon-updated', expect.any(Function));
      expect(mockWebContents.on).toHaveBeenCalledWith('did-start-loading', expect.any(Function));
      expect(mockWebContents.on).toHaveBeenCalledWith('did-stop-loading', expect.any(Function));
      expect(mockWebContents.on).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
      expect(mockWebContents.on).toHaveBeenCalledWith('did-fail-load', expect.any(Function));
      expect(mockWebContents.on).toHaveBeenCalledWith('did-navigate', expect.any(Function));
      expect(mockWebContents.on).toHaveBeenCalledWith('did-navigate-in-page', expect.any(Function));
      expect(mockWebContents.on).toHaveBeenCalledWith('render-process-gone', expect.any(Function));

      // Test favicon update
      if (eventHandlers['page-favicon-updated']) {
        eventHandlers['page-favicon-updated']({}, ['https://test.com/favicon.ico']);
        expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
          'ON_CLASSIC_BROWSER_STATE',
          expect.objectContaining({
            windowId,
            state: expect.objectContaining({
              faviconUrl: 'https://test.com/favicon.ico',
            }),
          })
        );
      }
    });

    it('should handle render process crashes', async () => {
      const windowId = 'crash-test';
      const eventHandlers: Record<string, Function> = {};

      const mockWebContents = {
        on: vi.fn((event: string, handler: Function) => {
          eventHandlers[event] = handler;
        }),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn(),
        getURL: vi.fn().mockReturnValue('https://crash.com'),
        getTitle: vi.fn().mockReturnValue('Crash Test'),
        canGoBack: vi.fn().mockReturnValue(false),
        canGoForward: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        isDestroyed: vi.fn().mockReturnValue(false),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
        },
      };

      const mockView = {
        webContents: mockWebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
        setBackgroundColor: vi.fn(),
      };

      (WebContentsView as any).mockImplementation(() => mockView);

      await service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 });

      // Simulate render process crash
      if (eventHandlers['render-process-gone']) {
        eventHandlers['render-process-gone']({}, { reason: 'crashed' });
        
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Render process gone'),
          expect.objectContaining({ reason: 'crashed' })
        );
        expect(mockWebContents.reload).toHaveBeenCalled();
      }
    });
  });

  describe('Cleanup and destruction', () => {
    it('should destroy browser views', async () => {
      const windowId = 'destroy-test';

      const mockWebContents = {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        setAudioMuted: vi.fn(),
        stop: vi.fn(),
        destroy: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
        getURL: vi.fn().mockReturnValue('https://test.com'),
        getTitle: vi.fn().mockReturnValue('Test'),
        canGoBack: vi.fn().mockReturnValue(false),
        canGoForward: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
        },
      };

      const mockView = {
        webContents: mockWebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
        setBackgroundColor: vi.fn(),
      };

      (WebContentsView as any).mockImplementation(() => mockView);
      mockMainWindow.contentView.children.push(mockView);

      await service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 });
      await service.destroyBrowserView(windowId);

      expect(mockWebContents.setAudioMuted).toHaveBeenCalledWith(true);
      expect(mockWebContents.stop).toHaveBeenCalled();
      expect(mockMainWindow.contentView.removeChildView).toHaveBeenCalledWith(mockView);
    });

    it('should clean up all views on service cleanup', async () => {
      // Create multiple views
      const views = [];
      for (let i = 0; i < 3; i++) {
        const mockWebContents = {
          on: vi.fn(),
          setWindowOpenHandler: vi.fn(),
          loadURL: vi.fn().mockResolvedValue(undefined),
          setAudioMuted: vi.fn(),
          stop: vi.fn(),
          destroy: vi.fn(),
          isDestroyed: vi.fn().mockReturnValue(false),
          getURL: vi.fn().mockReturnValue(`https://test${i}.com`),
          getTitle: vi.fn().mockReturnValue(`Test ${i}`),
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
          isLoading: vi.fn().mockReturnValue(false),
          executeJavaScript: vi.fn().mockResolvedValue(undefined),
          navigationHistory: {
            canGoBack: vi.fn().mockReturnValue(false),
            canGoForward: vi.fn().mockReturnValue(false),
          },
        };

        const mockView = {
          webContents: mockWebContents,
          setBounds: vi.fn(),
          setVisible: vi.fn(),
          setBorderRadius: vi.fn(),
          setBackgroundColor: vi.fn(),
        };

        views.push(mockView);
        (WebContentsView as any).mockImplementationOnce(() => mockView);
        mockMainWindow.contentView.children.push(mockView);
      }

      // Create views
      await service.createBrowserView('view-1', { x: 0, y: 0, width: 800, height: 600 });
      await service.createBrowserView('view-2', { x: 0, y: 0, width: 800, height: 600 });
      await service.createBrowserView('view-3', { x: 0, y: 0, width: 800, height: 600 });

      // Clean up service
      await service.cleanup();

      // Verify all views were cleaned up
      views.forEach(view => {
        expect(view.webContents.setAudioMuted).toHaveBeenCalledWith(true);
        expect(view.webContents.stop).toHaveBeenCalled();
        expect(mockMainWindow.contentView.removeChildView).toHaveBeenCalledWith(view);
      });
    });
  });

  describe('BrowserView fallback support', () => {
    it('should fall back to BrowserView if WebContentsView is not available', async () => {
      // Mock WebContentsView to be undefined
      (WebContentsView as any) = undefined;

      const windowId = 'browserView-test';
      const bounds = { x: 100, y: 100, width: 800, height: 600 };

      const mockWebContents = {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        getURL: vi.fn().mockReturnValue('https://browserView.com'),
        getTitle: vi.fn().mockReturnValue('BrowserView Test'),
        canGoBack: vi.fn().mockReturnValue(false),
        canGoForward: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        isDestroyed: vi.fn().mockReturnValue(false),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
      };

      const mockBrowserView = {
        webContents: mockWebContents,
        setBounds: vi.fn(),
        setAutoResize: vi.fn(),
        setBackgroundColor: vi.fn(),
      };

      (BrowserView as any).mockImplementation(() => {
        mockBrowserViews.set(windowId, mockBrowserView);
        return mockBrowserView;
      });

      // Mock BrowserWindow methods for BrowserView
      mockMainWindow.addBrowserView = vi.fn();
      mockMainWindow.removeBrowserView = vi.fn();

      // Create a new service instance to test constructor fallback detection
      const fallbackService = new ClassicBrowserService(mockMainWindow);
      await fallbackService.createBrowserView(windowId, bounds, 'https://browserView.com');

      expect(BrowserView).toHaveBeenCalled();
      expect(mockBrowserView.setBounds).toHaveBeenCalledWith(bounds);
      expect(mockMainWindow.addBrowserView).toHaveBeenCalledWith(mockBrowserView);
    });
  });

  describe('Prefetching', () => {
    it('should prefetch URLs in the background', async () => {
      const url = 'https://prefetch-test.com';
      const mockWebContents = {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        setAudioMuted: vi.fn(),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
      };

      const mockView = {
        webContents: mockWebContents,
        setVisible: vi.fn(),
        setBounds: vi.fn(),
        setBorderRadius: vi.fn(),
        setBackgroundColor: vi.fn(),
      };

      (WebContentsView as any).mockImplementation(() => mockView);

      await service.prefetchUrl(url);

      expect(mockView.setVisible).toHaveBeenCalledWith(false);
      expect(mockView.setBounds).toHaveBeenCalledWith({ x: -9999, y: -9999, width: 1, height: 1 });
      expect(mockWebContents.setAudioMuted).toHaveBeenCalledWith(true);
      expect(mockWebContents.loadURL).toHaveBeenCalledWith(url);
    });
  });

  describe('Security features', () => {
    it('should handle window.open with security restrictions', async () => {
      const windowId = 'security-test';
      let windowOpenHandler: Function | null = null;

      const mockWebContents = {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn((handler: Function) => {
          windowOpenHandler = handler;
        }),
        loadURL: vi.fn().mockResolvedValue(undefined),
        getURL: vi.fn().mockReturnValue('https://security.com'),
        getTitle: vi.fn().mockReturnValue('Security Test'),
        canGoBack: vi.fn().mockReturnValue(false),
        canGoForward: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        isDestroyed: vi.fn().mockReturnValue(false),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
        },
      };

      const mockView = {
        webContents: mockWebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
        setBackgroundColor: vi.fn(),
      };

      (WebContentsView as any).mockImplementation(() => mockView);

      await service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 });

      expect(mockWebContents.setWindowOpenHandler).toHaveBeenCalled();

      // Test window open handler
      if (windowOpenHandler) {
        const result = windowOpenHandler({ url: 'https://popup.com' });
        expect(result).toEqual({ action: 'deny' });
      }
    });
  });

  describe('Ad blocking', () => {
    it('should block known ad URLs', async () => {
      const windowId = 'adblock-test';
      let willNavigateHandler: Function | null = null;

      const mockWebContents = {
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'will-navigate') {
            willNavigateHandler = handler;
          }
        }),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        getURL: vi.fn().mockReturnValue('https://test.com'),
        getTitle: vi.fn().mockReturnValue('Test'),
        canGoBack: vi.fn().mockReturnValue(false),
        canGoForward: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        isDestroyed: vi.fn().mockReturnValue(false),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
        },
      };

      const mockView = {
        webContents: mockWebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
        setBackgroundColor: vi.fn(),
      };

      (WebContentsView as any).mockImplementation(() => mockView);

      await service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 });

      // Test ad blocking
      if (willNavigateHandler) {
        const mockEvent = { preventDefault: vi.fn() };
        
        // Should block ad URL
        willNavigateHandler(mockEvent, 'https://doubleclick.net/ad');
        expect(mockEvent.preventDefault).toHaveBeenCalled();

        // Should allow normal URL
        mockEvent.preventDefault.mockClear();
        willNavigateHandler(mockEvent, 'https://example.com');
        expect(mockEvent.preventDefault).not.toHaveBeenCalled();
      }
    });
  });

  describe('View stacking synchronization', () => {
    it('should synchronize view stacking order', async () => {
      // Create multiple views
      const windowIds = ['window-1', 'window-2', 'window-3'];
      const mockViews: any[] = [];

      for (const windowId of windowIds) {
        const mockWebContents = {
          on: vi.fn(),
          setWindowOpenHandler: vi.fn(),
          loadURL: vi.fn().mockResolvedValue(undefined),
          getURL: vi.fn().mockReturnValue(`https://${windowId}.com`),
          getTitle: vi.fn().mockReturnValue(windowId),
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
          isLoading: vi.fn().mockReturnValue(false),
          isDestroyed: vi.fn().mockReturnValue(false),
          executeJavaScript: vi.fn().mockResolvedValue(undefined),
          navigationHistory: {
            canGoBack: vi.fn().mockReturnValue(false),
            canGoForward: vi.fn().mockReturnValue(false),
          },
        };

        const mockView = {
          webContents: mockWebContents,
          setBounds: vi.fn(),
          setVisible: vi.fn(),
          setBorderRadius: vi.fn(),
          setBackgroundColor: vi.fn(),
          isVisible: vi.fn().mockReturnValue(true),
        };

        mockViews.push(mockView);
        (WebContentsView as any).mockImplementationOnce(() => mockView);
      }

      // Create views
      for (let i = 0; i < windowIds.length; i++) {
        await service.createBrowserView(windowIds[i], { x: 0, y: 0, width: 800, height: 600 });
      }

      // Set up main window children to include views
      mockMainWindow.contentView.children = [...mockViews];
      mockMainWindow.contentView.includes = vi.fn((view) => mockViews.includes(view));

      // Test reordering
      const newOrder = ['window-3', 'window-1', 'window-2'];
      service.syncViewStackingOrder(newOrder);

      // Verify all views were removed first
      expect(mockMainWindow.contentView.removeChildView).toHaveBeenCalledTimes(3);
      for (const view of mockViews) {
        expect(mockMainWindow.contentView.removeChildView).toHaveBeenCalledWith(view);
      }

      // Verify views were re-added in the correct order
      expect(mockMainWindow.contentView.addChildView).toHaveBeenCalledTimes(3);
      expect(mockMainWindow.contentView.addChildView).toHaveBeenNthCalledWith(1, mockViews[2]); // window-3
      expect(mockMainWindow.contentView.addChildView).toHaveBeenNthCalledWith(2, mockViews[0]); // window-1
      expect(mockMainWindow.contentView.addChildView).toHaveBeenNthCalledWith(3, mockViews[1]); // window-2
    });

    it('should handle missing views during sync', async () => {
      // Create only one view
      const mockWebContents = {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        getURL: vi.fn().mockReturnValue('https://test.com'),
        getTitle: vi.fn().mockReturnValue('Test'),
        canGoBack: vi.fn().mockReturnValue(false),
        canGoForward: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        isDestroyed: vi.fn().mockReturnValue(false),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
        },
      };

      const mockView = {
        webContents: mockWebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
        setBackgroundColor: vi.fn(),
        isVisible: vi.fn().mockReturnValue(true),
      };

      (WebContentsView as any).mockImplementation(() => mockView);

      await service.createBrowserView('existing-window', { x: 0, y: 0, width: 800, height: 600 });

      mockMainWindow.contentView.children = [mockView];
      mockMainWindow.contentView.includes = vi.fn((view) => view === mockView);

      // Try to sync with non-existent windows
      service.syncViewStackingOrder(['non-existent-1', 'existing-window', 'non-existent-2']);

      // Should only add the existing view
      expect(mockMainWindow.contentView.addChildView).toHaveBeenCalledTimes(1);
      expect(mockMainWindow.contentView.addChildView).toHaveBeenCalledWith(mockView);
    });

    it('should skip invisible views during sync', async () => {
      // Create a hidden view
      const mockWebContents = {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        getURL: vi.fn().mockReturnValue('https://hidden.com'),
        getTitle: vi.fn().mockReturnValue('Hidden'),
        canGoBack: vi.fn().mockReturnValue(false),
        canGoForward: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        isDestroyed: vi.fn().mockReturnValue(false),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
        },
      };

      const mockView = {
        webContents: mockWebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
        setBackgroundColor: vi.fn(),
        isVisible: vi.fn().mockReturnValue(false), // View is hidden
      };

      (WebContentsView as any).mockImplementation(() => mockView);

      await service.createBrowserView('hidden-window', { x: 0, y: 0, width: 800, height: 600 });

      mockMainWindow.contentView.children = [mockView];
      mockMainWindow.contentView.includes = vi.fn((view) => view === mockView);

      // Sync should skip the hidden view
      service.syncViewStackingOrder(['hidden-window']);

      // Should remove but not re-add the hidden view
      expect(mockMainWindow.contentView.removeChildView).toHaveBeenCalledWith(mockView);
      expect(mockMainWindow.contentView.addChildView).not.toHaveBeenCalled();
    });

    it('should handle destroyed main window gracefully', async () => {
      mockMainWindow.isDestroyed.mockReturnValue(true);

      // Should exit early without throwing
      expect(() => {
        service.syncViewStackingOrder(['window-1', 'window-2']);
      }).not.toThrow();

      expect(mockMainWindow.contentView.removeChildView).not.toHaveBeenCalled();
      expect(mockMainWindow.contentView.addChildView).not.toHaveBeenCalled();
    });

    it('should handle errors during view removal', async () => {
      const mockView = {
        webContents: {
          on: vi.fn(),
          setWindowOpenHandler: vi.fn(),
          loadURL: vi.fn().mockResolvedValue(undefined),
          getURL: vi.fn().mockReturnValue('https://error.com'),
          getTitle: vi.fn().mockReturnValue('Error Test'),
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
          isLoading: vi.fn().mockReturnValue(false),
          isDestroyed: vi.fn().mockReturnValue(false),
          executeJavaScript: vi.fn().mockResolvedValue(undefined),
          navigationHistory: {
            canGoBack: vi.fn().mockReturnValue(false),
            canGoForward: vi.fn().mockReturnValue(false),
          },
        },
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
        setBackgroundColor: vi.fn(),
        isVisible: vi.fn().mockReturnValue(true),
      };

      (WebContentsView as any).mockImplementation(() => mockView);

      await service.createBrowserView('error-window', { x: 0, y: 0, width: 800, height: 600 });

      mockMainWindow.contentView.children = [mockView];
      mockMainWindow.contentView.includes = vi.fn(() => true);
      mockMainWindow.contentView.removeChildView = vi.fn(() => {
        throw new Error('Failed to remove view');
      });

      // Should handle the error and continue
      expect(() => {
        service.syncViewStackingOrder(['error-window']);
      }).not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[syncViewStackingOrder] Error removing view error-window:'),
        expect.any(Error)
      );
    });
  });
});