import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';
import { useParams, useRouter } from 'next/navigation';
import NotebookWorkspacePageLoader from '../[notebookId]/page';
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
    render(<NotebookWorkspacePageLoader />);
    
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
    render(<NotebookWorkspacePageLoader />);
    
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
    render(<NotebookWorkspacePageLoader />);
    
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
    render(<NotebookWorkspacePageLoader />);
    
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
    render(<NotebookWorkspacePageLoader />);
    
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
    render(<NotebookWorkspacePageLoader />);
    
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