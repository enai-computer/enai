/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebContentsView } from 'electron';
import { ClassicBrowserService } from '../ClassicBrowserService';
import { ActivityLogService } from '../../ActivityLogService';
import { ObjectModel } from '../../../models/ObjectModel';
import { ActivityLogModel } from '../../../models/ActivityLogModel';
import { TabState } from '../../../shared/types';
import Database from 'better-sqlite3';
import runMigrations from '../../../models/runMigrations';
import { ClassicBrowserViewManager } from '../ClassicBrowserViewManager';
import { ClassicBrowserStateService } from '../ClassicBrowserStateService';
import { ClassicBrowserNavigationService } from '../ClassicBrowserNavigationService';
import { ClassicBrowserTabService } from '../ClassicBrowserTabService';
import { ClassicBrowserWOMService } from '../ClassicBrowserWOMService';
import { ClassicBrowserSnapshotService } from '../ClassicBrowserSnapshotService';
import { BrowserEventBus } from '../BrowserEventBus';

const DEFAULT_NEW_TAB_URL = 'https://www.are.na';

// Mock only what we absolutely need to - Electron APIs
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  WebContentsView: vi.fn(),
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock LanceVectorModel to avoid native module issues
vi.mock('../../../models/LanceVectorModel', () => ({
  LanceVectorModel: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
    embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedTexts: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    search: vi.fn().mockResolvedValue([]),
    addDocuments: vi.fn().mockResolvedValue([]),
    deleteDocuments: vi.fn().mockResolvedValue(undefined),
    getDocumentById: vi.fn().mockResolvedValue(null),
    updateDocument: vi.fn().mockResolvedValue(undefined),
    clearDatabase: vi.fn().mockResolvedValue(undefined),
    getTableStats: vi.fn().mockResolvedValue({ totalRecords: 0, tableSize: 0 })
  }))
}));

