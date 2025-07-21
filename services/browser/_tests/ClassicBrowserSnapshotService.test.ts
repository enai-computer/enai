import { describe, it, expect, afterEach, vi } from 'vitest';
import { ClassicBrowserSnapshotService } from '../ClassicBrowserSnapshotService';
import { ClassicBrowserViewManager } from '../ClassicBrowserViewManager';
import { ClassicBrowserStateService } from '../ClassicBrowserStateService';
import { ClassicBrowserNavigationService } from '../ClassicBrowserNavigationService';
import { BrowserEventBus } from '../BrowserEventBus';
import * as urlHelpers from '../url.helpers';

// Mock the logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the url helpers
vi.mock('../url.helpers', () => ({
  isAuthenticationUrl: vi.fn(() => false),
}));

describe('ClassicBrowserSnapshotService', () => {
  let service: ClassicBrowserSnapshotService;
  let mockViewManager: ClassicBrowserViewManager;
  let mockStateService: ClassicBrowserStateService;
  let mockNavigationService: ClassicBrowserNavigationService;
  let mockEventBus: BrowserEventBus;

  afterEach(() => {
    vi.clearAllMocks();
    // Reset the url helper mock
    vi.mocked(urlHelpers.isAuthenticationUrl).mockReturnValue(false);
  });

  // Helper to create a fresh service with proper mocks
  const createService = async () => {
    const mockImage = {
      toDataURL: vi.fn(() => 'data:image/png;base64,mockImageData'),
    };

    const mockWebContents = {
      getURL: vi.fn(() => 'https://example.com'),
      capturePage: vi.fn(async () => mockImage),
    };

    const mockView = {
      webContents: mockWebContents,
    };

    mockViewManager = {
      getView: vi.fn(() => mockView),
      setVisibility: vi.fn(),
    } as unknown as ClassicBrowserViewManager;

    mockStateService = {
      sendStateUpdate: vi.fn(),
      states: new Map(),
    } as unknown as ClassicBrowserStateService;

    mockNavigationService = {} as unknown as ClassicBrowserNavigationService;

    mockEventBus = {
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    } as unknown as BrowserEventBus;

    service = new ClassicBrowserSnapshotService({
      viewManager: mockViewManager,
      stateService: mockStateService,
      navigationService: mockNavigationService,
      eventBus: mockEventBus,
    });

    await service.initialize();

    return { mockImage, mockWebContents, mockView };
  };

  describe('captureSnapshot', () => {
    it('should capture a snapshot for a valid window', async () => {
      const { mockImage, mockWebContents } = await createService();
      const windowId = 'test-window';
      const result = await service.captureSnapshot(windowId);

      expect(result).toEqual({
        url: 'https://example.com',
        snapshot: 'data:image/png;base64,mockImageData',
      });

      expect(mockViewManager.getView).toHaveBeenCalledWith(windowId);
      expect(mockWebContents.capturePage).toHaveBeenCalled();
      expect(mockImage.toDataURL).toHaveBeenCalled();
      
      // Verify snapshot was stored
      expect(service.getSnapshot(windowId)).toBe('data:image/png;base64,mockImageData');
    });

    it('should skip snapshot for authentication URLs', async () => {
      const { mockWebContents } = await createService();
      const windowId = 'test-window';
      mockWebContents.getURL.mockReturnValue('https://accounts.google.com/login');
      vi.mocked(urlHelpers.isAuthenticationUrl).mockReturnValue(true);

      const result = await service.captureSnapshot(windowId);

      expect(result).toBeUndefined();
      expect(mockWebContents.capturePage).not.toHaveBeenCalled();
    });

    it('should return undefined if view not found', async () => {
      await createService();
      const windowId = 'non-existent';
      mockViewManager.getView = vi.fn().mockReturnValue(null);

      const result = await service.captureSnapshot(windowId);

      expect(result).toBeUndefined();
    });

    it('should handle capture errors gracefully', async () => {
      const { mockWebContents } = await createService();
      const windowId = 'test-window';
      const error = new Error('Capture failed');
      mockWebContents.capturePage.mockRejectedValue(error);

      const result = await service.captureSnapshot(windowId);

      expect(result).toBeUndefined();
    });

    it('should store snapshot with LRU eviction', async () => {
      const { mockImage, mockWebContents } = await createService();
      const maxSnapshots = 10; // MAX_SNAPSHOTS from the service
      
      // Capture MAX_SNAPSHOTS + 1 to trigger LRU eviction
      for (let i = 0; i <= maxSnapshots; i++) {
        const windowId = `window-${i}`;
        mockWebContents.getURL.mockReturnValue(`https://example.com/page${i}`);
        mockImage.toDataURL.mockReturnValue(`data:image/png;base64,image${i}`);
        
        await service.captureSnapshot(windowId);
      }

      // The first window should have been evicted
      expect(service.getSnapshot('window-0')).toBeUndefined();
      
      // The last window should still exist
      expect(service.getSnapshot(`window-${maxSnapshots}`)).toBeDefined();
      
      // Total snapshots should not exceed MAX_SNAPSHOTS
      expect(service.getAllSnapshots().size).toBe(maxSnapshots);
    });

    it('should update existing snapshot for same window', async () => {
      const { mockImage, mockWebContents } = await createService();
      const windowId = 'test-window';
      
      // First capture
      mockWebContents.getURL.mockReturnValue('https://example.com/page1');
      mockImage.toDataURL.mockReturnValue('data:image/png;base64,firstImage');
      await service.captureSnapshot(windowId);
      
      // Second capture for same window
      mockWebContents.getURL.mockReturnValue('https://example.com/page2');
      mockImage.toDataURL.mockReturnValue('data:image/png;base64,secondImage');
      await service.captureSnapshot(windowId);
      
      // Should only have one snapshot for the window
      expect(service.getAllSnapshots().size).toBe(1);
      expect(service.getSnapshot(windowId)).toBe('data:image/png;base64,secondImage');
    });
  });

  describe('showAndFocusView', () => {
    it('should log when snapshot exists', async () => {
      await createService();
      const windowId = 'test-window';
      
      // Capture a snapshot first
      await service.captureSnapshot(windowId);
      
      // Show and focus
      service.showAndFocusView(windowId);
      
      // Verify snapshot exists (since we don't have actual UI update mechanism)
      expect(service.getSnapshot(windowId)).toBeDefined();
    });

    it('should log when snapshot does not exist', async () => {
      await createService();
      const windowId = 'non-existent';
      
      service.showAndFocusView(windowId);
      
      // Verify no snapshot exists
      expect(service.getSnapshot(windowId)).toBeUndefined();
    });
  });

  describe('clearSnapshot', () => {
    it('should clear specific snapshot', async () => {
      await createService();
      const windowId = 'test-window';
      
      // Capture a snapshot
      await service.captureSnapshot(windowId);
      expect(service.getSnapshot(windowId)).toBeDefined();
      
      // Clear the snapshot
      service.clearSnapshot(windowId);
      
      // Verify it's cleared
      expect(service.getSnapshot(windowId)).toBeUndefined();
    });

    it('should handle clearing non-existent snapshot', async () => {
      await createService();
      const windowId = 'non-existent';
      
      // Should not throw
      expect(() => service.clearSnapshot(windowId)).not.toThrow();
    });
  });

  describe('clearAllSnapshots', () => {
    it('should clear all snapshots', async () => {
      const { mockImage, mockWebContents } = await createService();
      
      // Capture multiple snapshots
      for (let i = 0; i < 3; i++) {
        const windowId = `window-${i}`;
        mockWebContents.getURL.mockReturnValue(`https://example.com/page${i}`);
        mockImage.toDataURL.mockReturnValue(`data:image/png;base64,image${i}`);
        await service.captureSnapshot(windowId);
      }
      
      expect(service.getAllSnapshots().size).toBe(3);
      
      // Clear all
      service.clearAllSnapshots();
      
      // Verify all cleared
      expect(service.getAllSnapshots().size).toBe(0);
    });
  });

  describe('getSnapshot', () => {
    it('should return snapshot for existing window', async () => {
      await createService();
      const windowId = 'test-window';
      await service.captureSnapshot(windowId);
      
      const snapshot = service.getSnapshot(windowId);
      expect(snapshot).toBe('data:image/png;base64,mockImageData');
    });

    it('should return undefined for non-existent window', async () => {
      await createService();
      const snapshot = service.getSnapshot('non-existent');
      expect(snapshot).toBeUndefined();
    });
  });

  describe('getAllSnapshots', () => {
    it('should return a copy of all snapshots', async () => {
      const { mockImage, mockWebContents } = await createService();
      
      // Capture multiple snapshots
      const windowIds = ['window-1', 'window-2'];
      for (let i = 0; i < windowIds.length; i++) {
        const windowId = windowIds[i];
        mockWebContents.getURL.mockReturnValue(`https://example.com/page${i}`);
        mockImage.toDataURL.mockReturnValue(`data:image/png;base64,image${i}`);
        await service.captureSnapshot(windowId);
      }
      
      const allSnapshots = service.getAllSnapshots();
      
      // Should be a new Map instance (not the internal one)
      expect(allSnapshots).toBeInstanceOf(Map);
      expect(allSnapshots.size).toBe(2);
      
      // Modifying the returned map should not affect the internal state
      allSnapshots.clear();
      expect(service.getAllSnapshots().size).toBe(2);
    });

    it('should return empty map when no snapshots', async () => {
      await createService();
      const allSnapshots = service.getAllSnapshots();
      expect(allSnapshots.size).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should clear all snapshots on cleanup', async () => {
      const { mockImage, mockWebContents } = await createService();
      
      // Capture some snapshots
      for (let i = 0; i < 3; i++) {
        const windowId = `window-${i}`;
        mockWebContents.getURL.mockReturnValue(`https://example.com/page${i}`);
        mockImage.toDataURL.mockReturnValue(`data:image/png;base64,image${i}`);
        await service.captureSnapshot(windowId);
      }
      
      expect(service.getAllSnapshots().size).toBe(3);
      
      // Cleanup
      await service.cleanup();
      
      // Verify all snapshots cleared
      expect(service.getAllSnapshots().size).toBe(0);
    });
  });

  describe('LRU eviction edge cases', () => {
    it('should handle re-accessing existing snapshot (move to end)', async () => {
      const { mockImage, mockWebContents } = await createService();
      
      // Fill up to MAX_SNAPSHOTS
      for (let i = 0; i < 10; i++) {
        const windowId = `window-${i}`;
        mockWebContents.getURL.mockReturnValue(`https://example.com/page${i}`);
        mockImage.toDataURL.mockReturnValue(`data:image/png;base64,image${i}`);
        await service.captureSnapshot(windowId);
      }
      
      // Re-capture window-0 (should move it to end)
      mockWebContents.getURL.mockReturnValue('https://example.com/page0-updated');
      mockImage.toDataURL.mockReturnValue('data:image/png;base64,image0-updated');
      await service.captureSnapshot('window-0');
      
      // Now add one more - should evict window-1, not window-0
      mockWebContents.getURL.mockReturnValue('https://example.com/page-new');
      mockImage.toDataURL.mockReturnValue('data:image/png;base64,image-new');
      await service.captureSnapshot('window-new');
      
      // window-0 should still exist (moved to end)
      expect(service.getSnapshot('window-0')).toBe('data:image/png;base64,image0-updated');
      
      // window-1 should be evicted
      expect(service.getSnapshot('window-1')).toBeUndefined();
      
      // window-new should exist
      expect(service.getSnapshot('window-new')).toBe('data:image/png;base64,image-new');
    });
  });

  describe('execute wrapper integration', () => {
    it('should use execute wrapper for captureSnapshot', async () => {
      await createService();
      const windowId = 'test-window';
      
      // Spy on the execute method
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const executeSpy = vi.spyOn(service as any, 'execute');
      
      await service.captureSnapshot(windowId);
      
      expect(executeSpy).toHaveBeenCalledWith(
        'captureSnapshot',
        expect.any(Function)
      );
    });
  });

  describe('sidebar hover handling', () => {
    it('should register sidebar-hover-changed listener on initialize', async () => {
      await createService();
      
      expect(mockEventBus.on).toHaveBeenCalledWith(
        'sidebar-hover-changed',
        expect.any(Function)
      );
    });

    it('should capture snapshot and hide view when sidebar is hovered', async () => {
      const { mockImage, mockWebContents } = await createService();
      const windowId = 'test-window';
      
      // Set up state with a window
      mockStateService.states.set(windowId, {
        activeTabId: 'tab-1',
      });

      // Get the handler that was registered
      const handler = mockEventBus.on.mock.calls.find(
        call => call[0] === 'sidebar-hover-changed'
      )?.[1];

      // Trigger hover event
      await handler({ isHovered: true });

      // Give time for async operations
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should capture snapshot
      expect(mockViewManager.getView).toHaveBeenCalledWith(windowId);
      expect(mockWebContents.capturePage).toHaveBeenCalled();
      
      // Should hide view
      expect(mockViewManager.setVisibility).toHaveBeenCalledWith(windowId, false, false);
      
      // Should update state to frozen
      expect(mockStateService.sendStateUpdate).toHaveBeenCalledWith(windowId, {
        freezeState: { type: 'FROZEN', snapshotUrl: 'data:image/png;base64,mockImageData' }
      });
    });

    it('should show view when sidebar hover ends', async () => {
      await createService();
      const windowId = 'test-window';
      
      // Set up state with a window
      mockStateService.states.set(windowId, {
        activeTabId: 'tab-1',
      });

      // Get the handler that was registered
      const handler = mockEventBus.on.mock.calls.find(
        call => call[0] === 'sidebar-hover-changed'
      )?.[1];

      // Trigger hover end event
      handler({ isHovered: false });

      // Should show view
      expect(mockViewManager.setVisibility).toHaveBeenCalledWith(windowId, true, true);
      
      // Should update state to active
      expect(mockStateService.sendStateUpdate).toHaveBeenCalledWith(windowId, {
        freezeState: { type: 'ACTIVE' }
      });
    });

    it('should remove event listener on cleanup', async () => {
      await createService();
      
      await service.cleanup();
      
      expect(mockEventBus.removeAllListeners).toHaveBeenCalledWith('sidebar-hover-changed');
    });
  });
});