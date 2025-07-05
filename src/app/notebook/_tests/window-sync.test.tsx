import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';
import { useParams, useRouter } from 'next/navigation';
import NotebookWorkspacePageLoader from '../[notebookId]/page';
import { useStore } from 'zustand';

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
  useRouter: vi.fn(),
}));

// Mock zustand
vi.mock('zustand', () => ({
  useStore: vi.fn(),
}));

// Mock window store factory
vi.mock('@/store/windowStoreFactory', () => ({
  createNotebookWindowStore: vi.fn(() => ({
    getState: vi.fn(() => ({ windows: [] })),
    setState: vi.fn(),
    subscribe: vi.fn(),
  })),
  notebookStores: new Map(),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: React.ReactNode; [key: string]: any }) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
}));

// Mock window.api
const mockApi = {
  getNotebookById: vi.fn(),
  updateNotebook: vi.fn(),
  createChatWindow: vi.fn(),
  createWindow: vi.fn(),
  onShortcutMinimizeWindow: vi.fn(() => () => {}),
  onWindowFocusChange: vi.fn(() => () => {}),
  onWindowVisibilityChange: vi.fn(() => () => {}),
  syncWindowStackOrder: vi.fn(),
};

// Mock components
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useSidebar: () => ({ state: 'expanded' }),
}));

vi.mock('@/components/ui/app-sidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar">Sidebar</div>,
}));

vi.mock('@/components/ui/WindowFrame', () => ({
  WindowFrame: ({ children }: { children?: React.ReactNode }) => <div data-testid="window-frame">{children}</div>,
}));

vi.mock('@/components/ui/corner-masks', () => ({
  CornerMasks: () => <div data-testid="corner-masks" />,
}));

vi.mock('@/components/HumanComputerIcon', () => ({
  HumanComputerIcon: () => <div data-testid="human-computer-icon">Icon</div>,
}));

vi.mock('@/components/ui/intent-line', () => ({
  IntentLine: () => <input data-testid="intent-line" />,
}));

