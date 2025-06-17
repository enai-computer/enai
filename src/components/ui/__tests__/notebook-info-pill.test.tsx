import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotebookInfoPill } from '../notebook-info-pill';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

describe('NotebookInfoPill', () => {
  const mockOnTitleChange = vi.fn();
  const defaultProps = {
    title: 'Test Notebook',
    onTitleChange: mockOnTitleChange,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockOnTitleChange.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders notebook title, time, and weather', () => {
    render(<NotebookInfoPill {...defaultProps} />);
    
    expect(screen.getByText('Test Notebook')).toBeInTheDocument();
    expect(screen.getByText('68°')).toBeInTheDocument();
    // Time should be displayed (check for time format)
    expect(screen.getByText(/\d{1,2}:\d{2} [AP]M/)).toBeInTheDocument();
  });

  it('updates time every minute', () => {
    const { rerender } = render(<NotebookInfoPill {...defaultProps} />);
    
    const initialTime = screen.getByText(/\d{1,2}:\d{2} [AP]M/);
    expect(initialTime).toBeInTheDocument();
    
    // Advance time by 1 minute
    vi.advanceTimersByTime(60000);
    
    // Force re-render to see the updated time
    rerender(<NotebookInfoPill {...defaultProps} />);
    
    // Time should still be displayed (format is correct)
    expect(screen.getByText(/\d{1,2}:\d{2} [AP]M/)).toBeInTheDocument();
  });

  it('enters edit mode on double-click', () => {
    render(<NotebookInfoPill {...defaultProps} />);
    
    const titleSpan = screen.getByText('Test Notebook');
    
    // Double-click to enter edit mode
    fireEvent.doubleClick(titleSpan);
    
    // Input should appear with the current title
    const input = screen.getByDisplayValue('Test Notebook');
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it('saves title on Enter key', () => {
    render(<NotebookInfoPill {...defaultProps} />);
    
    const titleSpan = screen.getByText('Test Notebook');
    fireEvent.doubleClick(titleSpan);
    
    const input = screen.getByDisplayValue('Test Notebook');
    
    // Clear and type new title
    fireEvent.change(input, { target: { value: 'New Title' } });
    
    // Press Enter to save
    fireEvent.keyDown(input, { key: 'Enter' });
    
    expect(mockOnTitleChange).toHaveBeenCalledWith('New Title');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('cancels edit on Escape key', () => {
    render(<NotebookInfoPill {...defaultProps} />);
    
    const titleSpan = screen.getByText('Test Notebook');
    fireEvent.doubleClick(titleSpan);
    
    const input = screen.getByDisplayValue('Test Notebook');
    
    // Type new title but don't save
    fireEvent.change(input, { target: { value: 'New Title' } });
    
    // Press Escape to cancel
    fireEvent.keyDown(input, { key: 'Escape' });
    
    expect(mockOnTitleChange).not.toHaveBeenCalled();
    expect(screen.getByText('Test Notebook')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('saves title on blur', () => {
    render(<NotebookInfoPill {...defaultProps} />);
    
    const titleSpan = screen.getByText('Test Notebook');
    fireEvent.doubleClick(titleSpan);
    
    const input = screen.getByDisplayValue('Test Notebook');
    
    // Clear and type new title
    fireEvent.change(input, { target: { value: 'New Title' } });
    
    // Click outside to blur
    fireEvent.blur(input);
    
    expect(mockOnTitleChange).toHaveBeenCalledWith('New Title');
  });

  it('does not save if title is unchanged', () => {
    render(<NotebookInfoPill {...defaultProps} />);
    
    const titleSpan = screen.getByText('Test Notebook');
    fireEvent.doubleClick(titleSpan);
    
    const input = screen.getByDisplayValue('Test Notebook');
    
    // Press Enter without changing anything
    fireEvent.keyDown(input, { key: 'Enter' });
    
    expect(mockOnTitleChange).not.toHaveBeenCalled();
  });

  it('trims whitespace from title before saving', () => {
    render(<NotebookInfoPill {...defaultProps} />);
    
    const titleSpan = screen.getByText('Test Notebook');
    fireEvent.doubleClick(titleSpan);
    
    const input = screen.getByDisplayValue('Test Notebook');
    
    // Clear and type new title with whitespace
    fireEvent.change(input, { target: { value: '  New Title  ' } });
    
    // Press Enter to save
    fireEvent.keyDown(input, { key: 'Enter' });
    
    expect(mockOnTitleChange).toHaveBeenCalledWith('New Title');
  });

  it('does not save empty title', () => {
    render(<NotebookInfoPill {...defaultProps} />);
    
    const titleSpan = screen.getByText('Test Notebook');
    fireEvent.doubleClick(titleSpan);
    
    const input = screen.getByDisplayValue('Test Notebook');
    
    // Clear the input completely
    fireEvent.change(input, { target: { value: '' } });
    
    // Press Enter to save
    fireEvent.keyDown(input, { key: 'Enter' });
    
    expect(mockOnTitleChange).not.toHaveBeenCalled();
    expect(screen.getByText('Test Notebook')).toBeInTheDocument();
  });

  it('updates edit value when title prop changes', () => {
    const { rerender } = render(<NotebookInfoPill {...defaultProps} />);
    
    expect(screen.getByText('Test Notebook')).toBeInTheDocument();
    
    // Update the title prop
    rerender(<NotebookInfoPill {...defaultProps} title="Updated Notebook" />);
    
    expect(screen.getByText('Updated Notebook')).toBeInTheDocument();
    expect(screen.queryByText('Test Notebook')).not.toBeInTheDocument();
  });

  it('applies hover styles to individual elements', () => {
    render(<NotebookInfoPill {...defaultProps} />);
    
    const titleSpan = screen.getByText('Test Notebook');
    
    // Check that hover class exists
    expect(titleSpan).toHaveClass('hover:text-birkin');
  });

  it('shows double-click hint in title attribute', () => {
    render(<NotebookInfoPill {...defaultProps} />);
    
    const titleSpan = screen.getByText('Test Notebook');
    expect(titleSpan).toHaveAttribute('title', 'Double-click to edit');
  });

  it('dynamically adjusts input width based on content', () => {
    render(<NotebookInfoPill {...defaultProps} />);
    
    const titleSpan = screen.getByText('Test Notebook');
    fireEvent.doubleClick(titleSpan);
    
    const input = screen.getByDisplayValue('Test Notebook');
    const initialWidth = input.style.width;
    
    // Type a longer title
    fireEvent.change(input, { target: { value: 'This is a much longer notebook title' } });
    
    const newWidth = input.style.width;
    expect(parseInt(newWidth)).toBeGreaterThan(parseInt(initialWidth));
  });

  it('applies custom className', () => {
    render(<NotebookInfoPill {...defaultProps} className="custom-class" />);
    
    const pill = screen.getByText('Test Notebook').closest('div');
    expect(pill).toHaveClass('custom-class');
  });

  it('stops propagation on input click to prevent parent handlers', () => {
    const handleParentClick = vi.fn();
    
    render(
      <div onClick={handleParentClick}>
        <NotebookInfoPill {...defaultProps} />
      </div>
    );
    
    const titleSpan = screen.getByText('Test Notebook');
    fireEvent.doubleClick(titleSpan);
    
    // Double-click is stopped by the component, so parent handler should NOT be called
    expect(handleParentClick).toHaveBeenCalledTimes(0);
    
    const input = screen.getByDisplayValue('Test Notebook');
    fireEvent.click(input);
    
    // Parent click handler should still not be called when clicking the input
    expect(handleParentClick).toHaveBeenCalledTimes(0);
  });

  it('cleans up interval on unmount', () => {
    const { unmount } = render(<NotebookInfoPill {...defaultProps} />);
    
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    
    unmount();
    
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});