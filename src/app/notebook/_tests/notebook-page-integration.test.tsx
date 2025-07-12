import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';
import { useParams, useRouter } from 'next/navigation';
import NotebookView from '@/components/NotebookView';
import '@testing-library/jest-dom/vitest';

// Mock only what's absolutely necessary - Next.js routing
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

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, initial, animate, transition, ...props }: any) => {
      return <div {...props}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock the useHashRouter hook
vi.mock('@/hooks/useHashRouter', () => ({
  useHashRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: '/notebook/test-notebook-id',
  }),
}));

// Mock sidebar components
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: any) => <div data-testid="sidebar-provider">{children}</div>,
  SidebarInset: ({ children }: any) => <div data-testid="sidebar-inset">{children}</div>,
  useSidebar: () => ({ state: 'collapsed' }),
}));

// Mock UI components
vi.mock('@/components/ui/corner-masks', () => ({
  CornerMasks: () => <div data-testid="corner-masks" />,
}));

vi.mock('@/components/ui/intent-line', () => ({
  IntentLine: React.forwardRef(({ value, onChange, onKeyDown, placeholder }: any, ref: any) => (
    <input
      ref={ref}
      data-testid="intent-line"
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
    />
  )),
}));

vi.mock('@/components/HumanComputerIcon', () => ({
  HumanComputerIcon: ({ onClick, isActive }: any) => (
    <button data-testid="human-computer-icon" onClick={onClick}>
      {isActive ? 'Active' : 'Inactive'}
    </button>
  ),
}));

vi.mock('@/components/ui/notebook-info-pill', () => ({
  NotebookInfoPill: ({ title, onTitleChange }: any) => {
    const [isEditing, setIsEditing] = React.useState(false);
    const [editValue, setEditValue] = React.useState(title);
    
    const handleDoubleClick = () => {
      setIsEditing(true);
    };
    
    const handleKeyDown = (e: any) => {
      if (e.key === 'Enter') {
        onTitleChange(editValue);
        setIsEditing(false);
      }
    };
    
    return (
      <div data-testid="notebook-info-pill" onDoubleClick={handleDoubleClick}>
        {isEditing ? (
          <input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <span>{title}</span>
        )}
      </div>
    );
  },
}));

vi.mock('@/components/AppSidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar" />,
}));

vi.mock('@/components/ui/WindowFrame', () => ({
  WindowFrame: ({ children }: any) => <div data-testid="window-frame">{children}</div>,
}));

// Mock the store factory
vi.mock('@/store/windowStoreFactory', () => {
  const createMockStore = () => {
    let state = {
      windows: [],
      _hasHydrated: true,
    };
    
    const listeners = new Set<() => void>();
    
    const getState = () => state;
    const setState = (newState: any) => {
      state = { ...state, ...newState };
      listeners.forEach(listener => listener());
    };
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    
    return {
      getState,
      setState,
      subscribe,
    };
  };
  
  const stores = new Map();
  
  return {
    createNotebookWindowStore: (notebookId: string) => {
      if (!stores.has(notebookId)) {
        stores.set(notebookId, createMockStore());
      }
      return stores.get(notebookId);
    },
    notebookStores: stores,
  };
});

describe('NotebookWorkspace', () => {
  const mockRouter = {
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };

  beforeEach(() => {
    (useParams as Mock).mockReturnValue({ notebookId: 'test-notebook-id' });
    (useRouter as Mock).mockReturnValue(mockRouter);
    vi.clearAllMocks();
  });

  it('displays notebook after loading', async () => {
    // Arrange
    const notebook = {
      id: 'test-notebook-id',
      title: 'My Research Notes',
      description: 'Notes about my research',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    window.api.getNotebookById = vi.fn().mockResolvedValue(notebook);
    
    // Act
    render(<NotebookView notebookId="test-notebook-id" />);
    
    // Assert - user can see their notebook
    expect(await screen.findByText('My Research Notes')).toBeInTheDocument();
  });

  it('loads notebook on mount', async () => {
    // Arrange
    window.api.getNotebookById = vi.fn().mockResolvedValue({
      id: 'test-notebook-id',
      title: 'Test Notebook',
    });
    
    // Act
    render(<NotebookView notebookId="test-notebook-id" />);
    
    // Assert - notebook is fetched
    await waitFor(() => {
      expect(window.api.getNotebookById).toHaveBeenCalledWith('test-notebook-id');
    });
  });

  it('allows user to edit notebook title', async () => {
    // Arrange
    const notebook = { 
      id: 'test-notebook-id', 
      title: 'Original Title' 
    };
    window.api.getNotebookById = vi.fn().mockResolvedValue(notebook);
    window.api.updateNotebook = vi.fn().mockResolvedValue({
      ...notebook,
      title: 'New Title'
    });
    
    // Act
    render(<NotebookView notebookId="test-notebook-id" />);
    
    // Wait for notebook to load
    const titleElement = await screen.findByText('Original Title');
    
    // User double-clicks to edit
    fireEvent.doubleClick(titleElement);
    
    // User types new title
    const input = screen.getByDisplayValue('Original Title');
    fireEvent.change(input, { target: { value: 'New Title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    
    // Assert - title update is requested
    await waitFor(() => {
      expect(window.api.updateNotebook).toHaveBeenCalledWith({
        id: 'test-notebook-id',
        data: { title: 'New Title' }
      });
    });
  });

  it('handles notebook loading errors', async () => {
    // Arrange
    window.api.getNotebookById = vi.fn().mockRejectedValue(new Error('Network error'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Act
    render(<NotebookView notebookId="test-notebook-id" />);
    
    // Assert - error is logged
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    
    consoleSpy.mockRestore();
  });

  it('handles title update errors', async () => {
    // Arrange
    const notebook = { id: 'test-notebook-id', title: 'My Notebook' };
    window.api.getNotebookById = vi.fn().mockResolvedValue(notebook);
    window.api.updateNotebook = vi.fn().mockRejectedValue(new Error('Update failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Act
    render(<NotebookView notebookId="test-notebook-id" />);
    
    // Edit title
    const titleElement = await screen.findByText('My Notebook');
    fireEvent.doubleClick(titleElement);
    
    const input = screen.getByDisplayValue('My Notebook');
    fireEvent.change(input, { target: { value: 'New Title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    
    // Assert - error is handled
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    
    consoleSpy.mockRestore();
  });

  it('shows updated title immediately after edit', async () => {
    // Arrange
    const notebook = { id: 'test-notebook-id', title: 'Old Title' };
    window.api.getNotebookById = vi.fn().mockResolvedValue(notebook);
    window.api.updateNotebook = vi.fn().mockResolvedValue({
      ...notebook,
      title: 'New Title'
    });
    
    // Act
    render(<NotebookView notebookId="test-notebook-id" />);
    
    // Edit title
    const titleElement = await screen.findByText('Old Title');
    fireEvent.doubleClick(titleElement);
    
    const input = screen.getByDisplayValue('Old Title');
    fireEvent.change(input, { target: { value: 'New Title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    
    // Assert - UI updates immediately
    expect(await screen.findByText('New Title')).toBeInTheDocument();
    expect(screen.queryByText('Old Title')).not.toBeInTheDocument();
  });
});