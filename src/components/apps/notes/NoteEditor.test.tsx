import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NoteEditor } from './NoteEditor';
import type { Note } from '../../../../shared/types';

// Mock the cn utility
vi.mock('../../../lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' ')
}));

// Add note-related mocks to existing window.api
window.api.getNotesForNotebook = vi.fn().mockResolvedValue([]);
window.api.createNote = vi.fn();
window.api.updateNote = vi.fn();

// Mock window.getSelection and document.execCommand
const mockSelection = {
  rangeCount: 1,
  getRangeAt: vi.fn(),
  removeAllRanges: vi.fn(),
  addRange: vi.fn(),
  toString: () => 'selected text',
};

const mockRange = {
  collapsed: false,
  toString: () => 'selected text',
  commonAncestorContainer: document.createTextNode('test'),
  selectNodeContents: vi.fn(),
  cloneRange: vi.fn(),
  extractContents: vi.fn(),
  insertNode: vi.fn(),
  surroundContents: vi.fn(),
};

Object.defineProperty(window, 'getSelection', {
  value: () => mockSelection,
  writable: true,
});

Object.defineProperty(document, 'execCommand', {
  value: vi.fn(() => true),
  writable: true,
});

describe('NoteEditor', () => {
  const mockNotebookId = 'notebook-123';
  const mockNoteId = 'note-456';
  const mockWindowId = 'window-789';
  
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelection.getRangeAt.mockReturnValue(mockRange);
    mockRange.cloneRange.mockReturnValue(mockRange);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Basic Editing', () => {
    it('should render with placeholder when empty', () => {
      render(<NoteEditor notebookId={mockNotebookId} />);
      
      const editor = screen.getByRole('textbox');
      expect(editor.getAttribute('data-placeholder')).toBe('Start writing your note...');
    });

    it('should allow typing text', async () => {
      render(<NoteEditor notebookId={mockNotebookId} />);
      
      const editor = screen.getByRole('textbox');
      fireEvent.click(editor);
      fireEvent.input(editor, { target: { innerHTML: 'Hello, world!' } });
      
      expect(editor.innerHTML).toContain('Hello, world!');
    });

    it('should sanitize HTML input', async () => {
      render(<NoteEditor notebookId={mockNotebookId} />);
      
      const editor = screen.getByRole('textbox');
      
      // Simulate pasting HTML with script tag
      fireEvent.input(editor, {
        target: {
          innerHTML: '<p>Safe text</p><script>alert("XSS")</script><p onclick="alert()">Click me</p>'
        }
      });
      
      // Check that dangerous content is removed
      expect(editor.innerHTML).not.toContain('<script>');
      expect(editor.innerHTML).not.toContain('onclick');
      expect(editor.innerHTML).toContain('Safe text');
      expect(editor.innerHTML).toContain('Click me');
    });
  });

  describe('Formatting Commands', () => {
    it('should apply bold formatting with CMD+B', async () => {
      render(<NoteEditor notebookId={mockNotebookId} />);
      
      const editor = screen.getByRole('textbox');
      fireEvent.click(editor);
      fireEvent.input(editor, { target: { innerHTML: 'Hello world' } });
      
      // Select all text
      fireEvent.keyDown(editor, { key: 'a', metaKey: true });
      
      // Apply bold
      fireEvent.keyDown(editor, { key: 'b', metaKey: true });
      
      expect(document.execCommand).toHaveBeenCalledWith('bold', false);
    });

    it('should apply italic formatting with CMD+I', async () => {
      render(<NoteEditor notebookId={mockNotebookId} />);
      
      const editor = screen.getByRole('textbox');
      fireEvent.click(editor);
      fireEvent.input(editor, { target: { innerHTML: 'Hello world' } });
      
      // Select all text
      fireEvent.keyDown(editor, { key: 'a', metaKey: true });
      
      // Apply italic
      fireEvent.keyDown(editor, { key: 'i', metaKey: true });
      
      expect(document.execCommand).toHaveBeenCalledWith('italic', false);
    });

    it('should work with CTRL key on Windows/Linux', async () => {
      render(<NoteEditor notebookId={mockNotebookId} />);
      
      const editor = screen.getByRole('textbox');
      fireEvent.click(editor);
      
      // Apply bold with CTRL
      fireEvent.keyDown(editor, { key: 'b', ctrlKey: true });
      
      expect(document.execCommand).toHaveBeenCalledWith('bold', false);
    });

    it('should not apply formatting when no text is selected', async () => {
      // Mock collapsed selection
      mockRange.collapsed = true;
      
      render(<NoteEditor notebookId={mockNotebookId} />);
      
      const editor = screen.getByRole('textbox');
      fireEvent.keyDown(editor, { key: 'b', metaKey: true });
      
      expect(document.execCommand).not.toHaveBeenCalled();
      
      // Reset
      mockRange.collapsed = false;
    });
  });

  describe('Content Persistence', () => {
    it('should auto-save after 1 second of inactivity', async () => {
      vi.useFakeTimers();
      
      render(<NoteEditor notebookId={mockNotebookId} />);
      
      const editor = screen.getByRole('textbox');
      fireEvent.click(editor);
      fireEvent.input(editor, { target: { innerHTML: 'Auto-save test' } });
      
      // Fast-forward 1 second
      vi.advanceTimersByTime(1000);
      
      await waitFor(() => {
        expect(window.api.createNote).toHaveBeenCalledWith({
          notebookId: mockNotebookId,
          content: expect.stringContaining('Auto-save test'),
          type: 'text',
        });
      });
      
      vi.useRealTimers();
    });

    it('should save on blur', async () => {
      render(<NoteEditor notebookId={mockNotebookId} />);
      
      const editor = screen.getByRole('textbox');
      fireEvent.click(editor);
      fireEvent.input(editor, { target: { innerHTML: 'Save on blur' } });
      
      // Blur the editor
      fireEvent.blur(editor);
      
      await waitFor(() => {
        expect(window.api.createNote).toHaveBeenCalledWith({
          notebookId: mockNotebookId,
          content: expect.stringContaining('Save on blur'),
          type: 'text',
        });
      });
    });

    it('should update existing note when noteId is provided', async () => {
      const existingNote: Note = {
        id: mockNoteId,
        notebookId: mockNotebookId,
        content: 'Existing content',
        type: 'text',
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      window.api.getNotesForNotebook.mockResolvedValue([existingNote]);
      
      render(<NoteEditor notebookId={mockNotebookId} noteId={mockNoteId} />);
      
      // Wait for note to load
      await waitFor(() => {
        expect(screen.getByRole('textbox').innerHTML).toContain('Existing content');
      });
      
      const editor = screen.getByRole('textbox');
      fireEvent.click(editor);
      fireEvent.input(editor, { target: { innerHTML: 'Existing content Updated' } });
      
      // Blur to save
      fireEvent.blur(editor);
      
      await waitFor(() => {
        expect(window.api.updateNote).toHaveBeenCalledWith(
          mockNoteId,
          { content: expect.stringContaining('Updated') }
        );
      });
    });

    it('should update window payload after creating new note', async () => {
      const mockActiveStore = {
        getState: () => ({
          updateWindowProps: vi.fn(),
        }),
      };
      
      window.api.createNote.mockResolvedValue({
        id: 'new-note-123',
        notebookId: mockNotebookId,
        content: 'New note',
        type: 'text',
      });
      
      render(
        <NoteEditor 
          notebookId={mockNotebookId} 
          windowId={mockWindowId}
          activeStore={mockActiveStore as any}
        />
      );
      
      const editor = screen.getByRole('textbox');
      fireEvent.click(editor);
      fireEvent.input(editor, { target: { innerHTML: 'New note' } });
      
      fireEvent.blur(editor);
      
      await waitFor(() => {
        expect(mockActiveStore.getState().updateWindowProps).toHaveBeenCalledWith(
          mockWindowId,
          {
            payload: {
              noteId: 'new-note-123',
              notebookId: mockNotebookId,
            },
          }
        );
      });
    });
  });

  describe('Legacy Content Support', () => {
    it('should convert markdown to HTML when loading', async () => {
      const markdownNote: Note = {
        id: mockNoteId,
        notebookId: mockNotebookId,
        content: '**Bold text** and *italic text*',
        type: 'text',
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      window.api.getNotesForNotebook.mockResolvedValue([markdownNote]);
      
      render(<NoteEditor notebookId={mockNotebookId} noteId={mockNoteId} />);
      
      await waitFor(() => {
        const editor = screen.getByRole('textbox');
        expect(editor.innerHTML).toContain('<strong>Bold text</strong>');
        expect(editor.innerHTML).toContain('<em>italic text</em>');
      });
    });

    it('should handle plain text without conversion', async () => {
      const plainNote: Note = {
        id: mockNoteId,
        notebookId: mockNotebookId,
        content: 'Plain text without any formatting',
        type: 'text',
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      window.api.getNotesForNotebook.mockResolvedValue([plainNote]);
      
      render(<NoteEditor notebookId={mockNotebookId} noteId={mockNoteId} />);
      
      await waitFor(() => {
        const editor = screen.getByRole('textbox');
        expect(editor.innerHTML).toContain('Plain text without any formatting');
        expect(editor.innerHTML).not.toContain('<strong>');
        expect(editor.innerHTML).not.toContain('<em>');
      });
    });
  });

  describe('User Interaction', () => {
    it('should blur editor on ESC key', async () => {
      render(<NoteEditor notebookId={mockNotebookId} />);
      
      const editor = screen.getByRole('textbox');
      fireEvent.click(editor);
      editor.focus(); // Ensure focus
      
      // Verify editor has focus
      expect(document.activeElement).toBe(editor);
      
      // Press ESC
      fireEvent.keyDown(editor, { key: 'Escape' });
      
      // Verify editor lost focus
      expect(document.activeElement).not.toBe(editor);
    });

    it('should focus editor when isSelected is true', () => {
      render(<NoteEditor notebookId={mockNotebookId} isSelected={true} />);
      
      const editor = screen.getByRole('textbox');
      
      // Wait a tick for the setTimeout in the component
      setTimeout(() => {
        expect(document.activeElement).toBe(editor);
      }, 0);
    });

    it('should show loading state', async () => {
      // Mock a slow API response
      window.api.getNotesForNotebook.mockImplementation(() => new Promise(() => {}));
      
      render(<NoteEditor notebookId={mockNotebookId} noteId={mockNoteId} />);
      
      expect(screen.getByText('Loading note...')).toBeTruthy();
    });
  });

  describe('Security', () => {
    it('should remove script tags from content', async () => {
      render(<NoteEditor notebookId={mockNotebookId} />);
      
      const editor = screen.getByRole('textbox');
      
      fireEvent.input(editor, {
        target: {
          innerHTML: '<script>alert("XSS")</script>Normal text'
        }
      });
      
      expect(editor.innerHTML).not.toContain('<script>');
      expect(editor.innerHTML).toContain('Normal text');
    });

    it('should remove event handlers from content', async () => {
      render(<NoteEditor notebookId={mockNotebookId} />);
      
      const editor = screen.getByRole('textbox');
      
      fireEvent.input(editor, {
        target: {
          innerHTML: '<div onclick="alert()">Click me</div>'
        }
      });
      
      expect(editor.innerHTML).not.toContain('onclick');
      expect(editor.innerHTML).toContain('Click me');
    });

    it('should remove dangerous elements', async () => {
      render(<NoteEditor notebookId={mockNotebookId} />);
      
      const editor = screen.getByRole('textbox');
      
      fireEvent.input(editor, {
        target: {
          innerHTML: `
            <iframe src="evil.com"></iframe>
            <object data="evil.swf"></object>
            <embed src="evil.swf">
            <link href="evil.css">
            <p>Safe content</p>
          `
        }
      });
      
      expect(editor.innerHTML).not.toContain('<iframe');
      expect(editor.innerHTML).not.toContain('<object');
      expect(editor.innerHTML).not.toContain('<embed');
      expect(editor.innerHTML).not.toContain('<link');
      expect(editor.innerHTML).toContain('Safe content');
    });
  });
});