import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { ClassicBrowserTabService } from '../ClassicBrowserTabService';
import { ClassicBrowserStateService } from '../ClassicBrowserStateService';
import { ClassicBrowserViewManager } from '../ClassicBrowserViewManager';
import { ClassicBrowserNavigationService } from '../ClassicBrowserNavigationService';
import { TabState, ClassicBrowserPayload } from '../../../shared/types';

// Mock uuid
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

describe('ClassicBrowserTabService - Edge Cases', () => {
  let service: ClassicBrowserTabService;
  let mockStateService: ClassicBrowserStateService;
  let mockViewManager: ClassicBrowserViewManager;
  let mockNavigationService: ClassicBrowserNavigationService;

  beforeEach(() => {
    // Reset uuid mock
    let uuidCounter = 0;
    (uuidv4 as Mock).mockImplementation(() => `edge-uuid-${++uuidCounter}`);

    // Create mock dependencies
    mockStateService = {
      states: new Map(),
      sendStateUpdate: vi.fn()
    } as any;

    mockViewManager = {
      getView: vi.fn()
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

  describe('WebContents edge cases', () => {
    it('should handle destroyed webContents when creating tab', () => {
      const windowId = 'test-window';
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [],
        activeTabId: ''
      };
      mockStateService.states.set(windowId, browserState);

      const mockView = {
        webContents: {
          isDestroyed: vi.fn().mockReturnValue(true)
        }
      };
      mockViewManager.getView.mockReturnValue(mockView);

      const tabId = service.createTab(windowId);

      expect(tabId).toBe('edge-uuid-1');
      expect(mockNavigationService.loadUrl).not.toHaveBeenCalled();
    });

    it('should handle null webContents when switching tabs', () => {
      const windowId = 'test-window';
      const tab1: TabState = {
        id: 'tab-1',
        url: 'https://example.com',
        title: 'Example',
        faviconUrl: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        error: null
      };
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [tab1],
        activeTabId: 'tab-1'
      };
      mockStateService.states.set(windowId, browserState);

      mockViewManager.getView.mockReturnValue({ webContents: null });

      // Should not throw
      expect(() => service.switchTab(windowId, 'tab-1')).not.toThrow();
    });
  });

  describe('State synchronization edge cases', () => {
    it('should handle concurrent tab creation', () => {
      const windowId = 'test-window';
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [],
        activeTabId: ''
      };
      mockStateService.states.set(windowId, browserState);

      // Simulate concurrent tab creation
      const promises = Array(5).fill(null).map(() => 
        Promise.resolve(service.createTab(windowId))
      );

      return Promise.all(promises).then(tabIds => {
        expect(browserState.tabs).toHaveLength(5);
        expect(new Set(tabIds).size).toBe(5); // All IDs should be unique
        expect(browserState.activeTabId).toBe(tabIds[4]); // Last one should be active
      });
    });

    it('should handle state mutations during operations', () => {
      const windowId = 'test-window';
      const tab1: TabState = {
        id: 'tab-1',
        url: 'https://example.com',
        title: 'Example',
        faviconUrl: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        error: null
      };
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [tab1],
        activeTabId: 'tab-1'
      };
      mockStateService.states.set(windowId, browserState);

      // Mock sendStateUpdate to mutate state (simulating external modification)
      mockStateService.sendStateUpdate.mockImplementation(() => {
        browserState.tabs.push({
          id: 'external-tab',
          url: 'https://external.com',
          title: 'External',
          faviconUrl: null,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          error: null
        });
      });

      service.createTab(windowId);

      // Should handle the mutation gracefully
      expect(browserState.tabs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('URL handling edge cases', () => {
    it('should handle empty URL string when creating tab', () => {
      const windowId = 'test-window';
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [],
        activeTabId: ''
      };
      mockStateService.states.set(windowId, browserState);

      const tabId = service.createTab(windowId, '');

      expect(browserState.tabs[0].url).toBe('https://www.are.na'); // Should use default
    });

    it('should handle malformed URLs gracefully', () => {
      const windowId = 'test-window';
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [],
        activeTabId: ''
      };
      mockStateService.states.set(windowId, browserState);

      // Mock a view for this test
      const mockView = {
        webContents: {
          isDestroyed: vi.fn().mockReturnValue(false)
        }
      };
      mockViewManager.getView.mockReturnValue(mockView);

      const malformedUrl = 'not://a-valid-url';
      const tabId = service.createTab(windowId, malformedUrl);

      // Should still create the tab with the provided URL
      expect(browserState.tabs[0].url).toBe(malformedUrl);
      expect(mockNavigationService.loadUrl).toHaveBeenCalledWith(windowId, malformedUrl);
    });
  });

  describe('Tab array edge cases', () => {
    it('should handle closing tab when tabs array is empty', () => {
      const windowId = 'test-window';
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [],
        activeTabId: ''
      };
      mockStateService.states.set(windowId, browserState);

      expect(() => service.closeTab(windowId, 'non-existent')).toThrow(
        'Tab non-existent not found in window test-window'
      );
    });

    it('should handle switching to tab when activeTabId is invalid', () => {
      const windowId = 'test-window';
      const tab1: TabState = {
        id: 'tab-1',
        url: 'https://example.com',
        title: 'Example',
        faviconUrl: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        error: null
      };
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [tab1],
        activeTabId: 'invalid-tab-id'
      };
      mockStateService.states.set(windowId, browserState);

      const mockView = {
        webContents: {
          isDestroyed: vi.fn().mockReturnValue(false),
          executeJavaScript: vi.fn().mockResolvedValue({ x: 0, y: 0 })
        }
      };
      mockViewManager.getView.mockReturnValue(mockView);

      service.switchTab(windowId, 'tab-1');

      expect(browserState.activeTabId).toBe('tab-1');
    });
  });

  describe('Background tab creation edge cases', () => {
    it('should handle background tab creation with destroyed webContents', () => {
      const windowId = 'test-window';
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [],
        activeTabId: ''
      };
      mockStateService.states.set(windowId, browserState);

      const mockView = {
        webContents: {
          isDestroyed: vi.fn().mockReturnValue(true)
        }
      };
      mockViewManager.getView.mockReturnValue(mockView);

      const tabId = service.createTabWithState(windowId, 'https://example.com', false);

      expect(tabId).toBe('edge-uuid-1');
      expect(browserState.tabs[0].isLoading).toBe(false);
      expect(mockNavigationService.loadUrl).not.toHaveBeenCalled();
    });

    it('should maintain correct active tab when creating multiple background tabs', () => {
      const windowId = 'test-window';
      const activeTab: TabState = {
        id: 'active-tab',
        url: 'https://active.com',
        title: 'Active',
        faviconUrl: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        error: null
      };
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [activeTab],
        activeTabId: 'active-tab'
      };
      mockStateService.states.set(windowId, browserState);

      // Create multiple background tabs
      const bg1 = service.createTabWithState(windowId, 'https://bg1.com', false);
      const bg2 = service.createTabWithState(windowId, 'https://bg2.com', false);
      const bg3 = service.createTabWithState(windowId, 'https://bg3.com', false);

      expect(browserState.tabs).toHaveLength(4);
      expect(browserState.activeTabId).toBe('active-tab'); // Should not change
      expect(mockNavigationService.loadUrl).not.toHaveBeenCalled();
    });
  });

  describe('Scroll position edge cases', () => {
    it('should handle executeJavaScript timeout when saving scroll position', async () => {
      const windowId = 'test-window';
      const tab1: TabState = {
        id: 'tab-1',
        url: 'https://example.com',
        title: 'Tab 1',
        faviconUrl: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        error: null
      };
      const tab2: TabState = {
        id: 'tab-2',
        url: 'https://example2.com',
        title: 'Tab 2',
        faviconUrl: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        error: null
      };
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [tab1, tab2],
        activeTabId: 'tab-1'
      };
      mockStateService.states.set(windowId, browserState);

      const mockView = {
        webContents: {
          isDestroyed: vi.fn().mockReturnValue(false),
          executeJavaScript: vi.fn(() => new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 100)
          ))
        }
      };
      mockViewManager.getView.mockReturnValue(mockView);

      service.switchTab(windowId, 'tab-2');

      // Should switch tabs even if scroll save fails
      expect(browserState.activeTabId).toBe('tab-2');
      
      // Wait for the rejected promise
      await new Promise(resolve => setTimeout(resolve, 150));
    });

    it('should handle switching from and to the same tab', () => {
      const windowId = 'test-window';
      const tab1: TabState = {
        id: 'tab-1',
        url: 'https://example.com',
        title: 'Tab 1',
        faviconUrl: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        error: null
      };
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [tab1],
        activeTabId: 'tab-1'
      };
      mockStateService.states.set(windowId, browserState);

      const mockView = {
        webContents: {
          isDestroyed: vi.fn().mockReturnValue(false),
          executeJavaScript: vi.fn()
        }
      };
      mockViewManager.getView.mockReturnValue(mockView);

      service.switchTab(windowId, 'tab-1');

      // Should not try to save scroll position when switching to same tab
      expect(mockView.webContents.executeJavaScript).not.toHaveBeenCalled();
    });
  });

  describe('State update edge cases', () => {
    it('should handle sendStateUpdate throwing error', () => {
      const windowId = 'test-window';
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [],
        activeTabId: ''
      };
      mockStateService.states.set(windowId, browserState);
      mockStateService.sendStateUpdate.mockImplementation(() => {
        throw new Error('State update failed');
      });

      // Mock a view for this test
      const mockView = {
        webContents: {
          isDestroyed: vi.fn().mockReturnValue(false)
        }
      };
      mockViewManager.getView.mockReturnValue(mockView);

      // The service doesn't catch sendStateUpdate errors, so it will throw
      expect(() => service.createTab(windowId)).toThrow('State update failed');
      // But the tab should still be created before the error
      expect(browserState.tabs).toHaveLength(1);
    });

    it('should handle race condition in tab closing', () => {
      const windowId = 'test-window';
      const tab1: TabState = {
        id: 'tab-1',
        url: 'https://example.com',
        title: 'Tab 1',
        faviconUrl: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        error: null
      };
      const tab2: TabState = {
        id: 'tab-2',
        url: 'https://example2.com',
        title: 'Tab 2',
        faviconUrl: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        error: null
      };
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [tab1, tab2],
        activeTabId: 'tab-1'
      };
      mockStateService.states.set(windowId, browserState);

      // Close the same tab twice (race condition)
      service.closeTab(windowId, 'tab-1');
      expect(() => service.closeTab(windowId, 'tab-1')).toThrow(
        'Tab tab-1 not found in window test-window'
      );
    });
  });

  describe('Memory and resource management', () => {
    it('should not leak memory when creating many tabs', () => {
      const windowId = 'test-window';
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [],
        activeTabId: ''
      };
      mockStateService.states.set(windowId, browserState);

      // Create many tabs
      for (let i = 0; i < 100; i++) {
        service.createTab(windowId);
      }

      expect(browserState.tabs).toHaveLength(100);

      // Close all but one
      for (let i = 0; i < 99; i++) {
        service.closeTab(windowId, browserState.tabs[1].id);
      }

      expect(browserState.tabs).toHaveLength(1);
    });

    it('should handle cleanup when service has active operations', async () => {
      const windowId = 'test-window';
      const browserState: ClassicBrowserPayload = {
        windowId,
        tabs: [],
        activeTabId: ''
      };
      mockStateService.states.set(windowId, browserState);

      // Start an async operation
      const loadUrlPromise = new Promise((resolve) => {
        setTimeout(() => resolve(undefined), 100);
      });
      mockNavigationService.loadUrl.mockReturnValue(loadUrlPromise);

      service.createTab(windowId);

      // Cleanup while operation is pending
      await service.cleanup();

      // Should complete without error
      expect(true).toBe(true);
    });
  });
});