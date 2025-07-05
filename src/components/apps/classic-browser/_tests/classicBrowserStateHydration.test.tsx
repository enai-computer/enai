import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ClassicBrowser } from '../../src/components/apps/classic-browser/ClassicBrowser';
import { 
  createMockWindowApi, 
  createMockBrowserPayload, 
  createMockTabState,
  flushPromises 
} from '../utils/classicBrowserMocks';
import type { ClassicBrowserPayload } from '../../shared/types';
import { useWindowStore } from '../../src/store/windowStoreFactory';

// Mock the window store
vi.mock('../../src/store/windowStoreFactory', () => ({
  useWindowStore: vi.fn()
}));

// Mock the cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' ')
}));

describe('ClassicBrowser State Hydration', () => {
  let mockApi: ReturnType<typeof createMockWindowApi>;
  let mockStore: any;
  
  beforeEach(() => {
    mockApi = createMockWindowApi();
    (global as any).window = { api: mockApi };
    
    // Create mock store that returns persisted state
    mockStore = {
      classicBrowserPayload: null,
      setClassicBrowserPayload: vi.fn()
    };
    
    // Configure the already-mocked useWindowStore
    vi.mocked(useWindowStore).mockImplementation(() => mockStore);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Scenario 2.1: State Hydration on App Restart', () => {
    it('should correctly initialize backend from frontend persisted state', async () => {
      // Arrange: Create a mock payload representing a previous session with multiple tabs
      const persistedPayload: ClassicBrowserPayload = createMockBrowserPayload([
        createMockTabState({ 
          id: 'tab-1', 
          url: 'https://github.com', 
          title: 'GitHub',
          canGoBack: true 
        }),
        createMockTabState({ 
          id: 'tab-2', 
          url: 'https://stackoverflow.com', 
          title: 'Stack Overflow',
          canGoForward: true 
        }),
        createMockTabState({ 
          id: 'tab-3', 
          url: 'https://www.are.na', 
          title: 'Are.na' 
        })
      ], 'tab-2'); // tab-2 is active

      // Configure store to have the persisted payload
      mockStore.classicBrowserPayload = persistedPayload;

      // Act: Mount the ClassicBrowser
      const windowId = 'test-window-123';
      render(<ClassicBrowser windowId={windowId} />);

      // Wait for async operations  
      await waitFor(() => {
        expect(mockApi.classicBrowserCreate).toHaveBeenCalled();
      });

      // 2. classicBrowserCreate should be called exactly once
      expect(mockApi.classicBrowserCreate).toHaveBeenCalledTimes(1);

      // 3. The payload passed must exactly match the hydrated payload
      expect(mockApi.classicBrowserCreate).toHaveBeenCalledWith(
        windowId,
        expect.any(Object), // bounds
        persistedPayload
      );

      // 4. No tab creation calls should happen (we're restoring, not creating)
      expect(mockApi.classicBrowserCreateTab).not.toHaveBeenCalled();

      // 5. No state overwrite should occur (no immediate state update from backend)
      expect(mockApi.on).toHaveBeenCalledWith(
        `ON_CLASSIC_BROWSER_STATE_${windowId}`,
        expect.any(Function)
      );
    });

    it('should handle corrupted persisted state gracefully', async () => {
      // Arrange: Return corrupted state from storage
      const corruptedPayload = { 
        tabs: null, // Invalid: tabs should be an array
        activeTabId: 'non-existent' 
      };
      mockApi.storeGet.mockResolvedValueOnce(corruptedPayload);

      // Act: Mount the component
      const windowId = 'test-window-456';
      render(<ClassicBrowser windowId={windowId} />);

      await waitFor(() => {
        expect(mockApi.classicBrowserCreate).toHaveBeenCalled();
      });

      // Assert: Backend should be initialized with a valid default state
      const callArgs = mockApi.classicBrowserCreate.mock.calls[0];
      const passedPayload = callArgs[2] as ClassicBrowserPayload;
      
      // Should have created a default valid state
      expect(Array.isArray(passedPayload.tabs)).toBe(true);
      expect(passedPayload.tabs.length).toBeGreaterThan(0);
      expect(passedPayload.activeTabId).toBeTruthy();
      expect(passedPayload.tabs.find(t => t.id === passedPayload.activeTabId)).toBeDefined();
    });

    it('should initialize with default state when no persisted state exists', async () => {
      // Arrange: No persisted state
      mockApi.storeGet.mockResolvedValueOnce(null);

      // Act: Mount the component
      const windowId = 'test-window-789';
      render(<ClassicBrowser windowId={windowId} />);

      await waitFor(() => {
        expect(mockApi.classicBrowserCreate).toHaveBeenCalled();
      });

      // Assert: Should create with default state
      const callArgs = mockApi.classicBrowserCreate.mock.calls[0];
      const passedPayload = callArgs[2] as ClassicBrowserPayload;
      
      expect(passedPayload.tabs).toHaveLength(1);
      expect(passedPayload.tabs[0].url).toBe('https://www.are.na');
      expect(passedPayload.tabs[0].title).toBe('New Tab');
      expect(passedPayload.activeTabId).toBe(passedPayload.tabs[0].id);
    });

    it('should not lose state during rapid mount/unmount cycles', async () => {
      // Arrange: Persisted state with specific tabs
      const persistedPayload = createMockBrowserPayload([
        createMockTabState({ id: 'rapid-tab-1', title: 'Rapid Test 1' }),
        createMockTabState({ id: 'rapid-tab-2', title: 'Rapid Test 2' })
      ], 'rapid-tab-1');
      
      mockApi.storeGet.mockResolvedValue(persistedPayload);

      const windowId = 'rapid-test-window';

      // Act: Rapidly mount and unmount
      const { unmount } = render(<ClassicBrowser windowId={windowId} />);
      await flushPromises();
      unmount();
      
      // Remount
      render(<ClassicBrowser windowId={windowId} />);
      await flushPromises();

      // Assert: Should only initialize backend once per mount
      expect(mockApi.classicBrowserCreate).toHaveBeenCalledTimes(2);
      
      // Both calls should use the same persisted state
      const firstCall = mockApi.classicBrowserCreate.mock.calls[0][2];
      const secondCall = mockApi.classicBrowserCreate.mock.calls[1][2];
      expect(firstCall).toEqual(persistedPayload);
      expect(secondCall).toEqual(persistedPayload);
    });
  });

  describe('State Synchronization During Runtime', () => {
    it('should update frontend state when backend emits state changes', async () => {
      // Arrange: Initial state
      const initialPayload = createMockBrowserPayload([
        createMockTabState({ id: 'sync-tab-1', title: 'Initial Tab' })
      ]);
      mockApi.storeGet.mockResolvedValueOnce(initialPayload);

      // Capture the state update listener
      let stateUpdateListener: Function | null = null;
      mockApi.on.mockImplementation((event: string, listener: Function) => {
        if (event.startsWith('ON_CLASSIC_BROWSER_STATE_')) {
          stateUpdateListener = listener;
        }
      });

      const windowId = 'sync-test-window';
      render(<ClassicBrowser windowId={windowId} />);
      await flushPromises();

      // Act: Simulate backend emitting a state update (new tab added)
      const updatedPayload = createMockBrowserPayload([
        createMockTabState({ id: 'sync-tab-1', title: 'Initial Tab' }),
        createMockTabState({ id: 'sync-tab-2', title: 'New Tab' })
      ], 'sync-tab-2');

      expect(stateUpdateListener).toBeTruthy();
      stateUpdateListener!({ payload: updatedPayload });
      await flushPromises();

      // Assert: Store should be updated with new state
      expect(mockApi.storeSet).toHaveBeenCalledWith(
        `classic-browser-state-${windowId}`,
        updatedPayload
      );
    });
  });
});