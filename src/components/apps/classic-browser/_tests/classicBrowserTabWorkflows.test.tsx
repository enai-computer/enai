import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ClassicBrowser } from '../../src/components/apps/classic-browser/ClassicBrowser';
import { 
  createMockWindowApi, 
  createMockBrowserPayload, 
  createMockTabState,
  flushPromises,
  createIpcEventSpy
} from '../utils/classicBrowserMocks';
import type { ClassicBrowserPayload, ClassicBrowserStateUpdate } from '../../shared/types';
import { useWindowStore } from '../../src/store/windowStoreFactory';

// Mock the window store
vi.mock('../../src/store/windowStoreFactory', () => ({
  useWindowStore: vi.fn()
}));

// Mock the cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' ')
}));

describe('ClassicBrowser Tab Workflows Integration', () => {
  let mockApi: ReturnType<typeof createMockWindowApi>;
  let mockStore: any;
  let stateUpdateCallback: ((update: ClassicBrowserStateUpdate) => void) | null = null;
  
  beforeEach(() => {
    mockApi = createMockWindowApi();
    (global as any).window = { api: mockApi };
    
    // Create mock store
    mockStore = {
      classicBrowserPayload: createMockBrowserPayload(),
      setClassicBrowserPayload: vi.fn((payload: ClassicBrowserPayload) => {
        mockStore.classicBrowserPayload = payload;
      })
    };
    
    // Mock useWindowStore to return our mock store
    (useWindowStore as any).mockImplementation(() => mockStore);
    
    // Capture state update callback
    mockApi.onClassicBrowserStateUpdate.mockImplementation((windowId: string, callback: any) => {
      stateUpdateCallback = callback;
      return () => { stateUpdateCallback = null; };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    stateUpdateCallback = null;
  });

  describe('Complete Tab Workflow: Create → Navigate → Switch → Close', () => {
    it('should handle full tab lifecycle', async () => {
      // Arrange
      const windowId = 'test-window-123';
      mockApi.classicBrowserCreateTab.mockResolvedValue('new-tab-123');
      mockApi.classicBrowserSwitchTab.mockResolvedValue({ success: true });
      mockApi.classicBrowserCloseTab.mockResolvedValue({ success: true });
      
      // Initial render
      const { rerender } = render(<ClassicBrowser windowId={windowId} />);
      
      // Step 1: Create a new tab
      const plusButton = screen.getByRole('button', { name: /add new tab/i });
      fireEvent.click(plusButton);
      
      await waitFor(() => {
        expect(mockApi.classicBrowserCreateTab).toHaveBeenCalledWith(windowId, undefined);
      });
      
      // Simulate backend state update (new tab added)
      const newTabPayload = createMockBrowserPayload([
        mockStore.classicBrowserPayload.tabs[0],
        createMockTabState({ id: 'new-tab-123', title: 'New Tab', url: 'https://www.are.na' })
      ], 'new-tab-123');
      
      stateUpdateCallback!({ windowId, payload: newTabPayload });
      await flushPromises();
      rerender(<ClassicBrowser windowId={windowId} />);
      
      // Verify tab bar shows (2 tabs)
      expect(screen.getByRole('tablist')).toBeInTheDocument();
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(2);
      
      // Step 2: Navigate in the new tab
      const urlInput = screen.getByRole('textbox', { name: /url/i });
      fireEvent.change(urlInput, { target: { value: 'https://github.com' } });
      fireEvent.keyDown(urlInput, { key: 'Enter' });
      
      await waitFor(() => {
        expect(mockApi.classicBrowserLoadUrl).toHaveBeenCalledWith(windowId, 'https://github.com');
      });
      
      // Simulate navigation state update
      const navigatedPayload = createMockBrowserPayload([
        mockStore.classicBrowserPayload.tabs[0],
        createMockTabState({ 
          id: 'new-tab-123', 
          title: 'GitHub', 
          url: 'https://github.com',
          canGoBack: true 
        })
      ], 'new-tab-123');
      
      stateUpdateCallback!({ windowId, payload: navigatedPayload });
      await flushPromises();
      rerender(<ClassicBrowser windowId={windowId} />);
      
      // Step 3: Switch back to first tab
      fireEvent.click(tabs[0]);
      
      await waitFor(() => {
        expect(mockApi.classicBrowserSwitchTab).toHaveBeenCalledWith(
          windowId, 
          mockStore.classicBrowserPayload.tabs[0].id
        );
      });
      
      // Simulate switch state update
      const switchedPayload = { ...navigatedPayload, activeTabId: navigatedPayload.tabs[0].id };
      stateUpdateCallback!({ windowId, payload: switchedPayload });
      await flushPromises();
      rerender(<ClassicBrowser windowId={windowId} />);
      
      // Step 4: Close the second tab
      const closeButtons = screen.getAllByRole('button', { name: /close tab/i });
      fireEvent.click(closeButtons[1]); // Close second tab
      
      await waitFor(() => {
        expect(mockApi.classicBrowserCloseTab).toHaveBeenCalledWith(windowId, 'new-tab-123');
      });
      
      // Simulate close state update (back to 1 tab)
      const closedPayload = createMockBrowserPayload([
        mockStore.classicBrowserPayload.tabs[0]
      ]);
      
      stateUpdateCallback!({ windowId, payload: closedPayload });
      await flushPromises();
      rerender(<ClassicBrowser windowId={windowId} />);
      
      // Verify tab bar hidden (only 1 tab)
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });
  });

  describe('Multi-Window Tab Management', () => {
    it('should isolate tab state between windows', async () => {
      // Arrange: Two windows with different stores
      const window1Id = 'window-1';
      const window2Id = 'window-2';
      
      const store1 = {
        classicBrowserPayload: createMockBrowserPayload([
          createMockTabState({ id: 'w1-tab1', title: 'Window 1 Tab' })
        ]),
        setClassicBrowserPayload: vi.fn()
      };
      
      const store2 = {
        classicBrowserPayload: createMockBrowserPayload([
          createMockTabState({ id: 'w2-tab1', title: 'Window 2 Tab' }),
          createMockTabState({ id: 'w2-tab2', title: 'Window 2 Tab 2' })
        ], 'w2-tab2'),
        setClassicBrowserPayload: vi.fn()
      };
      
      // Mock store to return different stores for different windows
      (useWindowStore as any).mockImplementation((windowId: string) => {
        return windowId === window1Id ? store1 : store2;
      });
      
      // Render both windows
      const { container: container1 } = render(
        <ClassicBrowser windowId={window1Id} key={window1Id} />
      );
      const { container: container2 } = render(
        <ClassicBrowser windowId={window2Id} key={window2Id} />
      );
      
      // Assert: Window 1 has no tab bar (1 tab)
      expect(container1.querySelector('[role="tablist"]')).not.toBeInTheDocument();
      
      // Assert: Window 2 has tab bar (2 tabs)
      expect(container2.querySelector('[role="tablist"]')).toBeInTheDocument();
      
      // Act: Create tab in window 1
      mockApi.classicBrowserCreateTab.mockResolvedValue('w1-tab2');
      const plusButton1 = container1.querySelector('button[aria-label*="add new tab"]');
      fireEvent.click(plusButton1!);
      
      await waitFor(() => {
        expect(mockApi.classicBrowserCreateTab).toHaveBeenCalledWith(window1Id, undefined);
      });
      
      // Assert: Only window 1 was affected
      expect(mockApi.classicBrowserCreateTab).toHaveBeenCalledTimes(1);
      expect(mockApi.classicBrowserCreateTab).not.toHaveBeenCalledWith(window2Id, expect.anything());
    });
  });

  describe('State Synchronization with Backend', () => {
    it('should handle optimistic updates with rollback on error', async () => {
      const windowId = 'sync-test-window';
      
      // Initial state with 2 tabs
      mockStore.classicBrowserPayload = createMockBrowserPayload([
        createMockTabState({ id: 'tab-1', title: 'Tab 1' }),
        createMockTabState({ id: 'tab-2', title: 'Tab 2' })
      ], 'tab-1');
      
      const { rerender } = render(<ClassicBrowser windowId={windowId} />);
      
      // Configure API to fail on close
      mockApi.classicBrowserCloseTab.mockResolvedValue({ 
        success: false, 
        error: 'Network error' 
      });
      
      // Act: Try to close a tab
      const closeButtons = screen.getAllByRole('button', { name: /close tab/i });
      fireEvent.click(closeButtons[1]);
      
      await waitFor(() => {
        expect(mockApi.classicBrowserCloseTab).toHaveBeenCalledWith(windowId, 'tab-2');
      });
      
      // Assert: UI should still show 2 tabs (no optimistic removal)
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(2);
      
      // Verify no state update was applied
      expect(mockStore.setClassicBrowserPayload).not.toHaveBeenCalled();
    });

    it('should handle race conditions in rapid operations', async () => {
      const windowId = 'race-test-window';
      const { rerender } = render(<ClassicBrowser windowId={windowId} />);
      
      // Configure delays to simulate network latency
      mockApi.classicBrowserCreateTab
        .mockImplementationOnce(() => new Promise(resolve => 
          setTimeout(() => resolve('delayed-tab-1'), 100)
        ))
        .mockImplementationOnce(() => new Promise(resolve => 
          setTimeout(() => resolve('quick-tab-2'), 10)
        ));
      
      // Act: Create two tabs rapidly
      const plusButton = screen.getByRole('button', { name: /add new tab/i });
      fireEvent.click(plusButton); // Slow request
      fireEvent.click(plusButton); // Fast request
      
      // Simulate backend updates arriving out of order
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Fast request completes first
      const quickUpdate = createMockBrowserPayload([
        mockStore.classicBrowserPayload.tabs[0],
        createMockTabState({ id: 'quick-tab-2', title: 'Quick Tab' })
      ], 'quick-tab-2');
      
      stateUpdateCallback!({ windowId, payload: quickUpdate });
      await flushPromises();
      
      // Slow request completes later
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const slowUpdate = createMockBrowserPayload([
        mockStore.classicBrowserPayload.tabs[0],
        createMockTabState({ id: 'quick-tab-2', title: 'Quick Tab' }),
        createMockTabState({ id: 'delayed-tab-1', title: 'Delayed Tab' })
      ], 'delayed-tab-1');
      
      stateUpdateCallback!({ windowId, payload: slowUpdate });
      await flushPromises();
      rerender(<ClassicBrowser windowId={windowId} />);
      
      // Assert: Final state should have both tabs in correct order
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(3); // Original + 2 new
      expect(screen.getByText('Delayed Tab')).toBeInTheDocument();
      expect(screen.getByText('Quick Tab')).toBeInTheDocument();
    });
  });

  describe('Performance with Many Tabs', () => {
    it('should remain responsive with 50 tabs', async () => {
      const windowId = 'perf-test-window';
      
      // Create payload with 50 tabs
      const manyTabs = Array.from({ length: 50 }, (_, i) => 
        createMockTabState({ 
          id: `tab-${i}`, 
          title: `Tab ${i + 1}`,
          url: `https://example.com/page${i}`
        })
      );
      
      mockStore.classicBrowserPayload = createMockBrowserPayload(manyTabs, 'tab-25');
      
      // Measure render time
      const startTime = performance.now();
      render(<ClassicBrowser windowId={windowId} />);
      const renderTime = performance.now() - startTime;
      
      // Assert: Should render quickly
      expect(renderTime).toBeLessThan(100); // 100ms threshold
      
      // Assert: All tabs rendered
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(50);
      
      // Test tab switching performance
      const switchStartTime = performance.now();
      fireEvent.click(tabs[49]); // Click last tab
      const switchTime = performance.now() - switchStartTime;
      
      expect(switchTime).toBeLessThan(50); // 50ms threshold
      expect(mockApi.classicBrowserSwitchTab).toHaveBeenCalledWith(windowId, 'tab-49');
    });
  });

  describe('Keyboard Navigation', () => {
    it('should support keyboard shortcuts for tab operations', async () => {
      const windowId = 'keyboard-test-window';
      
      // Set up multiple tabs
      mockStore.classicBrowserPayload = createMockBrowserPayload([
        createMockTabState({ id: 'tab-1', title: 'Tab 1' }),
        createMockTabState({ id: 'tab-2', title: 'Tab 2' }),
        createMockTabState({ id: 'tab-3', title: 'Tab 3' })
      ], 'tab-2');
      
      render(<ClassicBrowser windowId={windowId} />);
      
      // Focus on tab bar
      const tabList = screen.getByRole('tablist');
      tabList.focus();
      
      // Test arrow navigation
      fireEvent.keyDown(tabList, { key: 'ArrowLeft' });
      await waitFor(() => {
        expect(mockApi.classicBrowserSwitchTab).toHaveBeenCalledWith(windowId, 'tab-1');
      });
      
      fireEvent.keyDown(tabList, { key: 'ArrowRight' });
      await waitFor(() => {
        expect(mockApi.classicBrowserSwitchTab).toHaveBeenCalledWith(windowId, 'tab-3');
      });
      
      // Test Cmd+T for new tab
      fireEvent.keyDown(document.body, { key: 't', metaKey: true });
      await waitFor(() => {
        expect(mockApi.classicBrowserCreateTab).toHaveBeenCalled();
      });
      
      // Test Cmd+W for close tab
      fireEvent.keyDown(document.body, { key: 'w', metaKey: true });
      await waitFor(() => {
        expect(mockApi.classicBrowserCloseTab).toHaveBeenCalledWith(windowId, 'tab-2');
      });
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from backend errors gracefully', async () => {
      const windowId = 'error-test-window';
      const { rerender } = render(<ClassicBrowser windowId={windowId} />);
      
      // Configure API to fail then succeed
      let callCount = 0;
      mockApi.classicBrowserCreateTab.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Backend unavailable'));
        }
        return Promise.resolve('recovery-tab');
      });
      
      // First attempt fails
      const plusButton = screen.getByRole('button', { name: /add new tab/i });
      fireEvent.click(plusButton);
      
      await waitFor(() => {
        expect(mockApi.classicBrowserCreateTab).toHaveBeenCalledTimes(1);
      });
      
      // User retries
      fireEvent.click(plusButton);
      
      await waitFor(() => {
        expect(mockApi.classicBrowserCreateTab).toHaveBeenCalledTimes(2);
      });
      
      // Simulate successful state update
      const recoveredPayload = createMockBrowserPayload([
        mockStore.classicBrowserPayload.tabs[0],
        createMockTabState({ id: 'recovery-tab', title: 'Recovered Tab' })
      ], 'recovery-tab');
      
      stateUpdateCallback!({ windowId, payload: recoveredPayload });
      await flushPromises();
      rerender(<ClassicBrowser windowId={windowId} />);
      
      // Assert: Tab successfully created after retry
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(2);
      expect(screen.getByText('Recovered Tab')).toBeInTheDocument();
    });
  });
});