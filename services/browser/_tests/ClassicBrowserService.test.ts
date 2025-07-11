/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebContentsView } from 'electron';
import { ClassicBrowserService } from '../ClassicBrowserService';
import { ActivityLogService } from '../../ActivityLogService';
import { ObjectModelCore } from '../../../models/ObjectModelCore';
import { ActivityLogModel } from '../../../models/ActivityLogModel';
import { TabState } from '../../../shared/types';
import Database from 'better-sqlite3';
import runMigrations from '../../../models/runMigrations';
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

describe('ClassicBrowserService', () => {
  let service: ClassicBrowserService;
  let db: Database.Database;
  let objectModel: ObjectModelCore;
  let activityLogModel: ActivityLogModel;
  let activityLogService: ActivityLogService;
  let viewManager: any;
  let stateService: any;
  let navigationService: any;
  let tabService: any;
  let womService: any;
  let snapshotService: any;
  let eventBus: BrowserEventBus;
  let lanceVectorModel: any;
  let mockMainWindow: any;

  // Helper to create a minimal mock WebContentsView
  function createMockWebContentsView(url: string = 'about:blank') {
    return {
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
  }

  beforeEach(async () => {
    // Set up a real database and models for more realistic testing
    db = new Database(':memory:');
    await runMigrations(db);
    
    objectModel = new ObjectModelCore(db);
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
    
    // Create the event bus
    eventBus = new BrowserEventBus();
    
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

    // Mock WebContentsView constructor
    (WebContentsView as unknown as Mock).mockImplementation(() => {
      return createMockWebContentsView();
    });

    // Create minimal mocks for sub-services
    viewManager = {
      getView: vi.fn().mockReturnValue(createMockWebContentsView()),
      createViewWithState: vi.fn(),
      setBounds: vi.fn(),
      setVisibility: vi.fn(),
      setBackgroundColor: vi.fn(),
      syncViewStackingOrder: vi.fn(),
      getActiveViewWindowIds: vi.fn().mockReturnValue([]),
      destroyBrowserView: vi.fn().mockResolvedValue(undefined),
      destroyAllBrowserViews: vi.fn().mockResolvedValue(undefined),
      prefetchFavicon: vi.fn().mockResolvedValue(null),
      prefetchFaviconsForWindows: vi.fn().mockResolvedValue(new Map()),
      initialize: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined)
    };
    
    stateService = {
      states: new Map(),
      sendStateUpdate: vi.fn(),
      updateTabBookmarkStatus: vi.fn(),
      findTabState: vi.fn(),
      refreshTabState: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined)
    };
    
    navigationService = {
      loadUrl: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn(),
      isSignificantNavigation: vi.fn().mockResolvedValue(true),
      getBaseUrl: vi.fn().mockReturnValue('https://example.com'),
      clearNavigationTracking: vi.fn(),
      clearAllNavigationTracking: vi.fn(),
      cleanup: vi.fn().mockResolvedValue(undefined)
    };
    
    tabService = {
      createTab: vi.fn().mockReturnValue(`tab-${Date.now()}`),
      createTabWithState: vi.fn(),
      switchTab: vi.fn(),
      closeTab: vi.fn(),
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

    // Create service with all required dependencies
    service = new ClassicBrowserService({
      mainWindow: mockMainWindow,
      objectModelCore: objectModel,
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
      const windowId = 'browser-1';
      const bounds = { x: 100, y: 100, width: 800, height: 600 };
      const initialUrl = 'https://example.com';

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

      expect(viewManager.createViewWithState).toHaveBeenCalledWith(
        windowId,
        bounds,
        expect.objectContaining({
          tabs: expect.arrayContaining([expect.objectContaining({ url: initialUrl })])
        })
      );
    });
  });

  describe('Tab Management', () => {
    beforeEach(() => {
      const windowId = 'browser-1';
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });
      stateService.states.set(windowId, {
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });
    });

    it('should create and switch between tabs', () => {
      const windowId = 'browser-1';
      const newTabId = service.createTab(windowId, 'https://github.com');
      expect(tabService.createTab).toHaveBeenCalledWith(windowId, 'https://github.com');
      expect(newTabId).toBeTruthy();

      service.switchTab(windowId, 'tab-1');
      expect(tabService.switchTab).toHaveBeenCalledWith(windowId, 'tab-1');
    });

    it('should handle tab operations with proper delegation', () => {
      const windowId = 'browser-1';
      
      // Create tab without URL
      service.createTab(windowId);
      expect(tabService.createTab).toHaveBeenCalledWith(windowId, undefined);

      // Close tab
      service.closeTab(windowId, 'tab-1');
      expect(tabService.closeTab).toHaveBeenCalledWith(windowId, 'tab-1');
    });
  });

  describe('Navigation', () => {
    it('should delegate all navigation actions to navigation service', () => {
      const windowId = 'browser-1';
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });

      // Test all navigation actions
      ['back', 'forward', 'reload', 'stop'].forEach(action => {
        service.navigate(windowId, action as any);
        expect(navigationService.navigate).toHaveBeenCalledWith(windowId, action);
      });
    });

    it('should load URLs through navigation service', async () => {
      const windowId = 'browser-1';
      const url = 'https://example.com';
      
      await service.loadUrl(windowId, url);
      expect(navigationService.loadUrl).toHaveBeenCalledWith(windowId, url);
    });
  });

  describe('Window Management', () => {
    const windowId = 'browser-1';
    
    beforeEach(() => {
      service.createBrowserView(windowId, { x: 0, y: 0, width: 800, height: 600 }, {
        windowId,
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });
      stateService.states.set(windowId, {
        tabs: [{ id: 'tab-1', url: 'https://example.com', title: 'Example', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab-1',
        freezeState: { type: 'ACTIVE' }
      });
    });

    it('should update bounds and visibility', () => {
      const newBounds = { x: 100, y: 100, width: 1024, height: 768 };
      service.setBounds(windowId, newBounds);
      expect(viewManager.setBounds).toHaveBeenCalledWith(windowId, newBounds);

      service.setVisibility(windowId, false, false);
      expect(viewManager.setVisibility).toHaveBeenCalledWith(windowId, false, false);
    });

    it('should clean up resources when destroyed', async () => {
      await service.destroyBrowserView(windowId);
      expect(viewManager.destroyBrowserView).toHaveBeenCalledWith(windowId);
      expect(stateService.states.has(windowId)).toBe(false);
    });
  });

  describe('Z-Order Management', () => {
    it('should sync view stacking order', () => {
      const stackingOrder = [
        { id: 'window-1', isFrozen: false, isMinimized: false },
        { id: 'window-2', isFrozen: false, isMinimized: false }
      ];
      
      service.syncViewStackingOrder(stackingOrder);
      expect(viewManager.syncViewStackingOrder).toHaveBeenCalledWith(stackingOrder);
    });
  });

  describe('Error Handling', () => {
    it('should handle operations on non-existent windows', async () => {
      const nonExistentId = 'does-not-exist';

      // Tab operations should throw (they require state)
      tabService.createTab.mockImplementation(() => { throw new Error('Window not found'); });
      tabService.switchTab.mockImplementation(() => { throw new Error('Window not found'); });
      tabService.closeTab.mockImplementation(() => { throw new Error('Window not found'); });
      
      expect(() => service.createTab(nonExistentId)).toThrow();
      expect(() => service.switchTab(nonExistentId, 'tab-1')).toThrow();
      expect(() => service.closeTab(nonExistentId, 'tab-1')).toThrow();
      
      // Navigation/view operations delegate and don't throw
      expect(() => {
        service.navigate(nonExistentId, 'back');
        service.setBounds(nonExistentId, { x: 0, y: 0, width: 100, height: 100 });
        service.setVisibility(nonExistentId, true, true);
      }).not.toThrow();
      
      await service.loadUrl(nonExistentId, 'https://example.com');
      expect(navigationService.loadUrl).toHaveBeenCalledWith(nonExistentId, 'https://example.com');
    });
  });

  describe('Service Lifecycle', () => {
    it('should initialize and cleanup properly', async () => {
      // Service is already initialized in beforeEach
      expect(viewManager.initialize).toHaveBeenCalled();
      expect(stateService.initialize).toHaveBeenCalled();
      expect(navigationService.cleanup).not.toHaveBeenCalled();

      await service.cleanup();
      
      expect(viewManager.cleanup).toHaveBeenCalled();
      expect(stateService.cleanup).toHaveBeenCalled();
      expect(navigationService.cleanup).toHaveBeenCalled();
      expect(tabService.cleanup).toHaveBeenCalled();
      expect(womService.cleanup).toHaveBeenCalled();
      expect(snapshotService.cleanup).toHaveBeenCalled();
    });
  });
});