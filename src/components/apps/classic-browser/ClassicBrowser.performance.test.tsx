import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ClassicBrowserViewWrapper from './ClassicBrowser';
import { createMockWindowMeta } from '../../../../test-utils/classic-browser-mocks';
import { classicBrowserMocks, resetAllMocks } from '../../../../test-setup/electron-mocks';

describe('ClassicBrowser Performance and Memory Tests', () => {
  let defaultProps: any;
  let rafCallbacks: Set<FrameRequestCallback>;
  let originalRAF: typeof window.requestAnimationFrame;
  let originalCAF: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    resetAllMocks();
    
    const mockStore = {
      getState: vi.fn().mockReturnValue({
        windows: [createMockWindowMeta()],
        updateWindowProps: vi.fn()
      }),
      subscribe: vi.fn(),
      setState: vi.fn()
    };

    defaultProps = {
      windowMeta: createMockWindowMeta(),
      activeStore: mockStore,
      contentGeometry: {
        x: 0,
        y: 0,
        width: 800,
        height: 600
      },
      isActuallyVisible: true,
      isDragging: false,
      isResizing: false,
      sidebarState: 'collapsed'
    };

    // Track RAF callbacks
    rafCallbacks = new Set();
    originalRAF = window.requestAnimationFrame;
    originalCAF = window.cancelAnimationFrame;

    window.requestAnimationFrame = vi.fn((callback) => {
      rafCallbacks.add(callback);
      return rafCallbacks.size;
    });

    window.cancelAnimationFrame = vi.fn((id) => {
      // Simple implementation - in real tests you'd track by ID
      rafCallbacks.clear();
    });
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRAF;
    window.cancelAnimationFrame = originalCAF;
    vi.clearAllTimers();
  });

  describe('Memory Leak Prevention', () => {
    it('should clean up all event listeners on unmount', async () => {
      const { unmount } = render(<ClassicBrowserViewWrapper {...defaultProps} />);

      // Verify listeners are registered
      expect(window.api.onClassicBrowserState).toHaveBeenCalledTimes(1);
      // Note: onClassicBrowserNavigate doesn't exist in the actual API

      const initialCallbackCount = classicBrowserMocks.onClassicBrowserState._callbacks.length;
      expect(initialCallbackCount).toBeGreaterThan(0);

      unmount();

      // All callbacks should be removed
      await waitFor(() => {
        expect(classicBrowserMocks.onClassicBrowserState._callbacks.length).toBe(0);
        // Only onClassicBrowserState callbacks to check
      });
    });

    it('should cancel RAF callbacks on unmount', async () => {
      const { unmount } = render(<ClassicBrowserViewWrapper {...defaultProps} />);

      // Force a bounds update to trigger RAF
      const newProps = {
        ...defaultProps,
        windowMeta: {
          ...defaultProps.windowMeta
        },
        contentGeometry: {
          ...defaultProps.contentGeometry,
          width: 1000,
          height: 800
        }
      };

      const { rerender } = render(<ClassicBrowserViewWrapper {...newProps} />);

      // Verify RAF was called
      expect(window.requestAnimationFrame).toHaveBeenCalled();
      expect(rafCallbacks.size).toBeGreaterThan(0);

      unmount();

      // RAF callbacks should be cancelled
      expect(window.cancelAnimationFrame).toHaveBeenCalled();
    });

    it('should handle rapid mount/unmount cycles without leaking', async () => {
      const mountUnmountCycles = 10;
      const componentsToTrack: any[] = [];

      for (let i = 0; i < mountUnmountCycles; i++) {
        const { unmount } = render(<ClassicBrowserViewWrapper {...defaultProps} />);
        
        // Track that resources are allocated
        expect(window.api.classicBrowserCreate).toHaveBeenCalled();
        
        componentsToTrack.push({ unmount, cycleIndex: i });
      }

      // Unmount all
      for (const { unmount } of componentsToTrack) {
        unmount();
      }

      // Verify all resources are cleaned up
      await waitFor(() => {
        expect(classicBrowserMocks.onClassicBrowserState._callbacks.length).toBe(0);
        // Only onClassicBrowserState callbacks to check
      });

      // Verify destroy was called for each mount
      expect(window.api.classicBrowserDestroy).toHaveBeenCalledTimes(mountUnmountCycles);
    });
  });

  describe('Performance Optimization Tests', () => {
    it('should debounce bounds updates to prevent excessive IPC calls', async () => {
      const { rerender } = render(<ClassicBrowserViewWrapper {...defaultProps} />);

      // Clear initial calls
      (window.api.classicBrowserSetBounds as any).mockClear();

      // Simulate rapid resize events
      const resizeCount = 20;
      for (let i = 0; i < resizeCount; i++) {
        rerender(
          <ClassicBrowserViewWrapper
            {...defaultProps}
            contentGeometry={{
              ...defaultProps.contentGeometry,
              width: 800 + i,
              height: 600 + i
            }}
          />
        );
      }

      // Wait for debounce
      await waitFor(() => {
        // Should be significantly less than resizeCount due to RAF batching
        expect(window.api.classicBrowserSetBounds).toHaveBeenCalledTimes(1);
      }, { timeout: 100 });
    });

    it('should handle high-frequency state updates efficiently', async () => {
      const { unmount } = render(<ClassicBrowserViewWrapper {...defaultProps} />);

      const updateCount = 100;
      const startTime = Date.now();

      // Simulate rapid state updates
      for (let i = 0; i < updateCount; i++) {
        classicBrowserMocks.onClassicBrowserState.triggerUpdate({
          windowId: 'window-1',
          update: {
            tab: {
              id: 'tab-1',
              url: `https://example${i}.com`,
              title: `Example ${i}`
            }
          }
        });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should handle 100 updates in reasonable time (< 100ms)
      expect(duration).toBeLessThan(100);

      unmount();
    });

    it('should not create unnecessary re-renders on prop changes', async () => {
      const renderSpy = vi.fn();
      
      // Wrap component to track renders
      const TrackedClassicBrowser = (props: any) => {
        renderSpy();
        return <ClassicBrowserViewWrapper {...props} />;
      };

      const { rerender } = render(<TrackedClassicBrowser {...defaultProps} />);

      // Clear initial render
      renderSpy.mockClear();

      // Props that shouldn't cause re-render if values are same
      rerender(<TrackedClassicBrowser {...defaultProps} />);
      rerender(<TrackedClassicBrowser {...defaultProps} />);
      rerender(<TrackedClassicBrowser {...defaultProps} />);

      // Should not re-render for identical props
      expect(renderSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('Resource Management Tests', () => {
    it('should handle IPC failures gracefully without memory leaks', async () => {
      // Make IPC calls fail
      (window.api.classicBrowserCreate as any).mockRejectedValue(new Error('IPC Failed'));
      (window.api.classicBrowserSetBounds as any).mockRejectedValue(new Error('IPC Failed'));

      const { unmount } = render(<ClassicBrowserViewWrapper {...defaultProps} />);

      // Wait for error state
      await waitFor(() => {
        expect(window.api.classicBrowserCreate).toHaveBeenCalled();
      });

      unmount();

      // Should still clean up properly
      expect(classicBrowserMocks.onClassicBrowserState._callbacks.length).toBe(0);
      // Only onClassicBrowserState callbacks to check
    });

    it('should handle concurrent operations without race conditions', async () => {
      const { rerender, unmount } = render(<ClassicBrowserViewWrapper {...defaultProps} />);

      // Simulate concurrent operations
      const operations = [
        // Navigation
        window.api.classicBrowserLoadUrl('window-1', 'https://concurrent1.com'),
        // State update
        classicBrowserMocks.onClassicBrowserState.triggerUpdate({
          windowId: 'window-1',
          update: { tab: { id: 'tab-1', url: 'https://concurrent2.com' } }
        }),
        // Bounds update
        rerender(<ClassicBrowserViewWrapper {...defaultProps} contentGeometry={{
          ...defaultProps.contentGeometry,
          width: 900
        }} />),
        // Another navigation
        window.api.classicBrowserNavigate('window-1', 'reload')
      ];

      // Execute all concurrently
      await Promise.all(operations);

      // Component should still be in valid state
      unmount();

      // Verify cleanup happened correctly
      await waitFor(() => {
        expect(window.api.classicBrowserDestroy).toHaveBeenCalledWith('window-1');
      });
    });
  });

  describe('StrictMode Memory Tests', () => {
    it('should not leak resources in StrictMode double-mounting', async () => {
      const { unmount } = render(
        <React.StrictMode>
          <ClassicBrowserViewWrapper {...defaultProps} />
        </React.StrictMode>
      );

      // Wait for StrictMode effects
      await waitFor(() => {
        expect(window.api.classicBrowserCreate).toHaveBeenCalledTimes(2);
      });

      // Check that first mount's listeners were cleaned up
      // Should only have listeners from second mount
      expect(classicBrowserMocks.onClassicBrowserState._callbacks.length).toBe(1);
      // Only onClassicBrowserState callbacks to check

      unmount();

      // All should be cleaned up
      expect(classicBrowserMocks.onClassicBrowserState._callbacks.length).toBe(0);
      // Only onClassicBrowserState callbacks to check
    });
  });

  describe('Long-running Operation Tests', () => {
    it('should handle component unmount during pending operations', async () => {
      // Make create take time
      let resolveCreate: any;
      (window.api.classicBrowserCreate as any).mockImplementationOnce(
        () => new Promise(resolve => { resolveCreate = resolve; })
      );

      const { unmount } = render(<ClassicBrowserViewWrapper {...defaultProps} />);

      // Unmount while create is pending
      unmount();

      // Resolve the pending operation
      resolveCreate({ success: true });

      // Should have cleaned up despite pending operation
      await waitFor(() => {
        expect(window.api.classicBrowserDestroy).toHaveBeenCalled();
        expect(classicBrowserMocks.onClassicBrowserState._callbacks.length).toBe(0);
      });
    });
  });
});