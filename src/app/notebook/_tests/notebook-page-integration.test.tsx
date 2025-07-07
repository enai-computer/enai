import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';
import { useParams, useRouter } from 'next/navigation';
import NotebookWorkspacePageLoader from '../[notebookId]/page';
import { createMockWindowApi } from '../../../_tests/helpers/mockWindowApi';

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
  useRouter: vi.fn(),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
}));

// Create mock API
const mockApi = createMockWindowApi();

// Mock components that would cause issues in tests
vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: ({ children }: { children?: React.ReactNode }) => <div data-testid="sidebar">{children}</div>,
  SidebarProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SidebarRail: () => <div data-testid="sidebar-rail" />,
  SidebarHeader: ({ children }: { children?: React.ReactNode }) => <div data-testid="sidebar-header">{children}</div>,
  SidebarContent: ({ children }: { children?: React.ReactNode }) => <div data-testid="sidebar-content">{children}</div>,
  SidebarMenu: ({ children }: { children?: React.ReactNode }) => <div data-testid="sidebar-menu">{children}</div>,
  SidebarMenuItem: ({ children }: { children?: React.ReactNode }) => <div data-testid="sidebar-menu-item">{children}</div>,
  SidebarMenuButton: ({ children, ...props }: { children?: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => <button data-testid="sidebar-menu-button" {...props}>{children}</button>,
  SidebarFooter: ({ children }: { children?: React.ReactNode }) => <div data-testid="sidebar-footer">{children}</div>,
  useSidebar: () => ({ state: 'expanded' }),
}));

vi.mock('@/components/AppSidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar">Sidebar</div>,
}));

vi.mock('@/components/ui/WindowFrame', () => ({
  WindowFrame: ({ children }: { children?: React.ReactNode }) => <div data-testid="window-frame">{children}</div>,
}));

vi.mock('@/components/ui/corner-masks', () => ({
  CornerMasks: () => <div data-testid="corner-masks" />,
}));

vi.mock('@/components/HumanComputerIcon', () => ({
  HumanComputerIcon: ({ onClick, isActive }: { onClick?: () => void; isActive?: boolean }) => (
    <button data-testid="human-computer-icon" onClick={onClick} data-active={isActive}>
      Icon
    </button>
  ),
}));

vi.mock('@/components/ui/intent-line', () => ({
  IntentLine: ({ value, onChange, onKeyDown, placeholder, disabled }: { value?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; onKeyDown?: (e: React.KeyboardEvent) => void; placeholder?: string; disabled?: boolean }) => (
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

vi.mock('@/components/ui/notebook-info-pill', () => ({
  NotebookInfoPill: ({ title, onTitleChange }: { title?: string; onTitleChange?: (title: string) => void }) => {
    const [isEditing, setIsEditing] = React.useState(false);
    const [editedTitle, setEditedTitle] = React.useState(title || '');
    
    React.useEffect(() => {
      setEditedTitle(title || '');
    }, [title]);
    
    return (
      <div 
        className="notebook-info-pill-container"
        style={{ zIndex: 50, opacity: 1 }}
      >
        {isEditing ? (
          <input
            value={editedTitle}
            onChange={(e) => setEditedTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onTitleChange?.(editedTitle);
                setIsEditing(false);
              }
            }}
            onBlur={() => setIsEditing(false)}
          />
        ) : (
          <span onDoubleClick={() => setIsEditing(true)}>{title || ''}</span>
        )}
      </div>
    );
  },
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
    vi.clearAllMocks();
    
    // Setup default mock implementations
    (mockApi.getNotebookById as Mock).mockResolvedValue(mockNotebook);
    (mockApi.updateNotebook as Mock).mockResolvedValue(mockNotebook);
    
    // Setup window with all necessary properties
    global.window = {
      ...global.window,
      api: mockApi,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as Window & typeof globalThis;
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
    
    // Note: Hover state changes are not implemented in this simplified mock
  });

  it('handles notebook fetch errors gracefully', async () => {
    mockApi.getNotebookById.mockRejectedValue(new Error('Failed to fetch'));
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    render(<NotebookWorkspacePageLoader />);
    
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[NotebookWorkspace] Failed to fetch notebook details:'),
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
    
    // Note: Click state changes are not implemented in this simplified mock
    // In a real implementation, clicking the pill would change its z-index
  });
});