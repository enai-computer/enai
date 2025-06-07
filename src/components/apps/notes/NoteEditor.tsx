"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useAutosizeTextArea } from "@/hooks/use-autosize-textarea";
import { Note, NoteType } from "@/../shared/types";

interface NoteEditorProps {
  noteId?: string;
  notebookId: string;
  onClose?: () => void;
}

export function NoteEditor({ noteId, notebookId, onClose }: NoteEditorProps) {
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [existingNote, setExistingNote] = useState<Note | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  
  useAutosizeTextArea({
    ref: textAreaRef,
    dependencies: [content]
  });

  // Load existing note if noteId is provided
  useEffect(() => {
    if (noteId) {
      loadNote();
    }
  }, [noteId]);

  const loadNote = async () => {
    if (!noteId) return;
    
    setIsLoading(true);
    try {
      const notes = await window.api.getNotesForNotebook(notebookId);
      const note = notes.find(n => n.id === noteId);
      if (note) {
        setExistingNote(note);
        setContent(note.content);
      }
    } catch (error) {
      console.error('[NoteEditor] Failed to load note:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = useCallback(async () => {
    if (!content.trim()) return;
    
    setIsSaving(true);
    try {
      if (existingNote) {
        // Update existing note
        await window.api.updateNote(existingNote.id, { content });
      } else {
        // Create new note
        await window.api.createNote({
          notebookId,
          content,
          type: 'text' as NoteType,
        });
        // After creating, close the editor
        onClose?.();
      }
    } catch (error) {
      console.error('[NoteEditor] Failed to save note:', error);
    } finally {
      setIsSaving(false);
    }
  }, [content, existingNote, notebookId, onClose]);

  // Auto-save on content change (debounced)
  useEffect(() => {
    if (!existingNote || !content) return;
    
    const timeoutId = setTimeout(() => {
      handleSave();
    }, 1000); // 1 second debounce
    
    return () => clearTimeout(timeoutId);
  }, [content, existingNote]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl + Enter to save and close
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-muted-foreground">Loading note...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex-1 overflow-y-auto">
        <textarea
          ref={textAreaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Start writing your note..."
          className="w-full min-h-[200px] p-3 text-sm bg-transparent border-0 resize-none focus:outline-none"
          autoFocus
        />
      </div>
      <div className="flex justify-between items-center mt-4 pt-4 border-t">
        <div className="text-xs text-muted-foreground">
          {existingNote ? 'Auto-saving...' : 'Press Cmd+Enter to save'}
        </div>
        <div className="flex gap-2">
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
            >
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !content.trim()}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}