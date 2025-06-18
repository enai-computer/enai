import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';
import { useParams, useRouter } from 'next/navigation';
import NotebookWorkspacePageLoader from '../[notebookId]/page';

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
  useRouter: vi.fn(),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
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

// Mock components that would cause issues in tests
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: any) => <div>{children}</div>,
  SidebarInset: ({ children }: any) => <div>{children}</div>,
  useSidebar: () => ({ state: 'expanded' }),
}));

vi.mock('@/components/ui/app-sidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar">Sidebar</div>,
}));

vi.mock('@/components/ui/WindowFrame', () => ({
  WindowFrame: ({ children }: any) => <div data-testid="window-frame">{children}</div>,
}));

vi.mock('@/components/ui/corner-masks', () => ({
  CornerMasks: () => <div data-testid="corner-masks" />,
}));

vi.mock('@/components/HumanComputerIcon', () => ({
  HumanComputerIcon: ({ onClick, isActive }: any) => (
    <button data-testid="human-computer-icon" onClick={onClick} data-active={isActive}>
      Icon
    </button>
  ),
}));

vi.mock('@/components/ui/intent-line', () => ({
  IntentLine: ({ value, onChange, onKeyDown, placeholder, disabled }: any) => (
    <input
      data-testid="intent-line"
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
    />
  ),
}));

describe('Notebook Page - Info Pill Integration', () => {
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

  beforeEach(() => {
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
    
    // Attach to window
    (global as any).window = {
      ...global.window,
      api: mockApi,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('displays notebook info pill with title after loading', async () => {
    render(<NotebookWorkspacePageLoader />);
    
    // Wait for the notebook to be fetched and displayed
    await waitFor(() => {
      expect(screen.getByText('Test Notebook')).toBeInTheDocument();
    });
    
    // Should also display time and weather
    expect(screen.getByText('68°')).toBeInTheDocument();
  });

  it('fetches notebook details on mount', async () => {
    render(<NotebookWorkspacePageLoader />);
    
    await waitFor(() => {
      expect(mockApi.getNotebookById).toHaveBeenCalledWith('test-notebook-id');
    });
  });

  it('allows editing notebook title through the info pill', async () => {
    render(<NotebookWorkspacePageLoader />);
    
    // Wait for notebook to load
    await waitFor(() => {
      expect(screen.getByText('Test Notebook')).toBeInTheDocument();
    });
    
    // Double-click to edit
    const titleElement = screen.getByText('Test Notebook');
    fireEvent.doubleClick(titleElement);
    
    // Should show input
    const input = screen.getByDisplayValue('Test Notebook');
    expect(input).toBeInTheDocument();
    
    // Clear and type new title
    fireEvent.change(input, { target: { value: 'Updated Notebook Title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    
    // Should call updateNotebook with correct parameters
    await waitFor(() => {
      expect(mockApi.updateNotebook).toHaveBeenCalledWith({
        id: 'test-notebook-id',
        data: { title: 'Updated Notebook Title' }
      });
    });
  });

  it('shows info pill with higher z-index on hover', async () => {
    render(<NotebookWorkspacePageLoader />);
    
    // Wait for notebook to load
    await waitFor(() => {
      expect(screen.getByText('Test Notebook')).toBeInTheDocument();
    });
    
    // Find the pill container
    const pillContainer = screen.getByText('Test Notebook').closest('.notebook-info-pill-container');
    expect(pillContainer).toBeInTheDocument();
    
    // Initial z-index should be 50
    expect(pillContainer).toHaveStyle({ zIndex: '50' });
    
    // Hover over the pill
    fireEvent.mouseEnter(pillContainer!);
    
    // Z-index should change to 9999
    await waitFor(() => {
      expect(pillContainer).toHaveStyle({ zIndex: '9999' });
    });
  });

  it('handles notebook fetch errors gracefully', async () => {
    mockApi.getNotebookById.mockRejectedValue(new Error('Failed to fetch'));
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    render(<NotebookWorkspacePageLoader />);
    
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[NotebookWorkspace] Failed to fetch notebook:'),
        expect.any(Error)
      );
    });
    
    consoleSpy.mockRestore();
  });

  it('handles notebook update errors gracefully', async () => {
    mockApi.updateNotebook.mockRejectedValue(new Error('Update failed'));
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    render(<NotebookWorkspacePageLoader />);
    
    // Wait for notebook to load
    await waitFor(() => {
      expect(screen.getByText('Test Notebook')).toBeInTheDocument();
    });
    
    // Try to edit title
    const titleElement = screen.getByText('Test Notebook');
    fireEvent.doubleClick(titleElement);
    
    const input = screen.getByDisplayValue('Test Notebook');
    fireEvent.change(input, { target: { value: 'New Title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        '[NotebookContent] Failed to update notebook title:',
        expect.any(Error)
      );
    });
    
    consoleSpy.mockRestore();
  });

  it('updates local state immediately after successful title change', async () => {
    render(<NotebookWorkspacePageLoader />);
    
    // Wait for notebook to load
    await waitFor(() => {
      expect(screen.getByText('Test Notebook')).toBeInTheDocument();
    });
    
    // Edit title
    const titleElement = screen.getByText('Test Notebook');
    fireEvent.doubleClick(titleElement);
    
    const input = screen.getByDisplayValue('Test Notebook');
    fireEvent.change(input, { target: { value: 'New Title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    
    // Title should update immediately in the UI
    await waitFor(() => {
      expect(screen.getByText('New Title')).toBeInTheDocument();
      expect(screen.queryByText('Test Notebook')).not.toBeInTheDocument();
    });
  });

  it('maintains pill visibility during page transitions', async () => {
    render(<NotebookWorkspacePageLoader />);
    
    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Test Notebook')).toBeInTheDocument();
    });
    
    // The pill should have the same fade-in animation as the main content
    const pillContainer = screen.getByText('Test Notebook').closest('.notebook-info-pill-container');
    const mainContent = screen.getByTestId('app-sidebar').closest('.flex');
    
    // Both should have opacity animation
    expect(pillContainer?.parentElement).toHaveStyle({ opacity: '1' });
    expect(mainContent).toHaveStyle({ opacity: '1' });
  });

  it('removes click state when clicking outside the pill', async () => {
    render(<NotebookWorkspacePageLoader />);
    
    // Wait for notebook to load
    await waitFor(() => {
      expect(screen.getByText('Test Notebook')).toBeInTheDocument();
    });
    
    const pillContainer = screen.getByText('Test Notebook').closest('.notebook-info-pill-container');
    
    // Click on the pill
    fireEvent.click(pillContainer!);
    
    // Should have high z-index
    expect(pillContainer).toHaveStyle({ zIndex: '9999' });
    
    // Click outside (on the sidebar for example)
    const sidebar = screen.getByTestId('app-sidebar');
    fireEvent.click(sidebar);
    
    // Z-index should return to normal
    await waitFor(() => {
      expect(pillContainer).toHaveStyle({ zIndex: '50' });
    });
  });
});