import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';
import { useParams, useRouter } from 'next/navigation';
import NotebookWorkspacePageLoader from '../[notebookId]/page';
import '@testing-library/jest-dom/vitest';

// Mock only what's absolutely necessary
vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
  useRouter: vi.fn(),
}));

// Mock Next.js font loading
vi.mock('next/font/local', () => ({
  default: () => ({
    style: { fontFamily: 'mock-font' },
    className: 'mock-font-class',
  }),
}));

// Mock window components to avoid rendering complexity
vi.mock('@/components/apps/chat/ChatWindow', () => ({
  ChatWindow: () => <div>Chat Window</div>,
}));

vi.mock('@/components/apps/classic-browser/ClassicBrowserContent', () => ({
  ClassicBrowserContent: () => <div>Browser Window</div>,
}));

vi.mock('@/components/apps/notes/NotesWindow', () => ({
  NotesWindow: () => <div>Notes Window</div>,
}));

// Mock WindowFrame to prevent complex rendering
vi.mock('@/components/ui/WindowFrame', () => ({
  WindowFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock the window store factory with basic functionality
vi.mock('@/store/windowStoreFactory', () => {
  const mockWindows = [
    { 
      id: 'window-1', 
      type: 'browser', 
      zIndex: 100, 
      isMinimized: false, 
      isFocused: false,
      payload: { url: 'https://example.com' }
    },
    { 
      id: 'window-2', 
      type: 'chat', 
      zIndex: 200, 
      isMinimized: false, 
      isFocused: false,
      payload: { sessionId: 'chat-session-1' }
    },
  ];
  
  return {
    createNotebookWindowStore: vi.fn(() => ({
      getState: () => ({ 
        windows: mockWindows,
        _hasHydrated: true,
      }),
      setState: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    })),
    notebookStores: new Map(),
  };
});

describe('Window Stack Synchronization', () => {
  const mockRouter = {
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    (useParams as Mock).mockReturnValue({ notebookId: 'test-notebook-id' });
    (useRouter as Mock).mockReturnValue(mockRouter);
    vi.clearAllMocks();

    // Setup basic notebook data
    window.api.getNotebookById = vi.fn().mockResolvedValue({
      id: 'test-notebook-id',
      title: 'Test Notebook',
    });
    window.api.syncWindowStackOrder = vi.fn().mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('syncs window order with native views', async () => {
    // Act
    render(<NotebookWorkspacePageLoader />);
    
    // Wait for initial mount
    await waitFor(() => {
      expect(window.api.getNotebookById).toHaveBeenCalled();
    });
    
    // Advance timers to trigger sync
    vi.advanceTimersByTime(100);

    // Assert - windows are synced in z-index order
    await waitFor(() => {
      expect(window.api.syncWindowStackOrder).toHaveBeenCalledWith([
        { id: 'window-1', isFrozen: false, isMinimized: false },
        { id: 'window-2', isFrozen: false, isMinimized: false },
      ]);
    });
  });

  it('handles sync errors gracefully', async () => {
    // Arrange
    window.api.syncWindowStackOrder = vi.fn().mockRejectedValue(new Error('Sync failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Act
    render(<NotebookWorkspacePageLoader />);
    
    // Wait for mount and trigger sync
    await waitFor(() => {
      expect(window.api.getNotebookById).toHaveBeenCalled();
    });
    
    vi.advanceTimersByTime(100);

    // Assert - error is logged
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });

  it('cleans up on unmount', () => {
    // Act
    const { unmount } = render(<NotebookWorkspacePageLoader />);
    
    // Clear any pending syncs
    vi.clearAllTimers();
    (window.api.syncWindowStackOrder as Mock).mockClear();
    
    // Unmount
    unmount();
    
    // Advance timers
    vi.advanceTimersByTime(200);
    
    // Assert - no sync after unmount
    expect(window.api.syncWindowStackOrder).not.toHaveBeenCalled();
  });
});