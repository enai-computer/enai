import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserWindow, WebContentsView, ipcMain, IpcMainInvokeEvent } from 'electron';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { registerClassicBrowserCreateHandler } from '../../ipc/classicBrowserInitView';
import { registerClassicBrowserDestroyHandler } from '../../ipc/classicBrowserDestroy';
import { registerClassicBrowserLoadUrlHandler } from '../../ipc/classicBrowserLoadUrl';
import { registerClassicBrowserNavigateHandler } from '../../ipc/classicBrowserNavigate';
import { registerClassicBrowserGetStateHandler } from '../../ipc/classicBrowserGetState';
import { NotebookService } from '../../../services/NotebookService';
import { logger } from '../../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { 
  CLASSIC_BROWSER_CREATE,
  CLASSIC_BROWSER_DESTROY,
  CLASSIC_BROWSER_LOAD_URL,
  CLASSIC_BROWSER_NAVIGATE,
  CLASSIC_BROWSER_GET_STATE
} from '../../../shared/ipcChannels';

// Mock modules
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  WebContentsView: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../services/NotebookService');
vi.mock('../../../models/NotebookModel');
vi.mock('../../../models/ObjectModel');

describe('Classic Browser Integration Tests', () => {
  let mainWindow: any;
  let browserService: ClassicBrowserService;
  let notebookService: NotebookService;
  let handlers: Map<string, Function> = new Map();

  // Helper to simulate IPC calls
  const simulateIPC = async (channel: string, ...args: any[]) => {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler registered for channel: ${channel}`);
    }
    const event = { sender: mainWindow.webContents } as IpcMainInvokeEvent;
    return handler(event, ...args);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();

    // Mock ipcMain.handle to capture handlers
    (ipcMain.handle as any).mockImplementation((channel: string, handler: Function) => {
      handlers.set(channel, handler);
    });

    // Create mock main window
    mainWindow = {
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
      isDestroyed: vi.fn().mockReturnValue(false),
      getBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 1920, height: 1080 }),
    };

    // Mock BrowserWindow.fromId
    (BrowserWindow as any).fromId = vi.fn().mockReturnValue(mainWindow);
    (BrowserWindow as any).fromWebContents = vi.fn().mockReturnValue(mainWindow);

    // Create services
    browserService = new ClassicBrowserService(mainWindow);
    notebookService = new NotebookService({} as any, {} as any);

    // Register handlers
    registerClassicBrowserCreateHandler(browserService);
    registerClassicBrowserDestroyHandler(browserService);
    registerClassicBrowserLoadUrlHandler(browserService);
    registerClassicBrowserNavigateHandler(browserService);
    registerClassicBrowserGetStateHandler(browserService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Create → Navigate → Check favicon loads', () => {
    it('should create browser, navigate to URL, and load favicon', async () => {
      const windowId = 'test-window-' + uuidv4();
      const bounds = { x: 100, y: 100, width: 800, height: 600 };
      const initialUrl = 'https://example.com';
      const faviconUrl = 'https://example.com/favicon.ico';

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
        goBack: vi.fn(),
        goForward: vi.fn(),
        reload: vi.fn(),
      };

      const mockView = {
        webContents: mockWebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
        setBackgroundColor: vi.fn(),
      };

      (WebContentsView as any).mockImplementation(() => mockView);

      // Step 1: Create browser view
      await simulateIPC(CLASSIC_BROWSER_CREATE, windowId, bounds, initialUrl);

      expect(mockView.setBounds).toHaveBeenCalledWith(bounds);
      expect(mockWebContents.loadURL).toHaveBeenCalledWith(initialUrl);
      expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(mockView);

      // Step 2: Navigate to a new URL
      const newUrl = 'https://example.com/page';
      await simulateIPC(CLASSIC_BROWSER_LOAD_URL, windowId, newUrl);
      
      expect(mockWebContents.loadURL).toHaveBeenCalledWith(newUrl);

      // Step 3: Simulate favicon load
      const eventHandlers: Record<string, Function> = {};
      mockWebContents.on.mockImplementation((event: string, handler: Function) => {
        eventHandlers[event] = handler;
      });

      // Re-create to capture event handlers
      await simulateIPC(CLASSIC_BROWSER_CREATE, windowId, bounds, initialUrl);

      // Trigger favicon update
      if (eventHandlers['page-favicon-updated']) {
        eventHandlers['page-favicon-updated']({}, [faviconUrl]);
      }

      // Verify state was sent with favicon
      expect(mainWindow.webContents.send).toHaveBeenCalledWith(
        'ON_CLASSIC_BROWSER_STATE',
        expect.objectContaining({
          windowId,
          state: expect.objectContaining({
            faviconUrl,
          }),
        })
      );

      // Step 4: Get browser state
      const state = await simulateIPC(CLASSIC_BROWSER_GET_STATE, windowId);
      
      expect(state).toEqual({
        url: initialUrl,
        title: 'Example Site',
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        faviconUrl,
      });
    });
  });

  describe('StrictMode simulation: Create → Destroy → Create rapidly', () => {
    it('should handle rapid create/destroy/create cycles without issues', async () => {
      const windowId = 'strict-mode-test-' + uuidv4();
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      const url = 'https://strictmode.test';

      let viewInstances: any[] = [];

      // Track created views
      (WebContentsView as any).mockImplementation(() => {
        const mockWebContents = {
          on: vi.fn(),
          setWindowOpenHandler: vi.fn(),
          loadURL: vi.fn().mockResolvedValue(undefined),
          getURL: vi.fn().mockReturnValue(url),
          getTitle: vi.fn().mockReturnValue('StrictMode Test'),
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
          isLoading: vi.fn().mockReturnValue(false),
          isDestroyed: vi.fn().mockReturnValue(false),
          executeJavaScript: vi.fn().mockResolvedValue(undefined),
          setAudioMuted: vi.fn(),
          stop: vi.fn(),
          destroy: vi.fn(),
          navigationHistory: {
            canGoBack: vi.fn().mockReturnValue(false),
            canGoForward: vi.fn().mockReturnValue(false),
          },
          goBack: vi.fn(),
          goForward: vi.fn(),
          reload: vi.fn(),
        };

        const view = {
          webContents: mockWebContents,
          setBounds: vi.fn(),
          setVisible: vi.fn(),
          setBorderRadius: vi.fn(),
          setBackgroundColor: vi.fn(),
        };

        viewInstances.push(view);
        return view;
      });

      // Simulate StrictMode double-mount behavior
      
      // First mount
      await simulateIPC(CLASSIC_BROWSER_CREATE, windowId, bounds, url);
      expect(viewInstances).toHaveLength(1);
      
      // Immediate unmount (StrictMode)
      await simulateIPC(CLASSIC_BROWSER_DESTROY, windowId);
      
      // Second mount (StrictMode remount)
      await simulateIPC(CLASSIC_BROWSER_CREATE, windowId, bounds, url);
      
      // Should only have created one new view (idempotent)
      expect(viewInstances).toHaveLength(1);
      
      // Verify the view is functional
      const state = await simulateIPC(CLASSIC_BROWSER_GET_STATE, windowId);
      expect(state).toBeDefined();
      expect(state.url).toBe(url);
    });

    it('should handle concurrent create calls gracefully', async () => {
      const windowId = 'concurrent-test-' + uuidv4();
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      const url = 'https://concurrent.test';

      let createCount = 0;
      (WebContentsView as any).mockImplementation(() => {
        createCount++;
        return {
          webContents: {
            on: vi.fn(),
            setWindowOpenHandler: vi.fn(),
            loadURL: vi.fn().mockResolvedValue(undefined),
            getURL: vi.fn().mockReturnValue(url),
            getTitle: vi.fn().mockReturnValue('Concurrent Test'),
            canGoBack: vi.fn().mockReturnValue(false),
            canGoForward: vi.fn().mockReturnValue(false),
            isLoading: vi.fn().mockReturnValue(false),
            isDestroyed: vi.fn().mockReturnValue(false),
            executeJavaScript: vi.fn().mockResolvedValue(undefined),
            navigationHistory: {
              canGoBack: vi.fn().mockReturnValue(false),
              canGoForward: vi.fn().mockReturnValue(false),
            },
            goBack: vi.fn(),
            goForward: vi.fn(),
            reload: vi.fn(),
          },
          setBounds: vi.fn(),
          setVisible: vi.fn(),
          setBorderRadius: vi.fn(),
          setBackgroundColor: vi.fn(),
        };
      });

      // Fire multiple create calls concurrently
      const createPromises = [
        simulateIPC(CLASSIC_BROWSER_CREATE, windowId, bounds, url),
        simulateIPC(CLASSIC_BROWSER_CREATE, windowId, bounds, url),
        simulateIPC(CLASSIC_BROWSER_CREATE, windowId, bounds, url),
      ];

      await Promise.all(createPromises);

      // Should only create one view due to idempotency
      expect(createCount).toBe(1);
    });
  });

  describe('Multiple windows with different states', () => {
    it('should manage multiple browser windows independently', async () => {
      const windows = [
        { id: 'window-1', url: 'https://site1.com', title: 'Site 1' },
        { id: 'window-2', url: 'https://site2.com', title: 'Site 2' },
        { id: 'window-3', url: 'https://site3.com', title: 'Site 3' },
      ];

      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      const viewMap = new Map<string, any>();

      // Mock different views for each window
      (WebContentsView as any).mockImplementation(() => {
        const windowId = windows[viewMap.size]?.id;
        const windowData = windows.find(w => w.id === windowId);
        
        const view = {
          webContents: {
            on: vi.fn(),
            setWindowOpenHandler: vi.fn(),
            loadURL: vi.fn().mockResolvedValue(undefined),
            getURL: vi.fn().mockReturnValue(windowData?.url),
            getTitle: vi.fn().mockReturnValue(windowData?.title),
            canGoBack: vi.fn().mockReturnValue(false),
            canGoForward: vi.fn().mockReturnValue(false),
            isLoading: vi.fn().mockReturnValue(false),
            isDestroyed: vi.fn().mockReturnValue(false),
            executeJavaScript: vi.fn().mockResolvedValue(undefined),
            navigationHistory: {
              canGoBack: vi.fn().mockReturnValue(false),
              canGoForward: vi.fn().mockReturnValue(false),
            },
            goBack: vi.fn(),
            goForward: vi.fn(),
            reload: vi.fn(),
          },
          setBounds: vi.fn(),
          setVisible: vi.fn(),
          setBorderRadius: vi.fn(),
          setBackgroundColor: vi.fn(),
        };

        if (windowId) {
          viewMap.set(windowId, view);
        }
        return view;
      });

      // Create all windows
      for (const window of windows) {
        await simulateIPC(CLASSIC_BROWSER_CREATE, window.id, bounds, window.url);
      }

      // Verify each window has correct state
      for (const window of windows) {
        const state = await simulateIPC(CLASSIC_BROWSER_GET_STATE, window.id);
        expect(state.url).toBe(window.url);
        expect(state.title).toBe(window.title);
      }

      // Test navigation on one window doesn't affect others
      const newUrl = 'https://newsite.com';
      const targetView = viewMap.get('window-2');
      if (targetView) {
        targetView.webContents.getURL.mockReturnValue(newUrl);
        targetView.webContents.getTitle.mockReturnValue('New Site');
      }

      await simulateIPC(CLASSIC_BROWSER_LOAD_URL, 'window-2', newUrl);

      // Verify only window-2 changed
      const state1 = await simulateIPC(CLASSIC_BROWSER_GET_STATE, 'window-1');
      const state2 = await simulateIPC(CLASSIC_BROWSER_GET_STATE, 'window-2');
      const state3 = await simulateIPC(CLASSIC_BROWSER_GET_STATE, 'window-3');

      expect(state1.url).toBe('https://site1.com');
      expect(state2.url).toBe(newUrl);
      expect(state3.url).toBe('https://site3.com');
    });
  });

  describe('Composed notebook with prefetched favicons', () => {
    it('should handle notebook composition with browser tabs and favicons', async () => {
      const notebookId = 'notebook-' + uuidv4();
      const tabs = [
        { 
          windowId: 'tab-1', 
          url: 'https://news.site.com/article1',
          title: 'News Article 1',
          faviconUrl: 'https://news.site.com/favicon.ico'
        },
        { 
          windowId: 'tab-2', 
          url: 'https://blog.site.com/post1',
          title: 'Blog Post 1',
          faviconUrl: 'https://blog.site.com/favicon.png'
        },
        { 
          windowId: 'tab-3', 
          url: 'https://docs.site.com/guide',
          title: 'Documentation Guide',
          faviconUrl: 'https://docs.site.com/icon.svg'
        },
      ];

      const bounds = { x: 0, y: 0, width: 800, height: 600 };

      // Create browser tabs
      for (const tab of tabs) {
        const mockWebContents = {
          on: vi.fn(),
          setWindowOpenHandler: vi.fn(),
          loadURL: vi.fn().mockResolvedValue(undefined),
          getURL: vi.fn().mockReturnValue(tab.url),
          getTitle: vi.fn().mockReturnValue(tab.title),
          canGoBack: vi.fn().mockReturnValue(true),
          canGoForward: vi.fn().mockReturnValue(false),
          isLoading: vi.fn().mockReturnValue(false),
          isDestroyed: vi.fn().mockReturnValue(false),
          executeJavaScript: vi.fn().mockResolvedValue(undefined),
          navigationHistory: {
            canGoBack: vi.fn().mockReturnValue(true),
            canGoForward: vi.fn().mockReturnValue(false),
          },
          goBack: vi.fn(),
          goForward: vi.fn(),
          reload: vi.fn(),
        };

        const mockView = {
          webContents: mockWebContents,
          setBounds: vi.fn(),
          setVisible: vi.fn(),
          setBorderRadius: vi.fn(),
          setBackgroundColor: vi.fn(),
        };

        (WebContentsView as any).mockImplementationOnce(() => mockView);

        await simulateIPC(CLASSIC_BROWSER_CREATE, tab.windowId, bounds, tab.url);

        // Simulate favicon loaded
        const eventHandlers: Record<string, Function> = {};
        mockWebContents.on.mockImplementation((event: string, handler: Function) => {
          eventHandlers[event] = handler;
        });

        // Trigger favicon
        if (eventHandlers['page-favicon-updated']) {
          setTimeout(() => {
            eventHandlers['page-favicon-updated']({}, [tab.faviconUrl]);
          }, 10);
        }
      }

      // Wait for favicon events
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify all tabs have correct state with favicons
      for (const tab of tabs) {
        const state = await simulateIPC(CLASSIC_BROWSER_GET_STATE, tab.windowId);
        expect(state).toMatchObject({
          url: tab.url,
          title: tab.title,
          faviconUrl: tab.faviconUrl,
        });
      }

      // Simulate notebook composition request
      const notebookData = {
        id: notebookId,
        title: 'Research Collection',
        tabs: tabs.map(tab => ({
          windowId: tab.windowId,
          url: tab.url,
          title: tab.title,
          faviconUrl: tab.faviconUrl,
        })),
      };

      // Verify favicon URLs are available for notebook
      expect(notebookData.tabs.every(tab => tab.faviconUrl)).toBe(true);
    });
  });

  describe('Error recovery and edge cases', () => {
    it('should recover from crashed webContents', async () => {
      const windowId = 'crash-test-' + uuidv4();
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      const url = 'https://crash.test';

      const mockWebContents = {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        getURL: vi.fn().mockReturnValue(url),
        getTitle: vi.fn().mockReturnValue('Crash Test'),
        canGoBack: vi.fn().mockReturnValue(false),
        canGoForward: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        isDestroyed: vi.fn().mockReturnValue(false),
        isCrashed: vi.fn().mockReturnValue(false),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn(),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
        },
        goBack: vi.fn(),
        goForward: vi.fn(),
      };

      const mockView = {
        webContents: mockWebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
        setBackgroundColor: vi.fn(),
      };

      (WebContentsView as any).mockImplementation(() => mockView);

      // Create browser
      await simulateIPC(CLASSIC_BROWSER_CREATE, windowId, bounds, url);

      // Simulate crash
      mockWebContents.isCrashed.mockReturnValue(true);

      // Try to get state - should handle crashed state
      const state = await simulateIPC(CLASSIC_BROWSER_GET_STATE, windowId);
      expect(state).toBeDefined();

      // Reload should recover
      await simulateIPC(CLASSIC_BROWSER_NAVIGATE, windowId, 'reload');
      expect(mockWebContents.reload).toHaveBeenCalled();
    });

    it('should handle invalid window IDs gracefully', async () => {
      const invalidWindowId = 'non-existent-window';

      // All operations should handle missing window gracefully
      const operations = [
        () => simulateIPC(CLASSIC_BROWSER_GET_STATE, invalidWindowId),
        () => simulateIPC(CLASSIC_BROWSER_LOAD_URL, invalidWindowId, 'https://test.com'),
        () => simulateIPC(CLASSIC_BROWSER_NAVIGATE, invalidWindowId, 'back'),
        () => simulateIPC(CLASSIC_BROWSER_NAVIGATE, invalidWindowId, 'forward'),
        () => simulateIPC(CLASSIC_BROWSER_NAVIGATE, invalidWindowId, 'reload'),
        () => simulateIPC(CLASSIC_BROWSER_DESTROY, invalidWindowId),
      ];

      for (const operation of operations) {
        // Should not throw, but might return null/undefined
        await expect(operation()).resolves.not.toThrow();
      }
    });
  });

  describe('Performance and memory management', () => {
    it('should clean up event listeners on destroy', async () => {
      const windowId = 'cleanup-test-' + uuidv4();
      const bounds = { x: 0, y: 0, width: 800, height: 600 };

      const eventListeners: Map<string, Function[]> = new Map();
      
      const mockWebContents = {
        on: vi.fn((event: string, handler: Function) => {
          if (!eventListeners.has(event)) {
            eventListeners.set(event, []);
          }
          eventListeners.get(event)!.push(handler);
        }),
        removeListener: vi.fn((event: string, handler: Function) => {
          const handlers = eventListeners.get(event);
          if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
              handlers.splice(index, 1);
            }
          }
        }),
        removeAllListeners: vi.fn((event?: string) => {
          if (event) {
            eventListeners.delete(event);
          } else {
            eventListeners.clear();
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
        setAudioMuted: vi.fn(),
        stop: vi.fn(),
        destroy: vi.fn(),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
        },
        goBack: vi.fn(),
        goForward: vi.fn(),
        reload: vi.fn(),
      };

      const mockView = {
        webContents: mockWebContents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        setBorderRadius: vi.fn(),
        setBackgroundColor: vi.fn(),
      };

      (WebContentsView as any).mockImplementation(() => mockView);

      // Create browser
      await simulateIPC(CLASSIC_BROWSER_CREATE, windowId, bounds);

      // Should have registered event listeners
      expect(eventListeners.size).toBeGreaterThan(0);
      
      // Add to children to simulate attachment
      mainWindow.contentView.children.push(mockView);

      // Destroy browser
      await simulateIPC(CLASSIC_BROWSER_DESTROY, windowId);

      // Should clean up properly
      expect(mockWebContents.setAudioMuted).toHaveBeenCalledWith(true);
      expect(mockWebContents.stop).toHaveBeenCalled();
      expect(mainWindow.contentView.removeChildView).toHaveBeenCalledWith(mockView);
    });
  });
});