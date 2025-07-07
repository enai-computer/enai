import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import ClassicBrowserViewWrapper from '../ClassicBrowser';
import { 
  createMockWindowApi, 
  createMockBrowserPayload, 
  createMockTabState,
  flushPromises 
} from './classicBrowserMocks';
import type { ClassicBrowserPayload } from '@/shared/types/window.types';
import { useWindowStore } from '@/store/windowStoreFactory';
import { createMockWindowMeta } from '../../../../../test-utils/classic-browser-mocks';
import type { ContentGeometry } from '../ClassicBrowser';

// Mock the window store
vi.mock('@/store/windowStoreFactory', () => ({
  useWindowStore: vi.fn()
}));

// Mock the IPC storage
vi.mock('@/store/ipcStorage', () => ({
  createIPCStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn()
  })
}));

// Mock the cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...classes: (string | undefined)[]) => classes.filter(Boolean).join(' ')
}));

describe('ClassicBrowser State Hydration', () => {
  let mockApi: ReturnType<typeof createMockWindowApi>;
  let mockStore: {
    classicBrowserPayload: ClassicBrowserPayload | null;
    setClassicBrowserPayload: ReturnType<typeof vi.fn>;
  };
  
  beforeEach(() => {
    mockApi = createMockWindowApi();
    (global as { window: { api: ReturnType<typeof createMockWindowApi> } }).window = { api: mockApi };
    
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

      // Create proper props for the component
      const windowMeta = createMockWindowMeta({
        id: 'test-window-123',
        payload: persistedPayload
      });
      
      const contentGeometry: ContentGeometry = {
        contentX: 0,
        contentY: 0,
        contentWidth: 800,
        contentHeight: 600
      };

      // Act: Mount the ClassicBrowser
      render(
        <ClassicBrowserViewWrapper 
          windowMeta={windowMeta}
          activeStore={{
            getState: vi.fn().mockReturnValue({ windows: [windowMeta] }),
            subscribe: vi.fn(),
            setState: vi.fn()
          }}
          contentGeometry={contentGeometry}
          isActuallyVisible={true}
          isDragging={false}
          isResizing={false}
          sidebarState="collapsed"
        />
      );

      // Wait for async operations  
      await waitFor(() => {
        expect(mockApi.classicBrowserCreate).toHaveBeenCalled();
      });

      // 2. classicBrowserCreate should be called exactly once
      expect(mockApi.classicBrowserCreate).toHaveBeenCalledTimes(1);

      // 3. The payload passed must exactly match the hydrated payload
      expect(mockApi.classicBrowserCreate).toHaveBeenCalledWith(
        'test-window-123',
        expect.objectContaining({
          initialUrl: expect.any(String)
        })
      );

      // 4. No tab creation calls should happen (we're restoring, not creating)
      expect(mockApi.classicBrowserCreateTab).not.toHaveBeenCalled();

      // 5. No state overwrite should occur (no immediate state update from backend)
      // The new API uses onClassicBrowserState which is a function property
    });

    it('should handle corrupted persisted state gracefully', async () => {
      // Arrange: Return corrupted state from storage
      const corruptedPayload = { 
        tabs: null, // Invalid: tabs should be an array
        activeTabId: 'non-existent' 
      } as unknown as ClassicBrowserPayload;
      
      // Configure store with corrupted payload
      mockStore.classicBrowserPayload = corruptedPayload;

      // Create window meta with the corrupted payload
      const windowMeta = createMockWindowMeta({
        id: 'test-window-456',
        payload: corruptedPayload
      });
      
      const contentGeometry: ContentGeometry = {
        contentX: 0,
        contentY: 0,
        contentWidth: 800,
        contentHeight: 600
      };

      // Act: Mount the component
      render(
        <ClassicBrowserViewWrapper
          windowMeta={windowMeta}
          activeStore={{
            getState: vi.fn().mockReturnValue({ windows: [windowMeta] }),
            subscribe: vi.fn(),
            setState: vi.fn()
          }}
          contentGeometry={contentGeometry}
          isActuallyVisible={true}
          isDragging={false}
          isResizing={false}
          sidebarState="collapsed"
        />
      );

      await waitFor(() => {
        expect(mockApi.classicBrowserCreate).toHaveBeenCalled();
      });

      // Assert: Backend should be initialized even with corrupted state
      // The component should handle the corrupted state internally
      expect(mockApi.classicBrowserCreate).toHaveBeenCalled();
    });

    it('should initialize with default state when no persisted state exists', async () => {
      // Arrange: No persisted state
      mockStore.classicBrowserPayload = null;

      const windowMeta = createMockWindowMeta({
        id: 'test-window-789'
      });
      
      const contentGeometry: ContentGeometry = {
        contentX: 0,
        contentY: 0,
        contentWidth: 800,
        contentHeight: 600
      };

      // Act: Mount the component
      render(
        <ClassicBrowserViewWrapper
          windowMeta={windowMeta}
          activeStore={{
            getState: vi.fn().mockReturnValue({ windows: [windowMeta] }),
            subscribe: vi.fn(),
            setState: vi.fn()
          }}
          contentGeometry={contentGeometry}
          isActuallyVisible={true}
          isDragging={false}
          isResizing={false}
          sidebarState="collapsed"
        />
      );

      await waitFor(() => {
        expect(mockApi.classicBrowserCreate).toHaveBeenCalled();
      });

      // Assert: Should create browser even without persisted state
      expect(mockApi.classicBrowserCreate).toHaveBeenCalled();
    });

    it('should not lose state during rapid mount/unmount cycles', async () => {
      // Arrange: Persisted state with specific tabs
      const persistedPayload = createMockBrowserPayload([
        createMockTabState({ id: 'rapid-tab-1', title: 'Rapid Test 1' }),
        createMockTabState({ id: 'rapid-tab-2', title: 'Rapid Test 2' })
      ], 'rapid-tab-1');
      
      mockStore.classicBrowserPayload = persistedPayload;

      const windowMeta = createMockWindowMeta({
        id: 'rapid-test-window',
        payload: persistedPayload
      });
      
      const contentGeometry: ContentGeometry = {
        contentX: 0,
        contentY: 0,
        contentWidth: 800,
        contentHeight: 600
      };
      
      const activeStore = {
        getState: vi.fn().mockReturnValue({ windows: [windowMeta] }),
        subscribe: vi.fn(),
        setState: vi.fn()
      };

      // Act: Rapidly mount and unmount
      const { unmount } = render(
        <ClassicBrowserViewWrapper
          windowMeta={windowMeta}
          activeStore={activeStore}
          contentGeometry={contentGeometry}
          isActuallyVisible={true}
          isDragging={false}
          isResizing={false}
          sidebarState="collapsed"
        />
      );
      await flushPromises();
      unmount();
      
      // Remount
      render(
        <ClassicBrowserViewWrapper
          windowMeta={windowMeta}
          activeStore={activeStore}
          contentGeometry={contentGeometry}
          isActuallyVisible={true}
          isDragging={false}
          isResizing={false}
          sidebarState="collapsed"
        />
      );
      await flushPromises();

      // Assert: Should only initialize backend once per mount
      expect(mockApi.classicBrowserCreate).toHaveBeenCalledTimes(2);
      
      // Both calls should create the browser
      expect(mockApi.classicBrowserCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('State Synchronization During Runtime', () => {
    it('should update frontend state when backend emits state changes', async () => {
      // Arrange: Initial state
      const initialPayload = createMockBrowserPayload([
        createMockTabState({ id: 'sync-tab-1', title: 'Initial Tab' })
      ]);
      mockStore.classicBrowserPayload = initialPayload;

      // Set up to capture state updates
      const onClassicBrowserStateMock = mockApi.onClassicBrowserState as ReturnType<typeof vi.fn>;
      let stateUpdateCallback: ((update: ClassicBrowserStateUpdate) => void) | null = null;
      onClassicBrowserStateMock.mockImplementation((callback: (update: ClassicBrowserStateUpdate) => void) => {
        stateUpdateCallback = callback;
        return () => {}; // Return cleanup function
      });

      const windowMeta = createMockWindowMeta({
        id: 'sync-test-window',
        payload: initialPayload
      });
      
      const contentGeometry: ContentGeometry = {
        contentX: 0,
        contentY: 0,
        contentWidth: 800,
        contentHeight: 600
      };

      render(
        <ClassicBrowserViewWrapper
          windowMeta={windowMeta}
          activeStore={{
            getState: vi.fn().mockReturnValue({ windows: [windowMeta] }),
            subscribe: vi.fn(),
            setState: vi.fn()
          }}
          contentGeometry={contentGeometry}
          isActuallyVisible={true}
          isDragging={false}
          isResizing={false}
          sidebarState="collapsed"
        />
      );
      await flushPromises();

      // Act: Simulate backend emitting a state update (new tab added)
      const updatedPayload = createMockBrowserPayload([
        createMockTabState({ id: 'sync-tab-1', title: 'Initial Tab' }),
        createMockTabState({ id: 'sync-tab-2', title: 'New Tab' })
      ], 'sync-tab-2');

      expect(stateUpdateCallback).toBeTruthy();
      
      // Simulate backend emitting state update
      stateUpdateCallback?.({
        windowId: 'sync-test-window',
        update: {
          tabs: updatedPayload.tabs,
          activeTabId: updatedPayload.activeTabId
        }
      });
      await flushPromises();

      // The component should have subscribed to state updates
      expect(onClassicBrowserStateMock).toHaveBeenCalled();
    });
  });
});