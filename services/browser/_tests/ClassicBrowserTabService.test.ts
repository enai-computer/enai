import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { ClassicBrowserTabService } from '../ClassicBrowserTabService';
import { ClassicBrowserStateService } from '../ClassicBrowserStateService';
import { ClassicBrowserViewManager } from '../ClassicBrowserViewManager';
import { ClassicBrowserNavigationService } from '../ClassicBrowserNavigationService';
import { TabState, ClassicBrowserPayload } from '../../../shared/types';
import { logger } from '../../../utils/logger';

// Mock uuid to have predictable IDs in tests
vi.mock('uuid', () => ({
  v4: vi.fn()
}));

// Mock logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ClassicBrowserTabService', () => {
  let service: ClassicBrowserTabService;
  let mockStateService: ClassicBrowserStateService;
  let mockViewManager: ClassicBrowserViewManager;
  let mockNavigationService: ClassicBrowserNavigationService;
  let mockView: any;
  let mockWebContents: any;

  // Helper to create a mock tab
  const createMockTab = (id: string, url: string = 'https://example.com'): TabState => ({
    id,
    url,
    title: 'Example',
    faviconUrl: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    error: null
  });

  // Helper to create mock browser state
  const createMockBrowserState = (windowId: string, tabs: TabState[], activeTabId: string): ClassicBrowserPayload => ({
    windowId,
    tabs,
    activeTabId
  });

  beforeEach(() => {
    // Reset uuid mock to return predictable values
    let uuidCounter = 0;
    (uuidv4 as Mock).mockImplementation(() => `test-uuid-${++uuidCounter}`);

    // Create mock WebContents
    mockWebContents = {
      loadURL: vi.fn().mockResolvedValue(undefined),
      executeJavaScript: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
      isDestroyed: vi.fn().mockReturnValue(false)
    };

    // Create mock view
    mockView = {
      webContents: mockWebContents
    };

    // Create mock dependencies
    mockStateService = {
      states: new Map(),
      sendStateUpdate: vi.fn()
    } as any;

    mockViewManager = {
      getView: vi.fn().mockReturnValue(mockView)
    } as any;

    mockNavigationService = {
      loadUrl: vi.fn().mockResolvedValue(undefined)
    } as any;

    // Create service instance
    service = new ClassicBrowserTabService({
      stateService: mockStateService,
      viewManager: mockViewManager,
      navigationService: mockNavigationService
    });
  });

  afterEach(async () => {
    await service.cleanup();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with dependencies and log initialization', () => {
      expect(service).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith('[ClassicBrowserTabService] Initialized');
    });
  });

  describe('createTab', () => {
    it('should create a new tab with default URL when no URL provided', () => {
      const windowId = 'test-window';
      const initialTab = createMockTab('tab-1');
      const browserState = createMockBrowserState(windowId, [initialTab], 'tab-1');
      mockStateService.states.set(windowId, browserState);

      const newTabId = service.createTab(windowId);

      expect(newTabId).toBe('test-uuid-1');
      expect(browserState.tabs).toHaveLength(2);
      expect(browserState.tabs[1]).toEqual({
        id: 'test-uuid-1',
        url: 'https://www.are.na',
        title: 'New Tab',
        faviconUrl: null,
        isLoading: true,
        canGoBack: false,
        canGoForward: false,
        error: null
      });
      expect(browserState.activeTabId).toBe('test-uuid-1');
    });

    it('should create a new tab with specified URL', () => {
      const windowId = 'test-window';
      const customUrl = 'https://github.com';
      const initialTab = createMockTab('tab-1');
      const browserState = createMockBrowserState(windowId, [initialTab], 'tab-1');
      mockStateService.states.set(windowId, browserState);

      const newTabId = service.createTab(windowId, customUrl);

      expect(newTabId).toBe('test-uuid-1');
      expect(browserState.tabs).toHaveLength(2);
      expect(browserState.tabs[1].url).toBe(customUrl);
      expect(browserState.activeTabId).toBe('test-uuid-1');
    });

    it('should load URL in WebContentsView when creating active tab', () => {
      const windowId = 'test-window';
      const url = 'https://github.com';
      const browserState = createMockBrowserState(windowId, [], '');
      mockStateService.states.set(windowId, browserState);

      service.createTab(windowId, url);

      expect(mockViewManager.getView).toHaveBeenCalledWith(windowId);
      expect(mockNavigationService.loadUrl).toHaveBeenCalledWith(windowId, url);
    });

    it('should send state update after creating tab', () => {
      const windowId = 'test-window';
      const browserState = createMockBrowserState(windowId, [], '');
      mockStateService.states.set(windowId, browserState);

      service.createTab(windowId);

      expect(mockStateService.sendStateUpdate).toHaveBeenCalledWith(
        windowId,
        expect.objectContaining({
          id: 'test-uuid-1',
          url: 'https://www.are.na'
        }),
        'test-uuid-1'
      );
    });

    it('should throw error if browser window not found', () => {
      const windowId = 'non-existent';

      expect(() => service.createTab(windowId)).toThrow(
        `Browser window ${windowId} not found`
      );
    });

    it('should handle loadUrl errors gracefully', async () => {
      const windowId = 'test-window';
      const browserState = createMockBrowserState(windowId, [], '');
      mockStateService.states.set(windowId, browserState);
      mockNavigationService.loadUrl.mockRejectedValue(new Error('Network error'));

      const newTabId = service.createTab(windowId);

      // Should still create the tab
      expect(newTabId).toBe('test-uuid-1');
      expect(browserState.tabs).toHaveLength(1);
      
      // Wait for async error handling
      await vi.waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to load URL'),
          expect.any(Error)
        );
      });
    });
  });

  describe('createTabWithState', () => {
    it('should create active tab when makeActive is true', () => {
      const windowId = 'test-window';
      const browserState = createMockBrowserState(windowId, [], '');
      mockStateService.states.set(windowId, browserState);

      const newTabId = service.createTabWithState(windowId, 'https://example.com', true);

      expect(browserState.activeTabId).toBe(newTabId);
      expect(browserState.tabs[0].isLoading).toBe(true);
      expect(mockNavigationService.loadUrl).toHaveBeenCalled();
    });

    it('should create background tab when makeActive is false', () => {
      const windowId = 'test-window';
      const existingTab = createMockTab('tab-1');
      const browserState = createMockBrowserState(windowId, [existingTab], 'tab-1');
      mockStateService.states.set(windowId, browserState);

      const newTabId = service.createTabWithState(windowId, 'https://example.com', false);

      expect(browserState.activeTabId).toBe('tab-1'); // Should not change
      expect(browserState.tabs[1].isLoading).toBe(false);
      expect(mockNavigationService.loadUrl).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Created background tab')
      );
    });

    it('should send appropriate state update based on makeActive', () => {
      const windowId = 'test-window';
      const browserState = createMockBrowserState(windowId, [], '');
      mockStateService.states.set(windowId, browserState);

      // Test with makeActive = false
      service.createTabWithState(windowId, 'https://example.com', false);

      expect(mockStateService.sendStateUpdate).toHaveBeenCalledWith(
        windowId,
        undefined, // No tab update when not active
        undefined  // No activeTabId update
      );
    });
  });

  describe('switchTab', () => {
    it('should switch to existing tab and load its URL', () => {
      const windowId = 'test-window';
      const tab1 = createMockTab('tab-1', 'https://example.com');
      const tab2 = createMockTab('tab-2', 'https://github.com');
      const browserState = createMockBrowserState(windowId, [tab1, tab2], 'tab-1');
      mockStateService.states.set(windowId, browserState);

      service.switchTab(windowId, 'tab-2');

      expect(browserState.activeTabId).toBe('tab-2');
      expect(mockNavigationService.loadUrl).toHaveBeenCalledWith(windowId, 'https://github.com');
      expect(mockStateService.sendStateUpdate).toHaveBeenCalledWith(windowId, undefined, 'tab-2');
    });

    it('should save scroll position of current tab before switching', async () => {
      const windowId = 'test-window';
      const tab1 = createMockTab('tab-1', 'https://example.com');
      const tab2 = createMockTab('tab-2', 'https://github.com');
      const browserState = createMockBrowserState(windowId, [tab1, tab2], 'tab-1');
      mockStateService.states.set(windowId, browserState);

      const scrollPos = { x: 100, y: 200 };
      mockWebContents.executeJavaScript.mockResolvedValue(scrollPos);

      service.switchTab(windowId, 'tab-2');

      // Wait for async scroll position save
      await vi.waitFor(() => {
        expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
          expect.stringContaining('window.scrollX')
        );
      });
    });

    it('should handle about:blank tabs specially', () => {
      const windowId = 'test-window';
      const tab1 = createMockTab('tab-1', 'https://example.com');
      const tab2 = createMockTab('tab-2', 'about:blank');
      const browserState = createMockBrowserState(windowId, [tab1, tab2], 'tab-1');
      mockStateService.states.set(windowId, browserState);

      service.switchTab(windowId, 'tab-2');

      expect(mockNavigationService.loadUrl).not.toHaveBeenCalled();
      expect(browserState.tabs[1]).toMatchObject({
        url: 'about:blank',
        title: 'New Tab',
        isLoading: false
      });
    });

    it('should throw error if window not found', () => {
      expect(() => service.switchTab('non-existent', 'tab-1')).toThrow(
        'Browser window non-existent not found'
      );
    });

    it('should throw error if tab not found', () => {
      const windowId = 'test-window';
      const browserState = createMockBrowserState(windowId, [], '');
      mockStateService.states.set(windowId, browserState);

      expect(() => service.switchTab(windowId, 'non-existent')).toThrow(
        'Tab non-existent not found in window test-window'
      );
    });

    it('should handle missing webContents gracefully', () => {
      const windowId = 'test-window';
      const tab1 = createMockTab('tab-1');
      const tab2 = createMockTab('tab-2');
      const browserState = createMockBrowserState(windowId, [tab1, tab2], 'tab-1');
      mockStateService.states.set(windowId, browserState);
      mockViewManager.getView.mockReturnValue(null);

      service.switchTab(windowId, 'tab-2');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No valid view or webContents')
      );
    });

    it('should handle scroll position save errors gracefully', () => {
      const windowId = 'test-window';
      const tab1 = createMockTab('tab-1');
      const tab2 = createMockTab('tab-2');
      const browserState = createMockBrowserState(windowId, [tab1, tab2], 'tab-1');
      mockStateService.states.set(windowId, browserState);
      mockWebContents.executeJavaScript.mockRejectedValue(new Error('Script error'));

      service.switchTab(windowId, 'tab-2');

      // Should not throw, just log debug message
      expect(browserState.activeTabId).toBe('tab-2');
    });
  });

  describe('closeTab', () => {
    it('should close tab and activate adjacent tab', () => {
      const windowId = 'test-window';
      const tab1 = createMockTab('tab-1');
      const tab2 = createMockTab('tab-2');
      const tab3 = createMockTab('tab-3');
      const browserState = createMockBrowserState(windowId, [tab1, tab2, tab3], 'tab-2');
      mockStateService.states.set(windowId, browserState);

      service.closeTab(windowId, 'tab-2');

      expect(browserState.tabs).toHaveLength(2);
      expect(browserState.tabs.find(t => t.id === 'tab-2')).toBeUndefined();
      expect(browserState.activeTabId).toBe('tab-3'); // Should activate next tab
      expect(mockNavigationService.loadUrl).toHaveBeenCalledWith(windowId, tab3.url);
    });

    it('should activate previous tab when closing last tab in list', () => {
      const windowId = 'test-window';
      const tab1 = createMockTab('tab-1');
      const tab2 = createMockTab('tab-2');
      const browserState = createMockBrowserState(windowId, [tab1, tab2], 'tab-2');
      mockStateService.states.set(windowId, browserState);

      service.closeTab(windowId, 'tab-2');

      expect(browserState.activeTabId).toBe('tab-1');
    });

    it('should not close last tab, instead replace with new tab', () => {
      const windowId = 'test-window';
      const tab1 = createMockTab('tab-1');
      const browserState = createMockBrowserState(windowId, [tab1], 'tab-1');
      mockStateService.states.set(windowId, browserState);

      service.closeTab(windowId, 'tab-1');

      expect(browserState.tabs).toHaveLength(1);
      expect(browserState.tabs[0].id).toBe('test-uuid-1'); // New tab ID
      expect(browserState.tabs[0].url).toBe('https://www.are.na');
      expect(browserState.activeTabId).toBe('test-uuid-1');
      expect(mockNavigationService.loadUrl).toHaveBeenCalledWith(windowId, 'https://www.are.na');
    });

    it('should not change active tab when closing inactive tab', () => {
      const windowId = 'test-window';
      const tab1 = createMockTab('tab-1');
      const tab2 = createMockTab('tab-2');
      const tab3 = createMockTab('tab-3');
      const browserState = createMockBrowserState(windowId, [tab1, tab2, tab3], 'tab-2');
      mockStateService.states.set(windowId, browserState);

      service.closeTab(windowId, 'tab-3');

      expect(browserState.tabs).toHaveLength(2);
      expect(browserState.activeTabId).toBe('tab-2'); // Should remain unchanged
      expect(mockNavigationService.loadUrl).not.toHaveBeenCalled();
    });

    it('should send state update with new active tab info', () => {
      const windowId = 'test-window';
      const tab1 = createMockTab('tab-1');
      const tab2 = createMockTab('tab-2');
      const browserState = createMockBrowserState(windowId, [tab1, tab2], 'tab-1');
      mockStateService.states.set(windowId, browserState);

      service.closeTab(windowId, 'tab-1');

      expect(mockStateService.sendStateUpdate).toHaveBeenCalledWith(
        windowId,
        tab2, // The newly active tab
        'tab-2'
      );
    });

    it('should throw error if window not found', () => {
      expect(() => service.closeTab('non-existent', 'tab-1')).toThrow(
        'Browser window non-existent not found'
      );
    });

    it('should throw error if tab not found', () => {
      const windowId = 'test-window';
      const tab1 = createMockTab('tab-1');
      const browserState = createMockBrowserState(windowId, [tab1], 'tab-1');
      mockStateService.states.set(windowId, browserState);

      expect(() => service.closeTab(windowId, 'non-existent')).toThrow(
        'Tab non-existent not found in window test-window'
      );
    });

    it('should handle loadUrl errors when replacing last tab', async () => {
      const windowId = 'test-window';
      const tab1 = createMockTab('tab-1');
      const browserState = createMockBrowserState(windowId, [tab1], 'tab-1');
      mockStateService.states.set(windowId, browserState);
      mockNavigationService.loadUrl.mockRejectedValue(new Error('Network error'));

      service.closeTab(windowId, 'tab-1');

      // Should still replace the tab
      expect(browserState.tabs).toHaveLength(1);
      expect(browserState.tabs[0].id).toBe('test-uuid-1');
      
      // Wait for async error handling
      await vi.waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to load default URL'),
          expect.any(Error)
        );
      });
    });
  });

  describe('cleanup', () => {
    it('should log cleanup message', async () => {
      await service.cleanup();

      expect(logger.info).toHaveBeenCalledWith('[ClassicBrowserTabService] Service cleaned up');
    });
  });

  describe('integration scenarios', () => {
    it('should handle rapid tab operations', () => {
      const windowId = 'test-window';
      const browserState = createMockBrowserState(windowId, [], '');
      mockStateService.states.set(windowId, browserState);

      // Create multiple tabs rapidly
      const tab1Id = service.createTab(windowId, 'https://example.com');
      const tab2Id = service.createTab(windowId, 'https://github.com');
      const tab3Id = service.createTab(windowId, 'https://google.com');

      expect(browserState.tabs).toHaveLength(3);
      expect(browserState.activeTabId).toBe(tab3Id);

      // Switch tabs
      service.switchTab(windowId, tab1Id);
      expect(browserState.activeTabId).toBe(tab1Id);

      // Close middle tab
      service.closeTab(windowId, tab2Id);
      expect(browserState.tabs).toHaveLength(2);
      expect(browserState.activeTabId).toBe(tab1Id); // Should remain on current tab
    });

    it('should maintain tab state consistency through operations', () => {
      const windowId = 'test-window';
      const browserState = createMockBrowserState(windowId, [], '');
      mockStateService.states.set(windowId, browserState);

      // Create initial tab
      const tab1Id = service.createTab(windowId);
      expect(browserState.tabs[0].isLoading).toBe(true);

      // Create another tab
      const tab2Id = service.createTab(windowId);
      
      // Close the first tab
      service.closeTab(windowId, tab1Id);
      
      // Should have one tab that's the active one
      expect(browserState.tabs).toHaveLength(1);
      expect(browserState.tabs[0].id).toBe(tab2Id);
      expect(browserState.activeTabId).toBe(tab2Id);
    });
  });
});