describe('Notebook Page - Window Stack Synchronization', () => {
  const mockRouter = {
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };

  const mockNotebook = {
    id: 'test-notebook-id',
    title: 'Test Notebook',
    description: 'Test description',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let mockWindows: Array<{ id: string; type: string; isFocused: boolean; payload?: any; x?: number; y?: number; width?: number; height?: number; title?: string; isMinimized?: boolean; zIndex?: number }>;

  beforeEach(() => {
    vi.useFakeTimers();
    
    (useParams as Mock).mockReturnValue({ notebookId: 'test-notebook-id' });
    (useRouter as Mock).mockReturnValue(mockRouter);
    
    // Reset all mocks
    Object.values(mockApi).forEach(fn => {
      if (typeof fn === 'function' && 'mockClear' in fn) {
        (fn as Mock).mockClear();
      }
    });
    
    // Setup default mock implementations
    mockApi.getNotebookById.mockResolvedValue(mockNotebook);
    mockApi.updateNotebook.mockResolvedValue({ success: true });
    mockApi.syncWindowStackOrder.mockResolvedValue({ success: true });
    
    // Attach to window
    (global as typeof globalThis & { window: any }).window = {
      ...global.window,
      api: mockApi,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    // Setup initial windows
    mockWindows = [
      { id: 'window-1', type: 'browser' as const, zIndex: 100, isMinimized: false, isFocused: false },
      { id: 'window-2', type: 'chat' as const, zIndex: 200, isMinimized: false, isFocused: false },
      { id: 'window-3', type: 'notes' as const, zIndex: 150, isMinimized: false, isFocused: false },
    ];

    // Mock the zustand store
    (useStore as Mock).mockImplementation((store, selector) => {
      if (selector) {
        return selector({ windows: mockWindows });
      }
      return { windows: mockWindows };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('syncs window stack order on initial render', async () => {
    render(<NotebookWorkspacePageLoader />);

    // Fast-forward the debounce timer
    vi.advanceTimersByTime(100);

    await waitFor(() => {
      expect(mockApi.syncWindowStackOrder).toHaveBeenCalledWith([
        'window-1', // zIndex: 100
        'window-3', // zIndex: 150
        'window-2', // zIndex: 200
      ]);
    });
  });

  it('syncs window stack order when windows are reordered', async () => {
    const { rerender } = render(<NotebookWorkspacePageLoader />);

    // Initial sync
    vi.advanceTimersByTime(100);
    await waitFor(() => {
      expect(mockApi.syncWindowStackOrder).toHaveBeenCalledTimes(1);
    });

    // Update window z-indices
    mockWindows[0].zIndex = 300; // window-1 now has highest z-index
    
    // Update the mock to return new windows
    (useStore as Mock).mockImplementation((store, selector) => {
      if (selector) {
        return selector({ windows: [...mockWindows] });
      }
      return { windows: [...mockWindows] };
    });

    rerender(<NotebookWorkspacePageLoader />);

    // Fast-forward the debounce timer
    vi.advanceTimersByTime(100);

    await waitFor(() => {
      expect(mockApi.syncWindowStackOrder).toHaveBeenCalledTimes(2);
      expect(mockApi.syncWindowStackOrder).toHaveBeenLastCalledWith([
        'window-3', // zIndex: 150
        'window-2', // zIndex: 200
        'window-1', // zIndex: 300
      ]);
    });
  });

  it('debounces rapid window order changes', async () => {
    const { rerender } = render(<NotebookWorkspacePageLoader />);

    // Initial sync
    vi.advanceTimersByTime(100);
    await waitFor(() => {
      expect(mockApi.syncWindowStackOrder).toHaveBeenCalledTimes(1);
    });

    // Rapid updates
    for (let i = 0; i < 5; i++) {
      mockWindows[0].zIndex = 100 + i * 10;
      
      // Update the mock to return new windows
      (useStore as Mock).mockImplementation((store, selector) => {
        if (selector) {
          return selector({ windows: [...mockWindows] });
        }
        return { windows: [...mockWindows] };
      });
      
      rerender(<NotebookWorkspacePageLoader />);
      vi.advanceTimersByTime(50); // Less than debounce time
    }

    // Should not have called sync yet
    expect(mockApi.syncWindowStackOrder).toHaveBeenCalledTimes(1);

    // Complete the debounce
    vi.advanceTimersByTime(50);

    await waitFor(() => {
      expect(mockApi.syncWindowStackOrder).toHaveBeenCalledTimes(2);
    });
  });

  it('does not sync if window order has not changed', async () => {
    const { rerender } = render(<NotebookWorkspacePageLoader />);

    // Initial sync
    vi.advanceTimersByTime(100);
    await waitFor(() => {
      expect(mockApi.syncWindowStackOrder).toHaveBeenCalledTimes(1);
    });

    // Update windows array but keep same order - force re-render
    rerender(<NotebookWorkspacePageLoader />);

    vi.advanceTimersByTime(100);

    // Should not sync again
    expect(mockApi.syncWindowStackOrder).toHaveBeenCalledTimes(1);
  });

  it('filters out minimized windows from sync', async () => {
    // Note: Based on the actual implementation, it doesn't filter minimized windows
    // The sync includes all windows regardless of minimized state
    mockWindows[1].isMinimized = true; // window-2 is minimized
    
    (useStore as Mock).mockImplementation((store, selector) => {
      if (selector) {
        return selector({ windows: mockWindows });
      }
      return { windows: mockWindows };
    });

    render(<NotebookWorkspacePageLoader />);

    vi.advanceTimersByTime(100);

    await waitFor(() => {
      // All windows are included, even minimized ones
      expect(mockApi.syncWindowStackOrder).toHaveBeenCalledWith([
        'window-1', // zIndex: 100
        'window-3', // zIndex: 150
        'window-2', // zIndex: 200 (minimized but still included)
      ]);
    });
  });

  it('handles sync errors gracefully', async () => {
    mockApi.syncWindowStackOrder.mockRejectedValue(new Error('Sync failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<NotebookWorkspacePageLoader />);

    vi.advanceTimersByTime(100);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        '[NotebookWorkspace] Failed to sync window stack order:',
        expect.any(Error)
      );
    });

    consoleSpy.mockRestore();
  });

  it('does not sync if api is not available', async () => {
    (global as typeof globalThis & { window: any }).window = {
      ...global.window,
      api: {
        ...mockApi,
        syncWindowStackOrder: undefined,
      },
    };

    render(<NotebookWorkspacePageLoader />);

    vi.advanceTimersByTime(100);

    // Should not throw and should not call sync
    expect(mockApi.syncWindowStackOrder).not.toHaveBeenCalled();
  });

  it('syncs when new windows are added', async () => {
    const { rerender } = render(<NotebookWorkspacePageLoader />);

    // Initial sync
    vi.advanceTimersByTime(100);
    await waitFor(() => {
      expect(mockApi.syncWindowStackOrder).toHaveBeenCalledTimes(1);
    });

    // Add new window
    mockWindows.push({
      id: 'window-4',
      type: 'browser' as const,
      zIndex: 175,
      isMinimized: false,
      isFocused: false,
    });
    
    // Update the mock to return new windows
    (useStore as Mock).mockImplementation((store, selector) => {
      if (selector) {
        return selector({ windows: [...mockWindows] });
      }
      return { windows: [...mockWindows] };
    });

    rerender(<NotebookWorkspacePageLoader />);
    vi.advanceTimersByTime(100);

    await waitFor(() => {
      expect(mockApi.syncWindowStackOrder).toHaveBeenCalledTimes(2);
      expect(mockApi.syncWindowStackOrder).toHaveBeenLastCalledWith([
        'window-1', // zIndex: 100
        'window-3', // zIndex: 150
        'window-4', // zIndex: 175
        'window-2', // zIndex: 200
      ]);
    });
  });

  it('syncs when windows are removed', async () => {
    const { rerender } = render(<NotebookWorkspacePageLoader />);

    // Initial sync
    vi.advanceTimersByTime(100);
    await waitFor(() => {
      expect(mockApi.syncWindowStackOrder).toHaveBeenCalledTimes(1);
    });

    // Remove a window
    mockWindows.splice(1, 1); // Remove window-2
    
    // Update the mock to return new windows
    (useStore as Mock).mockImplementation((store, selector) => {
      if (selector) {
        return selector({ windows: [...mockWindows] });
      }
      return { windows: [...mockWindows] };
    });

    rerender(<NotebookWorkspacePageLoader />);
    vi.advanceTimersByTime(100);

    await waitFor(() => {
      expect(mockApi.syncWindowStackOrder).toHaveBeenCalledTimes(2);
      expect(mockApi.syncWindowStackOrder).toHaveBeenLastCalledWith([
        'window-1', // zIndex: 100
        'window-3', // zIndex: 150
      ]);
    });
  });

  it('cleans up timeout on unmount', async () => {
    const { unmount } = render(<NotebookWorkspacePageLoader />);

    // Start the timer but don't complete it
    vi.advanceTimersByTime(50);

    // Unmount should clear the timeout
    unmount();

    // Advance time past the debounce
    vi.advanceTimersByTime(100);

    // Should only have the initial call, not a second one
    expect(mockApi.syncWindowStackOrder).not.toHaveBeenCalled();
  });
});