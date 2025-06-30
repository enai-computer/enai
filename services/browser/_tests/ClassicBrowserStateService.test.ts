import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import { ClassicBrowserStateService } from '../ClassicBrowserStateService';
import { ClassicBrowserPayload, TabState, BrowserFreezeState } from '../../../shared/types';
import { ON_CLASSIC_BROWSER_STATE } from '../../../shared/ipcChannels';

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn()
}));

describe('ClassicBrowserStateService', () => {
  let service: ClassicBrowserStateService;
  let mockMainWindow: any;
  let eventEmitter: EventEmitter;
  let mockWebContents: any;

  beforeEach(() => {
    // Create mock webContents
    mockWebContents = {
      send: vi.fn()
    };

    // Create mock BrowserWindow
    mockMainWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: mockWebContents
    };

    // Create event emitter
    eventEmitter = new EventEmitter();

    // Create service
    service = new ClassicBrowserStateService({
      mainWindow: mockMainWindow,
      eventEmitter
    });
  });

  afterEach(async () => {
    await service.cleanup();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await service.initialize();
      
      // Verify event listener is set up
      expect(eventEmitter.listenerCount('prefetch:favicon-found')).toBe(1);
    });

    it('should handle favicon updates from prefetch', async () => {
      await service.initialize();

      // Create test state
      const windowId = 'test-window';
      const testState: ClassicBrowserPayload = {
        tabs: [{
          id: 'tab1',
          url: 'https://example.com',
          title: 'Example',
          faviconUrl: null,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          error: null
        }],
        activeTabId: 'tab1',
        freezeState: { type: 'ACTIVE' }
      };
      
      service.states.set(windowId, testState);

      // Emit favicon update
      eventEmitter.emit('prefetch:favicon-found', {
        windowId,
        faviconUrl: 'https://example.com/favicon.ico'
      });

      // Verify IPC send was called with favicon update
      expect(mockWebContents.send).toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_STATE,
        expect.objectContaining({
          windowId,
          update: expect.objectContaining({
            tabs: expect.arrayContaining([
              expect.objectContaining({
                faviconUrl: 'https://example.com/favicon.ico'
              })
            ])
          })
        })
      );
    });
  });

  describe('sendStateUpdate', () => {
    let testState: ClassicBrowserPayload;
    const windowId = 'test-window';

    beforeEach(() => {
      testState = {
        tabs: [
          {
            id: 'tab1',
            url: 'https://example.com',
            title: 'Example',
            faviconUrl: null,
            isLoading: false,
            canGoBack: false,
            canGoForward: false,
            error: null
          },
          {
            id: 'tab2',
            url: 'https://test.com',
            title: 'Test',
            faviconUrl: null,
            isLoading: false,
            canGoBack: false,
            canGoForward: false,
            error: null
          }
        ],
        activeTabId: 'tab1',
        freezeState: { type: 'ACTIVE' }
      };
      
      service.states.set(windowId, testState);
    });

    it('should send complete state update', () => {
      service.sendStateUpdate(windowId);

      expect(mockWebContents.send).toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_STATE,
        {
          windowId,
          update: {
            tabs: testState.tabs,
            activeTabId: testState.activeTabId
          }
        }
      );
    });

    it('should update tab state and send update', () => {
      const tabUpdate: Partial<TabState> = {
        title: 'Updated Title',
        isLoading: true
      };

      service.sendStateUpdate(windowId, tabUpdate);

      // Verify the tab was updated in the state
      const updatedState = service.states.get(windowId);
      expect(updatedState?.tabs[0].title).toBe('Updated Title');
      expect(updatedState?.tabs[0].isLoading).toBe(true);

      // Verify IPC send
      expect(mockWebContents.send).toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_STATE,
        {
          windowId,
          update: {
            tabs: expect.arrayContaining([
              expect.objectContaining({
                id: 'tab1',
                title: 'Updated Title',
                isLoading: true
              })
            ]),
            activeTabId: 'tab1'
          }
        }
      );
    });

    it('should update active tab ID', () => {
      service.sendStateUpdate(windowId, undefined, 'tab2');

      // Verify state was updated
      const updatedState = service.states.get(windowId);
      expect(updatedState?.activeTabId).toBe('tab2');

      // Verify IPC send
      expect(mockWebContents.send).toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_STATE,
        {
          windowId,
          update: {
            tabs: testState.tabs,
            activeTabId: 'tab2'
          }
        }
      );
    });

    it('should handle non-existent window ID', () => {
      service.sendStateUpdate('non-existent');

      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    it('should not send update if main window is destroyed', () => {
      mockMainWindow.isDestroyed.mockReturnValue(true);

      service.sendStateUpdate(windowId);

      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    it('should handle missing active tab ID when updating tab', () => {
      // Remove active tab ID
      testState.activeTabId = '';
      
      service.sendStateUpdate(windowId, { title: 'New Title' });

      // Should still send the update with empty activeTabId
      expect(mockWebContents.send).toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_STATE,
        expect.objectContaining({
          windowId,
          update: expect.objectContaining({
            activeTabId: ''
          })
        })
      );
    });
  });

  describe('findTabState', () => {
    it('should find tab across multiple windows', () => {
      // Set up multiple windows
      const window1State: ClassicBrowserPayload = {
        tabs: [{ id: 'tab1', url: 'url1', title: 'Tab 1', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab1',
        freezeState: { type: 'ACTIVE' }
      };

      const window2State: ClassicBrowserPayload = {
        tabs: [{ id: 'tab2', url: 'url2', title: 'Tab 2', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'tab2',
        freezeState: { type: 'ACTIVE' }
      };

      service.states.set('window1', window1State);
      service.states.set('window2', window2State);

      // Find tab in window2
      const result = service.findTabState('tab2');
      
      expect(result).not.toBeNull();
      expect(result?.tab.id).toBe('tab2');
      expect(result?.state).toBe(window2State);
    });

    it('should return null for non-existent tab', () => {
      const result = service.findTabState('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('updateTabBookmarkStatus', () => {
    const windowId = 'test-window';
    const tabId = 'tab1';

    beforeEach(() => {
      const testState: ClassicBrowserPayload = {
        tabs: [{
          id: tabId,
          url: 'https://example.com',
          title: 'Example',
          faviconUrl: null,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          error: null,
          isBookmarked: false,
          bookmarkStatus: 'idle'
        }],
        activeTabId: tabId,
        freezeState: { type: 'ACTIVE' }
      };
      
      service.states.set(windowId, testState);
    });

    it('should update bookmark status to processing', () => {
      const jobId = 'job123';
      
      service.updateTabBookmarkStatus(windowId, tabId, 'processing', jobId);

      const state = service.states.get(windowId);
      const tab = state?.tabs[0];
      
      expect(tab?.bookmarkStatus).toBe('processing');
      expect(tab?.processingJobId).toBe(jobId);
      expect(mockWebContents.send).toHaveBeenCalled();
    });

    it('should update bookmark status to completed and set bookmarked flags', () => {
      const beforeTime = new Date().toISOString();
      
      service.updateTabBookmarkStatus(windowId, tabId, 'completed');

      const state = service.states.get(windowId);
      const tab = state?.tabs[0];
      
      expect(tab?.bookmarkStatus).toBe('completed');
      expect(tab?.isBookmarked).toBe(true);
      expect(tab?.bookmarkedAt).toBeDefined();
      
      // Verify bookmarkedAt is a valid ISO string and recent
      const bookmarkedAt = new Date(tab!.bookmarkedAt!);
      expect(bookmarkedAt.getTime()).toBeGreaterThanOrEqual(new Date(beforeTime).getTime());
    });

    it('should update bookmark status to error', () => {
      const errorMessage = 'Failed to bookmark';
      
      service.updateTabBookmarkStatus(windowId, tabId, 'error', undefined, errorMessage);

      const state = service.states.get(windowId);
      const tab = state?.tabs[0];
      
      expect(tab?.bookmarkStatus).toBe('error');
      expect(tab?.bookmarkError).toBe(errorMessage);
    });

    it('should handle non-existent window', () => {
      service.updateTabBookmarkStatus('non-existent', tabId, 'processing');
      
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    it('should handle non-existent tab', () => {
      service.updateTabBookmarkStatus(windowId, 'non-existent', 'processing');
      
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });
  });

  describe('refreshTabState', () => {
    const windowId = 'test-window';

    beforeEach(() => {
      const testState: ClassicBrowserPayload = {
        tabs: [{
          id: 'tab1',
          url: 'https://example.com',
          title: 'Example',
          faviconUrl: null,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          error: null,
          isBookmarked: true,
          bookmarkedAt: '2024-01-01T00:00:00Z'
        }],
        activeTabId: 'tab1',
        freezeState: { type: 'ACTIVE' }
      };
      
      service.states.set(windowId, testState);
    });

    it('should update bookmark state from external changes', async () => {
      const newBookmarkedAt = '2024-01-02T00:00:00Z';
      
      await service.refreshTabState(windowId, 'https://example.com', true, newBookmarkedAt);

      expect(mockWebContents.send).toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_STATE,
        expect.objectContaining({
          windowId,
          update: expect.objectContaining({
            tabs: expect.arrayContaining([
              expect.objectContaining({
                isBookmarked: true,
                bookmarkedAt: newBookmarkedAt
              })
            ])
          })
        })
      );
    });

    it('should handle bookmark deletion', async () => {
      await service.refreshTabState(windowId, 'https://example.com', false, null);

      expect(mockWebContents.send).toHaveBeenCalledWith(
        ON_CLASSIC_BROWSER_STATE,
        expect.objectContaining({
          windowId,
          update: expect.objectContaining({
            tabs: expect.arrayContaining([
              expect.objectContaining({
                isBookmarked: false,
                bookmarkedAt: null
              })
            ])
          })
        })
      );
    });
  });

  describe('getActiveTab', () => {
    it('should return active tab', () => {
      const testState: ClassicBrowserPayload = {
        tabs: [
          { id: 'tab1', url: 'url1', title: 'Tab 1', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null },
          { id: 'tab2', url: 'url2', title: 'Tab 2', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }
        ],
        activeTabId: 'tab2',
        freezeState: { type: 'ACTIVE' }
      };
      
      service.states.set('window1', testState);

      const activeTab = service.getActiveTab('window1');
      
      expect(activeTab).toBeDefined();
      expect(activeTab?.id).toBe('tab2');
    });

    it('should return undefined for non-existent window', () => {
      const activeTab = service.getActiveTab('non-existent');
      expect(activeTab).toBeUndefined();
    });

    it('should return undefined if no active tab', () => {
      const testState: ClassicBrowserPayload = {
        tabs: [{ id: 'tab1', url: 'url1', title: 'Tab 1', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }],
        activeTabId: 'non-existent-tab',
        freezeState: { type: 'ACTIVE' }
      };
      
      service.states.set('window1', testState);

      const activeTab = service.getActiveTab('window1');
      expect(activeTab).toBeUndefined();
    });
  });

  describe('getTab', () => {
    it('should return specific tab', () => {
      const testState: ClassicBrowserPayload = {
        tabs: [
          { id: 'tab1', url: 'url1', title: 'Tab 1', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null },
          { id: 'tab2', url: 'url2', title: 'Tab 2', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }
        ],
        activeTabId: 'tab1',
        freezeState: { type: 'ACTIVE' }
      };
      
      service.states.set('window1', testState);

      const tab = service.getTab('window1', 'tab2');
      
      expect(tab).toBeDefined();
      expect(tab?.id).toBe('tab2');
      expect(tab?.title).toBe('Tab 2');
    });

    it('should return undefined for non-existent tab', () => {
      const testState: ClassicBrowserPayload = {
        tabs: [],
        activeTabId: '',
        freezeState: { type: 'ACTIVE' }
      };
      
      service.states.set('window1', testState);

      const tab = service.getTab('window1', 'non-existent');
      expect(tab).toBeUndefined();
    });

    it('should return undefined for non-existent window', () => {
      const tab = service.getTab('non-existent', 'tab1');
      expect(tab).toBeUndefined();
    });
  });

  describe('getActiveTabId', () => {
    it('should return active tab ID', () => {
      const testState: ClassicBrowserPayload = {
        tabs: [],
        activeTabId: 'tab-123',
        freezeState: { type: 'ACTIVE' }
      };
      
      service.states.set('window1', testState);

      const activeTabId = service.getActiveTabId('window1');
      expect(activeTabId).toBe('tab-123');
    });

    it('should return undefined for non-existent window', () => {
      const activeTabId = service.getActiveTabId('non-existent');
      expect(activeTabId).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should remove event listeners and clear states', async () => {
      await service.initialize();
      
      // Add some state
      service.states.set('window1', {
        tabs: [],
        activeTabId: '',
        freezeState: { type: 'ACTIVE' }
      });

      await service.cleanup();

      // Verify event listener is removed
      expect(eventEmitter.listenerCount('prefetch:favicon-found')).toBe(0);
      
      // Verify states are cleared
      expect(service.states.size).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty tabs array', () => {
      const windowId = 'test-window';
      const testState: ClassicBrowserPayload = {
        tabs: [],
        activeTabId: '',
        freezeState: { type: 'ACTIVE' }
      };
      
      service.states.set(windowId, testState);

      // Should not throw
      service.sendStateUpdate(windowId, { title: 'Test' });

      expect(mockWebContents.send).toHaveBeenCalled();
    });

    it('should maintain immutability when updating tabs', () => {
      const windowId = 'test-window';
      const originalTabs = [
        { id: 'tab1', url: 'url1', title: 'Tab 1', faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false, error: null }
      ];
      
      const testState: ClassicBrowserPayload = {
        tabs: originalTabs,
        activeTabId: 'tab1',
        freezeState: { type: 'ACTIVE' }
      };
      
      service.states.set(windowId, testState);

      // Update tab
      service.sendStateUpdate(windowId, { title: 'Updated' });

      // Verify original array wasn't mutated
      expect(originalTabs[0].title).toBe('Tab 1');
      
      // Verify new state has updated value
      const newState = service.states.get(windowId);
      expect(newState?.tabs[0].title).toBe('Updated');
      expect(newState?.tabs).not.toBe(originalTabs);
    });

    it('should handle null mainWindow gracefully', () => {
      const serviceWithNullWindow = new ClassicBrowserStateService({
        mainWindow: null as any,
        eventEmitter
      });

      const windowId = 'test-window';
      serviceWithNullWindow.states.set(windowId, {
        tabs: [],
        activeTabId: '',
        freezeState: { type: 'ACTIVE' }
      });

      // Should not throw
      serviceWithNullWindow.sendStateUpdate(windowId);
    });
  });
});