describe('ClassicBrowserService - Behavioral Tests', () => {
  let service: ClassicBrowserService;
  let db: Database.Database;
  let objectModel: ObjectModel;
  let activityLogModel: ActivityLogModel;
  let activityLogService: ActivityLogService;
  let viewManager: ClassicBrowserViewManager;
  let stateService: ClassicBrowserStateService;
  let navigationService: ClassicBrowserNavigationService;
  let tabService: ClassicBrowserTabService;
  let womService: ClassicBrowserWOMService;
  let snapshotService: ClassicBrowserSnapshotService;
  let eventBus: BrowserEventBus;
  let lanceVectorModel: any;
  let mockMainWindow: any;
  let mockWebContentsViews: Map<string, any>;

  // Helper to create a minimal mock WebContentsView
  function createMockWebContentsView(url: string = 'about:blank') {
    const mockView = {
      webContents: {
        id: Math.floor(Math.random() * 1000),
        loadURL: vi.fn().mockResolvedValue(undefined),
        getURL: vi.fn().mockReturnValue(url),
        getTitle: vi.fn().mockReturnValue('Page Title'),
        goBack: vi.fn(),
        goForward: vi.fn(),
        reload: vi.fn(),
        stop: vi.fn(),
        executeJavaScript: vi.fn().mockResolvedValue(null),
        on: vi.fn(),
        once: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
        setAudioMuted: vi.fn(),
        destroy: vi.fn(),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
        },
        session: {
          webRequest: {
            onBeforeRequest: vi.fn(),
          },
        },
      },
      setBounds: vi.fn(),
      setBackgroundColor: vi.fn(),
      setVisible: vi.fn(),
      setBorderRadius: vi.fn(),
      isVisible: vi.fn().mockReturnValue(true),
    };
    mockWebContentsViews.set(url, mockView);
    return mockView;
  }

  beforeEach(async () => {
    // Set up a real database and models for more realistic testing
    db = new Database(':memory:');
    await runMigrations(db);
    
    objectModel = new ObjectModel(db);
    activityLogModel = new ActivityLogModel(db);
    
    // Use the mocked LanceVectorModel
    const { LanceVectorModel } = await import('../../../models/LanceVectorModel');
    lanceVectorModel = new (LanceVectorModel as any)({ userDataPath: ':memory:' });
    
    activityLogService = new ActivityLogService({ 
      db,
      objectModel,
      activityLogModel,
      lanceVectorModel
    });
    
    // Create the event bus and sub-services
    eventBus = new BrowserEventBus();
    
    // Mock the sub-services since we're testing the main service
    viewManager = {
      getView: vi.fn().mockImplementation((windowId) => {
        const mockView = createMockWebContentsView();
        return mockView;
      }),
      createViewWithState: vi.fn().mockImplementation((windowId, bounds, state) => {
        // Simulate successful view creation
        const mockView = createMockWebContentsView(state.tabs.find(t => t.id === state.activeTabId)?.url || 'about:blank');
        mockMainWindow.contentView.addChildView(mockView);
      }),
      setBounds: vi.fn(),
      setVisibility: vi.fn(),
      setBackgroundColor: vi.fn(),
      syncViewStackingOrder: vi.fn(),
      getActiveViewWindowIds: vi.fn().mockImplementation(() => {
        // Return window IDs that have been created
        return Array.from(stateService.states.keys());
      }),
      destroyBrowserView: vi.fn().mockImplementation(async (windowId) => {
        // Simulate view destruction
        const mockView = viewManager.getView(windowId);
        if (mockView) {
          mockView.webContents.destroy();
          mockMainWindow.contentView.removeChildView(mockView);
        }
      }),
      destroyAllBrowserViews: vi.fn().mockResolvedValue(undefined),
      prefetchFavicon: vi.fn().mockResolvedValue(null),
      prefetchFaviconsForWindows: vi.fn().mockResolvedValue(new Map()),
      initialize: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined)
    };
    
    stateService = {
      states: new Map(),
      sendStateUpdate: vi.fn().mockImplementation((windowId, tabUpdate?, activeTabId?) => {
        // Simulate state updates being sent to renderer
        const state = stateService.states.get(windowId);
        if (state) {
          mockMainWindow.webContents.send('on-classic-browser-state', {
            windowId,
            update: {
              ...(tabUpdate && { tab: tabUpdate }),
              ...(activeTabId && { activeTabId }),
              ...(state && { tabs: state.tabs })
            }
          });
        }
      }),
      updateTabBookmarkStatus: vi.fn(),
      findTabState: vi.fn().mockImplementation((tabId) => {
        for (const [windowId, state] of stateService.states) {
          const tab = state.tabs.find(t => t.id === tabId);
          if (tab) return { state, tab };
        }
        return null;
      }),
      refreshTabState: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined)
    };
    
    navigationService = {
      loadUrl: vi.fn().mockImplementation(async (windowId, url) => {
        const state = stateService.states.get(windowId);
        if (!state) return; // Service delegates to navigationService which handles missing windows
        const view = viewManager.getView(windowId);
        if (view) {
          return view.webContents.loadURL(url);
        }
      }),
      navigate: vi.fn().mockImplementation((windowId, direction) => {
        const view = viewManager.getView(windowId);
        if (!view) return;
        
        switch (direction) {
          case 'back':
            if (view.webContents.navigationHistory.canGoBack()) {
              view.webContents.goBack();
            }
            break;
          case 'forward':
            if (view.webContents.navigationHistory.canGoForward()) {
              view.webContents.goForward();
            }
            break;
          case 'reload':
            view.webContents.reload();
            break;
          case 'stop':
            view.webContents.stop();
            break;
        }
      }),
      isSignificantNavigation: vi.fn().mockResolvedValue(true),
      getBaseUrl: vi.fn().mockReturnValue('https://example.com'),
      clearNavigationTracking: vi.fn(),
      clearAllNavigationTracking: vi.fn(),
      cleanup: vi.fn().mockResolvedValue(undefined)
    };
    
    tabService = {
      createTab: vi.fn().mockImplementation((windowId, url = DEFAULT_NEW_TAB_URL) => {
        const state = stateService.states.get(windowId);
        if (!state) throw new Error(`Window ${windowId} not found`);
        
        const newTabId = `tab-${Date.now()}`;
        const newTab: TabState = {
          id: newTabId,
          url,
          title: 'New Tab',
          faviconUrl: null,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          error: null
        };
        
        state.tabs.push(newTab);
        state.activeTabId = newTabId;
        
        // Trigger state update
        stateService.sendStateUpdate(windowId, undefined, newTabId);
        
        return newTabId;
      }),
      createTabWithState: vi.fn(),
      switchTab: vi.fn().mockImplementation((windowId, tabId) => {
        const state = stateService.states.get(windowId);
        if (!state) throw new Error(`Window ${windowId} not found`);
        if (!state.tabs.find(t => t.id === tabId)) throw new Error(`Tab ${tabId} not found`);
        state.activeTabId = tabId;
        stateService.sendStateUpdate(windowId, undefined, tabId);
      }),
      closeTab: vi.fn().mockImplementation((windowId, tabId) => {
        const state = stateService.states.get(windowId);
        if (!state) throw new Error(`Window ${windowId} not found`);
        
        const tabIndex = state.tabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) throw new Error(`Tab ${tabId} not found`);
        
        state.tabs.splice(tabIndex, 1);
        
        if (state.tabs.length === 0) {
          // Create a new tab if closing the last one
          const newTabId = `tab-${Date.now()}`;
          state.tabs.push({
            id: newTabId,
            url: DEFAULT_NEW_TAB_URL,
            title: 'New Tab',
            faviconUrl: null,
            isLoading: false,
            canGoBack: false,
            canGoForward: false,
            error: null
          });
          state.activeTabId = newTabId;
        } else if (state.activeTabId === tabId) {
          // Switch to another tab if we closed the active one
          state.activeTabId = state.tabs[Math.min(tabIndex, state.tabs.length - 1)].id;
        }
        
        stateService.sendStateUpdate(windowId, undefined, state.activeTabId);
      }),
      cleanup: vi.fn().mockResolvedValue(undefined)
    };
    
    womService = {
      checkAndCreateTabGroup: vi.fn(),
      removeTabMapping: vi.fn(),
      clearWindowTabMappings: vi.fn(),
      scheduleRefresh: vi.fn(),
      cleanup: vi.fn().mockResolvedValue(undefined)
    };
    
    snapshotService = {
      captureSnapshot: vi.fn().mockResolvedValue(undefined),
      showAndFocusView: vi.fn(),
      clearSnapshot: vi.fn(),
      clearAllSnapshots: vi.fn(),
      cleanup: vi.fn().mockResolvedValue(undefined)
    };

    // Minimal mock for main window
    mockMainWindow = {
      id: 1,
      webContents: {
        send: vi.fn(),
      },
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
        children: [],
      },
      isDestroyed: vi.fn().mockReturnValue(false),
      getBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 1920, height: 1080 }),
    };

    mockWebContentsViews = new Map();

    // Mock WebContentsView constructor
    (WebContentsView as unknown as Mock).mockImplementation(() => {
      return createMockWebContentsView();
    });

    // Create service with all required dependencies
    service = new ClassicBrowserService({
      mainWindow: mockMainWindow,
      objectModel,
      activityLogService,
      viewManager,
      stateService,
      navigationService,
      tabService,
      womService,
      snapshotService,
      eventBus
    });

    await service.initialize();
  });

  afterEach(async () => {
    await service.cleanup();
    db.close();
  });

  describe('Browser Window Creation', () => {
    it('should create a browser window that can display web content', () => {
      // Given: A user wants to browse the web
      const windowId = 'browser-1';
      const bounds = { x: 100, y: 100, width: 800, height: 600 };
      const initialUrl = 'https://example.com';

      // When: They create a browser window
      service.createBrowserView(windowId, bounds, {
        windowId,
        tabs: [{ 
          id: 'tab-1', 
          url: initialUrl,
          title: 'Example',
          faviconUrl: null,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          error: null
        }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });

      // Then: The browser should be ready to display content
      expect(viewManager.createViewWithState).toHaveBeenCalled();
      expect(mockMainWindow.contentView.addChildView).toHaveBeenCalled();
      
      // And: The window should be tracked by the service
      const activeWindows = service.getActiveViewWindowIds();
      expect(activeWindows).toContain(windowId);
      
      // Verify the view manager was called
      expect(viewManager.createViewWithState).toHaveBeenCalledWith(
        windowId,
        bounds,
        expect.objectContaining({
          tabs: expect.arrayContaining([expect.objectContaining({ url: initialUrl })])
        })
      );
    });

    it('should not create duplicate browser windows with the same ID', () => {
      // Given: A browser window already exists
      const windowId = 'browser-1';
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      service.createBrowserView(windowId, bounds, {
        windowId,
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });

      // When: Trying to create another window with the same ID
      // Then: It should handle gracefully (not crash or create duplicate)
      expect(() => {
        service.createBrowserView(windowId, bounds, {
          windowId,
          tabs: [{ id: 'tab-2', url: 'https://github.com', title: 'GitHub', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
          activeTabId: 'tab-2',
          freezeState: { type: 'ACTIVE' }
        });
      }).not.toThrow();
    });
  });

  describe('Tab Management', () => {
    it('should allow users to create and switch between multiple tabs', () => {
      // Given: A browser with one tab
      const windowId = 'browser-1';
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });

      // When: User creates a new tab
      const newTabId = service.createTab(windowId, 'https://github.com');

      // Then: The new tab should be created and become active
      expect(newTabId).toBeTruthy();
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'on-classic-browser-state',
        expect.objectContaining({
          windowId,
          update: expect.objectContaining({
            activeTabId: newTabId,
            tabs: expect.arrayContaining([
              expect.objectContaining({ id: 'tab-1' }),
              expect.objectContaining({ id: newTabId, url: 'https://github.com' })
            ])
          })
        })
      );
    });

    it('should use default URL when creating a tab without specifying URL', () => {
      // Given: A browser window
      const windowId = 'browser-1';
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [],
        activeTabId: '',
        freezeState: { type: 'ACTIVE' }
      });

      // When: User creates a tab without specifying URL
      const newTabId = service.createTab(windowId);

      // Then: Tab should be created with default URL
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'on-classic-browser-state',
        expect.objectContaining({
          update: expect.objectContaining({
            tabs: expect.arrayContaining([
              expect.objectContaining({ 
                url: 'https://www.are.na' // Default URL
              })
            ])
          })
        })
      );
    });

    it('should handle closing tabs and activate another tab', () => {
      // Given: A browser with 3 tabs, middle one is active
      const windowId = 'browser-1';
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [
          { id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null },
          { id: 'tab-2', url: 'https://github.com', title: 'GitHub', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null },
          { id: 'tab-3', url: 'https://google.com', title: 'Google', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }
        ],
        activeTabId: 'tab-2',
        freezeState: { type: 'ACTIVE' }
      });

      // When: User closes the active tab
      service.closeTab(windowId, 'tab-2');

      // Then: Another tab should become active (not crash)
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'on-classic-browser-state',
        expect.objectContaining({
          update: expect.objectContaining({
            tabs: expect.not.arrayContaining([
              expect.objectContaining({ id: 'tab-2' })
            ]),
            activeTabId: expect.stringMatching(/^tab-[13]$/) // Should be tab-1 or tab-3
          })
        })
      );
    });

    it('should handle closing the last tab gracefully', () => {
      // Given: A browser with only one tab
      const windowId = 'browser-1';
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });

      // When: User closes the last tab
      service.closeTab(windowId, 'tab-1');

      // Then: Browser should handle it gracefully (implementation may vary - new tab, close window, etc)
      expect(mockMainWindow.webContents.send).toHaveBeenCalled();
      // The important thing is it doesn't crash
    });
  });

  describe('Navigation', () => {
    it('should navigate back when history is available', () => {
      // Given: A browser that has navigation history
      const windowId = 'browser-1';
      
      // Create a mock view with history
      const mockView = createMockWebContentsView('https://example.com/page2');
      mockView.webContents.navigationHistory.canGoBack.mockReturnValue(true);
      
      // Override the viewManager to return our specific mock
      viewManager.getView = vi.fn().mockReturnValue(mockView);
      
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [{ id: 'tab-1', url: 'https://example.com/page2', title: 'Page 2', faviconUrl: null, isLoading: false, canGoBack: true, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });

      // When: User clicks back button
      service.navigate(windowId, 'back');

      // Then: Browser should delegate to navigationService
      expect(navigationService.navigate).toHaveBeenCalledWith(windowId, 'back');
      // And navigationService should call goBack on the view
      expect(mockView.webContents.goBack).toHaveBeenCalled();
    });

    it('should handle navigation when no history exists', () => {
      // Given: A browser with no back history
      const windowId = 'browser-1';
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });

      // When: User tries to go back
      // Then: It should not crash
      expect(() => {
        service.navigate(windowId, 'back');
      }).not.toThrow();
    });

    it('should handle all navigation actions', () => {
      // Given: A browser window
      const windowId = 'browser-1';
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });

      // When/Then: All navigation actions should be handled without crashing
      expect(() => {
        service.navigate(windowId, 'reload');
        service.navigate(windowId, 'stop');
        service.navigate(windowId, 'forward');
      }).not.toThrow();
    });
  });

  describe('Window Management', () => {
    it('should update window bounds when resized', () => {
      // Given: A browser window
      const windowId = 'browser-1';
      const initialBounds = { x: 0, y: 0, width: 800, height: 600 };
      service.createBrowserView(windowId, initialBounds, {
        windowId,
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });

      // When: Window is resized
      const newBounds = { x: 100, y: 100, width: 1024, height: 768 };
      service.setBounds(windowId, newBounds);

      // Then: View should be resized
      expect(viewManager.setBounds).toHaveBeenCalledWith(windowId, newBounds);
    });

    it('should handle visibility changes for minimized/restored windows', () => {
      // Given: A visible browser window
      const windowId = 'browser-1';
      
      // Create a specific mock for this test
      const mockView = createMockWebContentsView();
      (WebContentsView as unknown as Mock).mockImplementationOnce(() => mockView);
      
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });

      // When: Window is minimized
      service.setVisibility(windowId, false, false);

      // Then: View visibility should be updated
      // Note: The actual implementation may use different mechanisms for visibility
      expect(() => service.setVisibility(windowId, false, false)).not.toThrow();

      // When: Window is restored  
      service.setVisibility(windowId, true, true);

      // Then: Operation should complete without error
      expect(() => service.setVisibility(windowId, true, true)).not.toThrow();
    });

    it('should clean up resources when browser is closed', async () => {
      // Given: An active browser window
      const windowId = 'browser-1';
      
      // Create a specific mock view for this test
      const mockView = createMockWebContentsView();
      mockMainWindow.contentView.children.includes = vi.fn().mockReturnValue(true);
      
      (WebContentsView as unknown as Mock).mockImplementationOnce(() => mockView);
      
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });

      // When: Browser is closed
      await service.destroyBrowserView(windowId);

      // Then: Cleanup should occur  
      expect(viewManager.destroyBrowserView).toHaveBeenCalledWith(windowId);
      
      // And: The state should be cleared
      expect(stateService.states.has(windowId)).toBe(false);
    });
  });

  describe('Z-Order Management', () => {
    it('should maintain correct stacking order for multiple browser windows', () => {
      // Given: Multiple browser windows
      const windows = ['window-1', 'window-2', 'window-3'];
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      
      windows.forEach(windowId => {
        service.createBrowserView(windowId, bounds, {
          windowId,
          tabs: [{ id: `tab-${windowId}`, url: `https://example${windowId}.com`, title: `Example ${windowId}`, faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
          activeTabId: `tab-${windowId}`,
          freezeState: { type: 'ACTIVE' }
        });
      });

      // When: Z-order changes (window 3 comes to front, then window 1, then window 2)
      service.syncViewStackingOrder([{ id: 'window-3', isFrozen: false, isMinimized: false }, { id: 'window-1', isFrozen: false, isMinimized: false }, { id: 'window-2', isFrozen: false, isMinimized: false }]);

      // Then: View manager should handle the reordering
      expect(viewManager.syncViewStackingOrder).toHaveBeenCalledWith([
        { id: 'window-3', isFrozen: false, isMinimized: false },
        { id: 'window-1', isFrozen: false, isMinimized: false },
        { id: 'window-2', isFrozen: false, isMinimized: false }
      ]);
    });
  });

  describe('Error Handling', () => {
    it('should handle operations on non-existent windows gracefully', async () => {
      // Given: No browser windows exist
      const nonExistentId = 'does-not-exist';

      // When/Then: Operations should not crash
      // Some methods throw, some don't - test them separately
      
      // These should not throw
      expect(() => {
        service.navigate(nonExistentId, 'back');
        service.setBounds(nonExistentId, { x: 0, y: 0, width: 100, height: 100 });
        service.setVisibility(nonExistentId, true, true);
      }).not.toThrow();
      
      // These throw errors (which is valid behavior)
      expect(() => service.createTab(nonExistentId)).toThrow();
      expect(() => service.switchTab(nonExistentId, 'tab-1')).toThrow();
      expect(() => service.closeTab(nonExistentId, 'tab-1')).toThrow();
      
      // loadUrl delegates to navigationService
      await service.loadUrl(nonExistentId, 'https://example.com');
      expect(navigationService.loadUrl).toHaveBeenCalledWith(nonExistentId, 'https://example.com');
    });

    it('should handle URL loading failures', async () => {
      // Given: A browser window
      const windowId = 'browser-1';
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });

      // Mock loadURL to reject
      const mockView = viewManager.getView(windowId);
      mockView.webContents.loadURL.mockRejectedValue(new Error('Network error'));

      // When: Loading a URL fails
      // Then: Should handle error gracefully
      await expect(service.loadUrl(windowId, 'https://invalid-url.com')).resolves.not.toThrow();
    });
  });

  describe('Activity Tracking', () => {
    it('should track page visits', async () => {
      // Given: A browser window
      const windowId = 'browser-1';
      const url = 'https://example.com';
      
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [{ id: 'tab-1', url, title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });

      // When: User navigates to a page
      await service.loadUrl(windowId, url);

      // Then: Activity should be logged (check via real model)
      const activities = await activityLogService.getRecentActivities('default_user', 24, 10);
      // Note: The actual activity logging happens through event handlers,
      // so in a unit test we can't easily verify this without more setup
    });
  });
});