import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClassicBrowserService } from '../ClassicBrowserService';
import type { BrowserWindow } from 'electron';
import { ON_CLASSIC_BROWSER_STATE } from '../../../shared/ipcChannels';
import { ObjectModel } from '../../../models/ObjectModel';
import { 
  createMockBrowserWindow, 
  createMockWebContentsView,
  createIpcEventSpy,
  createMockBrowserPayload,
  createMockTabState,
  flushPromises
} from '../../../utils/classicBrowserMocks';

// Mock Electron modules
vi.mock('electron', () => ({
  WebContentsView: vi.fn().mockImplementation(() => createMockWebContentsView()),
  BrowserWindow: {
    fromId: vi.fn()
  }
}));

// Mock logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).substr(2, 9))
}));

// Mock ActivityLogService
const mockActivityLogService = {
  logActivity: vi.fn().mockResolvedValue(undefined)
};

// Mock ObjectModel
vi.mock('../../../models/ObjectModel', () => ({
  ObjectModel: vi.fn().mockImplementation(() => ({
    existsBySourceUri: vi.fn().mockResolvedValue(false)
  }))
}));

describe('ClassicBrowserService - Tab Operations', () => {
  let service: ClassicBrowserService;
  let mockWindow: ReturnType<typeof createMockBrowserWindow>;
  let mockObjectModel: any;
  let ipcEventSpy: ReturnType<typeof createIpcEventSpy>;

  beforeEach(() => {
    mockWindow = createMockBrowserWindow();
    mockObjectModel = new ObjectModel();
    ipcEventSpy = createIpcEventSpy();
    
    // Set up IPC event tracking
    (mockWindow.webContents.send as any).mockImplementation(ipcEventSpy.spy);
    
    // Create the service with the mock window, object model, and activity log service
    service = new ClassicBrowserService({
      mainWindow: mockWindow as any,
      objectModel: mockObjectModel,
      activityLogService: mockActivityLogService as any
    });
  });

  afterEach(() => {
    service.destroy();
    vi.clearAllMocks();
  });

  describe('Core Tab Lifecycle Operations', () => {
    const windowId = 'test-window-123';
    const bounds = { x: 0, y: 0, width: 1024, height: 768 };

    beforeEach(async () => {
      // Initialize browser view with one tab
      const initialPayload = createMockBrowserPayload();
      await service.createBrowserView(windowId, bounds, initialPayload);
      ipcEventSpy.clear(); // Clear initialization events
    });

    describe('Scenario 3.1: Creating a New Tab', () => {
      it('should create tab atomically with state update', () => {
        // Act
        const newTabId = service.createTab(windowId);

        // Assert: Tab ID returned
        expect(newTabId).toMatch(/^mock-uuid-/);

        // Assert: State updated correctly
        const state = service.getBrowserState(windowId);
        expect(state).toBeTruthy();
        expect(state!.tabs).toHaveLength(2); // Original + new
        expect(state!.activeTabId).toBe(newTabId); // New tab is active
        
        // Find the new tab
        const newTab = state!.tabs.find(t => t.id === newTabId);
        expect(newTab).toBeDefined();
        expect(newTab!.url).toBe('https://www.are.na');
        expect(newTab!.title).toBe('New Tab');
        expect(newTab!.isLoading).toBe(true); // New tabs start loading immediately

        // Assert: Exactly one state update emitted
        expect(ipcEventSpy.getEventCount()).toBe(1);
        const event = ipcEventSpy.getLastEvent();
        expect(event.channel).toBe(ON_CLASSIC_BROWSER_STATE);
        expect(event.payload).toEqual({
          windowId,
          update: {
            tabs: state!.tabs,
            activeTabId: state!.activeTabId
          }
        });

        // Assert: WebContents loads new tab URL
        const mockView = service.getView(windowId);
        expect(mockView?.webContents.loadURL).toHaveBeenCalledWith('https://www.are.na');
      });

      it('should create tab with custom URL', () => {
        // Act
        const customUrl = 'https://github.com';
        const newTabId = service.createTab(windowId, customUrl);

        // Assert: Custom URL used
        const state = service.getBrowserState(windowId);
        const newTab = state!.tabs.find(t => t.id === newTabId);
        expect(newTab!.url).toBe(customUrl);
        
        // Assert: WebContents loads custom URL
        const mockView = service.getView(windowId);
        expect(mockView?.webContents.loadURL).toHaveBeenCalledWith(customUrl);
      });

      it('should maintain tab array immutability', () => {
        // Arrange: Get reference to original tabs array
        const originalState = service.getBrowserState(windowId);
        const originalTabs = originalState!.tabs;

        // Act
        service.createTab(windowId);

        // Assert: New array created, not mutated
        const newState = service.getBrowserState(windowId);
        expect(newState!.tabs).not.toBe(originalTabs);
        expect(originalTabs).toHaveLength(1); // Original unchanged
        expect(newState!.tabs).toHaveLength(2); // New array has 2
      });
    });

    describe('Scenario 3.2: Switching Between Tabs', () => {
      let tab1Id: string;
      let tab2Id: string;
      let tab3Id: string;

      beforeEach(() => {
        // Create additional tabs for switching tests
        tab1Id = service.getBrowserState(windowId)!.tabs[0].id;
        tab2Id = service.createTab(windowId, 'https://github.com');
        tab3Id = service.createTab(windowId, 'https://stackoverflow.com');
        ipcEventSpy.clear();
      });

      it('should switch tabs atomically', async () => {
        // Arrange: Currently on tab3
        expect(service.getBrowserState(windowId)!.activeTabId).toBe(tab3Id);

        // Mock scroll position
        const mockView = service.getView(windowId);
        (mockView!.webContents.executeJavaScript as any).mockResolvedValue(150);

        // Act: Switch to tab1
        service.switchTab(windowId, tab1Id);
        await flushPromises();

        // Assert: Active tab updated
        const state = service.getBrowserState(windowId);
        expect(state!.activeTabId).toBe(tab1Id);

        // Assert: Exactly one state update
        expect(ipcEventSpy.getEventCount()).toBe(1);
        const updateEvent = ipcEventSpy.getLastEvent();
        expect(updateEvent.channel).toBe(ON_CLASSIC_BROWSER_STATE);
        expect(updateEvent.payload.update.activeTabId).toBe(tab1Id);

        // Assert: WebContents loads the target tab's URL
        const tab1 = state!.tabs.find(t => t.id === tab1Id);
        expect(mockView!.webContents.loadURL).toHaveBeenCalledWith(tab1!.url);
      });

      it('should save and restore scroll position', async () => {
        // Arrange: Set up scroll position for current tab
        const mockView = service.getView(windowId);
        const scrollPosition = 250;
        (mockView!.webContents.executeJavaScript as any).mockResolvedValue(scrollPosition);

        // Act: Switch away and back
        service.switchTab(windowId, tab1Id);
        await flushPromises();
        service.switchTab(windowId, tab3Id);
        await flushPromises();

        // Assert: Scroll position restored
        expect(mockView!.webContents.executeJavaScript).toHaveBeenCalledWith(
          `window.scrollTo(0, ${scrollPosition})`
        );
      });

      it('should be idempotent when switching to active tab', () => {
        // Arrange: Clear previous events
        ipcEventSpy.clear();
        const currentActiveId = service.getBrowserState(windowId)!.activeTabId;

        // Act: Switch to already active tab
        service.switchTab(windowId, currentActiveId);

        // Assert: No state update emitted (no-op)
        expect(ipcEventSpy.getEventCount()).toBe(0);
      });

      it('should throw error for non-existent tab', () => {
        // Act & Assert
        expect(() => {
          service.switchTab(windowId, 'non-existent-tab-id');
        }).toThrow('Tab not found');
      });
    });

    describe('Scenario 3.3: Closing Tabs', () => {
      let tab1Id: string;
      let tab2Id: string;
      let tab3Id: string;

      beforeEach(() => {
        // Create 3 tabs total
        tab1Id = service.getBrowserState(windowId)!.tabs[0].id;
        tab2Id = service.createTab(windowId, 'https://github.com');
        tab3Id = service.createTab(windowId, 'https://stackoverflow.com');
        // Switch to middle tab
        service.switchTab(windowId, tab2Id);
        ipcEventSpy.clear();
      });

      it('should close middle tab and activate adjacent', () => {
        // Arrange: Verify we're on tab2
        expect(service.getBrowserState(windowId)!.activeTabId).toBe(tab2Id);

        // Act: Close the active middle tab
        service.closeTab(windowId, tab2Id);

        // Assert: Tab removed from array
        const state = service.getBrowserState(windowId);
        expect(state!.tabs).toHaveLength(2);
        expect(state!.tabs.find(t => t.id === tab2Id)).toBeUndefined();

        // Assert: Adjacent tab (tab1 or tab3) is now active
        expect([tab1Id, tab3Id]).toContain(state!.activeTabId);

        // Assert: Exactly one state update
        expect(ipcEventSpy.getEventCount()).toBe(1);
        expect(ipcEventSpy.getLastEvent().payload.payload.tabs).toHaveLength(2);
      });

      it('should close non-active tab without switching', () => {
        // Arrange: On tab2, close tab3
        expect(service.getBrowserState(windowId)!.activeTabId).toBe(tab2Id);

        // Act
        service.closeTab(windowId, tab3Id);

        // Assert: Tab3 removed, still on tab2
        const state = service.getBrowserState(windowId);
        expect(state!.tabs).toHaveLength(2);
        expect(state!.activeTabId).toBe(tab2Id); // No switch
        expect(state!.tabs.find(t => t.id === tab3Id)).toBeUndefined();
      });

      it('should handle closing first tab', () => {
        // Arrange: Switch to first tab
        service.switchTab(windowId, tab1Id);
        ipcEventSpy.clear();

        // Act
        service.closeTab(windowId, tab1Id);

        // Assert: First tab removed, next tab active
        const state = service.getBrowserState(windowId);
        expect(state!.tabs).toHaveLength(2);
        expect(state!.tabs[0].id).toBe(tab2Id); // tab2 is now first
        expect(state!.activeTabId).toBe(tab2Id); // Activated next tab
      });

      it('should maintain immutability when closing tabs', () => {
        // Arrange
        const originalState = service.getBrowserState(windowId);
        const originalTabs = originalState!.tabs;

        // Act
        service.closeTab(windowId, tab2Id);

        // Assert: New array created
        const newState = service.getBrowserState(windowId);
        expect(newState!.tabs).not.toBe(originalTabs);
        expect(originalTabs).toHaveLength(3); // Original unchanged
        expect(newState!.tabs).toHaveLength(2); // New array
      });
    });

    describe('Scenario 4.1: Closing the Last Remaining Tab', () => {
      it('should replace last tab instead of closing', () => {
        // Arrange: Close all but one tab
        const state = service.getBrowserState(windowId)!;
        const [tab1, tab2, tab3] = state.tabs;
        
        service.createTab(windowId); // tab2
        service.createTab(windowId); // tab3
        service.closeTab(windowId, state.tabs[1].id);
        service.closeTab(windowId, state.tabs[2].id);
        ipcEventSpy.clear();

        // Now only one tab remains
        const remainingTabId = service.getBrowserState(windowId)!.tabs[0].id;

        // Act: Try to close the last tab
        service.closeTab(windowId, remainingTabId);

        // Assert: Tab count remains 1
        const newState = service.getBrowserState(windowId);
        expect(newState!.tabs).toHaveLength(1);

        // Assert: Tab was replaced, not closed
        const newTab = newState!.tabs[0];
        expect(newTab.id).not.toBe(remainingTabId); // Different ID
        expect(newTab.url).toBe('https://www.are.na'); // Default URL
        expect(newTab.title).toBe('New Tab');

        // Assert: State update sent
        expect(ipcEventSpy.getEventCount()).toBe(1);
        expect(ipcEventSpy.getLastEvent().payload.payload.tabs).toHaveLength(1);

        // Assert: New tab URL loaded
        const mockView = service.getView(windowId);
        expect(mockView!.webContents.loadURL).toHaveBeenCalledWith('https://www.are.na');
      });
    });

    describe('Scenario 4.2: Idempotency and Error Handling', () => {
      it('should handle double-close gracefully', () => {
        // Arrange: Create an extra tab
        const tabToClose = service.createTab(windowId);
        ipcEventSpy.clear();

        // Act: Close the tab twice
        service.closeTab(windowId, tabToClose);
        
        // Second close should throw
        expect(() => {
          service.closeTab(windowId, tabToClose);
        }).toThrow('Tab not found');

        // Assert: Only one state update
        expect(ipcEventSpy.getEventCount()).toBe(1);
      });

      it('should throw error for non-existent window', () => {
        expect(() => {
          service.createTab('non-existent-window');
        }).toThrow('Browser window not found');

        expect(() => {
          service.switchTab('non-existent-window', 'tab-id');
        }).toThrow('Browser window not found');

        expect(() => {
          service.closeTab('non-existent-window', 'tab-id');
        }).toThrow('Browser window not found');
      });
    });

    describe('Multi-Tab Stress Tests', () => {
      it('should handle rapid tab creation', () => {
        // Act: Create 20 tabs rapidly
        const tabIds: string[] = [];
        for (let i = 0; i < 20; i++) {
          tabIds.push(service.createTab(windowId));
        }

        // Assert: All tabs created
        const state = service.getBrowserState(windowId);
        expect(state!.tabs).toHaveLength(21); // 1 original + 20 new
        
        // Assert: All tab IDs are unique
        const uniqueIds = new Set(state!.tabs.map(t => t.id));
        expect(uniqueIds.size).toBe(21);

        // Assert: Last created tab is active
        expect(state!.activeTabId).toBe(tabIds[tabIds.length - 1]);
      });

      it('should handle rapid tab switching', () => {
        // Arrange: Create 5 tabs
        const tabIds = [service.getBrowserState(windowId)!.tabs[0].id];
        for (let i = 0; i < 4; i++) {
          tabIds.push(service.createTab(windowId));
        }
        ipcEventSpy.clear();

        // Act: Switch rapidly between tabs
        for (let i = 0; i < 50; i++) {
          const randomTab = tabIds[Math.floor(Math.random() * tabIds.length)];
          service.switchTab(windowId, randomTab);
        }

        // Assert: State remains consistent
        const finalState = service.getBrowserState(windowId);
        expect(finalState!.tabs).toHaveLength(5);
        expect(tabIds).toContain(finalState!.activeTabId);
      });

      it('should handle concurrent operations', () => {
        // Arrange: Create initial tabs
        const tab1 = service.getBrowserState(windowId)!.tabs[0].id;
        const tab2 = service.createTab(windowId);
        const tab3 = service.createTab(windowId);

        // Act: Perform operations that could conflict
        service.switchTab(windowId, tab1); // Switch to tab1
        const tab4 = service.createTab(windowId); // Create new tab (switches to it)
        service.closeTab(windowId, tab2); // Close tab2
        
        // Assert: Final state is consistent
        const state = service.getBrowserState(windowId);
        expect(state!.tabs).toHaveLength(3); // 4 created - 1 closed
        expect(state!.activeTabId).toBe(tab4); // Last created tab is active
        expect(state!.tabs.find(t => t.id === tab2)).toBeUndefined(); // tab2 gone
      });
    });
  });

  describe('State Persistence and Recovery', () => {
    it('should correctly initialize from persisted state', async () => {
      // Arrange: Create a complex persisted state
      const persistedPayload = createMockBrowserPayload([
        createMockTabState({ 
          id: 'persisted-1', 
          url: 'https://github.com',
          title: 'GitHub',
          canGoBack: true,
          isLoading: false
        }),
        createMockTabState({ 
          id: 'persisted-2', 
          url: 'https://stackoverflow.com',
          title: 'Stack Overflow',
          canGoForward: true
        }),
        createMockTabState({ 
          id: 'persisted-3', 
          url: 'https://reddit.com',
          title: 'Reddit'
        })
      ], 'persisted-2'); // Middle tab active

      // Act: Initialize service with persisted state
      const windowId = 'persisted-window';
      const bounds = { x: 0, y: 0, width: 1024, height: 768 };
      await service.createBrowserView(windowId, bounds, persistedPayload);

      // Assert: State matches persisted data exactly
      const state = service.getBrowserState(windowId);
      expect(state).toEqual(persistedPayload);
      
      // Assert: Active tab URL is loaded
      const mockView = service.getView(windowId);
      expect(mockView!.webContents.loadURL).toHaveBeenCalledWith('https://stackoverflow.com');
      
      // Assert: No state update sent (using persisted state as-is)
      expect(ipcEventSpy.getEventCount()).toBe(0);
    });

    it('should handle invalid persisted state gracefully', async () => {
      // Arrange: Various invalid states
      const invalidStates = [
        { tabs: null, activeTabId: 'test' },
        { tabs: [], activeTabId: 'test' }, // Empty tabs
        { tabs: [{ id: 'test' }], activeTabId: 'wrong-id' }, // activeTabId not in tabs
        { tabs: 'not-an-array', activeTabId: 'test' },
      ];

      for (const invalidState of invalidStates) {
        // Act: Try to initialize with invalid state
        const windowId = `invalid-window-${Math.random()}`;
        const bounds = { x: 0, y: 0, width: 1024, height: 768 };
        
        await service.createBrowserView(windowId, bounds, invalidState as any);

        // Assert: Service creates valid default state
        const state = service.getBrowserState(windowId);
        expect(state).toBeTruthy();
        expect(Array.isArray(state!.tabs)).toBe(true);
        expect(state!.tabs.length).toBeGreaterThan(0);
        expect(state!.tabs.find(t => t.id === state!.activeTabId)).toBeDefined();
      }
    });
  });

  describe('Edge Cases and Robustness', () => {
    const windowId = 'edge-case-window';
    const bounds = { x: 0, y: 0, width: 1024, height: 768 };

    beforeEach(async () => {
      await service.createBrowserView(windowId, bounds, createMockBrowserPayload());
      ipcEventSpy.clear();
    });

    describe('URL Handling', () => {
      it('should handle malformed URLs gracefully', () => {
        // Act: Create tabs with various malformed URLs
        const weirdUrls = [
          'not-a-url',
          'ftp://old-protocol.com',
          'javascript:alert(1)',
          'about:blank',
          '',
          null as any,
          undefined as any
        ];

        for (const url of weirdUrls) {
          const tabId = service.createTab(windowId, url);
          const state = service.getBrowserState(windowId);
          const tab = state!.tabs.find(t => t.id === tabId);
          
          // Assert: Tab created successfully
          expect(tab).toBeDefined();
          // Service should handle URL validation/normalization
        }
      });

      it('should handle very long URLs', () => {
        // Arrange: Create a very long URL
        const longPath = 'a'.repeat(5000);
        const longUrl = `https://example.com/${longPath}`;

        // Act
        const tabId = service.createTab(windowId, longUrl);

        // Assert: Tab created with long URL
        const state = service.getBrowserState(windowId);
        const tab = state!.tabs.find(t => t.id === tabId);
        expect(tab!.url).toBe(longUrl);
      });
    });

    describe('WebContents Lifecycle', () => {
      it('should handle destroyed WebContents gracefully', () => {
        // Arrange: Simulate destroyed WebContents
        const mockView = service.getView(windowId);
        (mockView!.webContents.isDestroyed as any).mockReturnValue(true);

        // Act: Try various operations
        expect(() => {
          service.createTab(windowId);
        }).not.toThrow();

        expect(() => {
          service.switchTab(windowId, service.getBrowserState(windowId)!.tabs[0].id);
        }).not.toThrow();

        // Service should handle destroyed views gracefully
      });

      it('should handle WebContents crashes', async () => {
        // Arrange: Get current state
        const initialTabs = service.getBrowserState(windowId)!.tabs.length;
        
        // Simulate render process crash
        const mockView = service.getView(windowId);
        const crashListener = (mockView!.webContents.on as any).mock.calls
          .find((call: any[]) => call[0] === 'render-process-gone')[1];

        // Act: Trigger crash
        if (crashListener) {
          crashListener({}, { reason: 'crashed', exitCode: -1 });
          await flushPromises();
        }

        // Assert: Service should handle crash gracefully
        const state = service.getBrowserState(windowId);
        expect(state).toBeTruthy();
        expect(state!.tabs.length).toBe(initialTabs);
      });
    });

    describe('Memory Management', () => {
      it('should clean up event listeners on view destruction', async () => {
        // Arrange: Track event listener cleanup
        const mockView = service.getView(windowId);
        const removeAllListenersSpy = mockView!.webContents.removeAllListeners as any;

        // Act: Destroy the view
        await service.destroyBrowserView(windowId);

        // Assert: Listeners cleaned up
        expect(removeAllListenersSpy).toHaveBeenCalled();
      });

      it('should handle memory pressure with many tabs', () => {
        // Act: Create many tabs
        const tabIds: string[] = [];
        for (let i = 0; i < 100; i++) {
          tabIds.push(service.createTab(windowId, `https://example.com/page${i}`));
        }

        // Assert: All tabs manageable
        const state = service.getBrowserState(windowId);
        expect(state!.tabs).toHaveLength(101); // 1 original + 100 new

        // Act: Close half the tabs
        for (let i = 0; i < 50; i++) {
          service.closeTab(windowId, tabIds[i]);
        }

        // Assert: Memory freed correctly
        const finalState = service.getBrowserState(windowId);
        expect(finalState!.tabs).toHaveLength(51);
      });
    });

    describe('Race Conditions', () => {
      it('should handle rapid create/close operations', () => {
        // Act: Rapidly create and close tabs
        const operations: Array<() => void> = [];
        
        for (let i = 0; i < 20; i++) {
          operations.push(() => {
            const tabId = service.createTab(windowId);
            // Immediately try to close it
            try {
              service.closeTab(windowId, tabId);
            } catch (e) {
              // Tab might already be closed
            }
          });
        }

        // Execute all operations
        operations.forEach(op => op());

        // Assert: Service remains in consistent state
        const state = service.getBrowserState(windowId);
        expect(state).toBeTruthy();
        expect(state!.tabs.length).toBeGreaterThan(0);
        expect(state!.tabs.find(t => t.id === state!.activeTabId)).toBeDefined();
      });

      it('should handle concurrent switch and close', () => {
        // Arrange: Create multiple tabs
        const tab1 = service.getBrowserState(windowId)!.tabs[0].id;
        const tab2 = service.createTab(windowId);
        const tab3 = service.createTab(windowId);

        // Act: Try to switch to a tab while closing it
        try {
          service.closeTab(windowId, tab2);
          service.switchTab(windowId, tab2); // Should fail
        } catch (e) {
          // Expected
        }

        // Assert: State remains consistent
        const state = service.getBrowserState(windowId);
        expect(state!.tabs.find(t => t.id === tab2)).toBeUndefined();
        expect([tab1, tab3]).toContain(state!.activeTabId);
      });
    });

    describe('Navigation State Edge Cases', () => {
      it('should handle navigation state updates during tab switch', async () => {
        // Arrange: Create tabs with different navigation states
        const tab1 = service.getBrowserState(windowId)!.tabs[0].id;
        const tab2 = service.createTab(windowId);

        // Simulate navigation state change
        const mockView = service.getView(windowId);
        const navListener = (mockView!.webContents.on as any).mock.calls
          .find((call: any[]) => call[0] === 'did-navigate')[1];

        // Act: Navigate while switching tabs
        service.switchTab(windowId, tab1);
        if (navListener) {
          navListener({}, 'https://example.com/new-page');
        }
        service.switchTab(windowId, tab2);

        // Assert: Navigation state preserved per tab
        const state = service.getBrowserState(windowId);
        const tab1State = state!.tabs.find(t => t.id === tab1);
        expect(tab1State!.url).toBe('https://example.com/new-page');
      });
    });

    describe('Error Recovery', () => {
      it('should recover from partial initialization failure', async () => {
        // Arrange: Make WebContentsView constructor throw on first call
        const { WebContentsView } = require('electron');
        let callCount = 0;
        WebContentsView.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Initialization failure');
          }
          return createMockWebContentsView();
        });

        // Act: Try to create view (will fail)
        const failWindowId = 'fail-window';
        await expect(
          service.createBrowserView(failWindowId, bounds, createMockBrowserPayload())
        ).rejects.toThrow();

        // Act: Try again (should succeed)
        await expect(
          service.createBrowserView(failWindowId, bounds, createMockBrowserPayload())
        ).resolves.not.toThrow();

        // Assert: Service recovered and works normally
        const state = service.getBrowserState(failWindowId);
        expect(state).toBeTruthy();
        expect(state!.tabs.length).toBeGreaterThan(0);
      });
    });
  });
});