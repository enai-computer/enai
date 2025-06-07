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
  const [createdNoteId, setCreatedNoteId] = useState<string | null>(null);
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
      if (existingNote || createdNoteId) {
        // Update existing note
        const idToUpdate = existingNote?.id || createdNoteId;
        if (idToUpdate) {
          await window.api.updateNote(idToUpdate, { content });
        }
      } else {
        // Create new note
        const newNote = await window.api.createNote({
          notebookId,
          content,
          type: 'text' as NoteType,
        });
        // Store the created note ID for future updates
        setCreatedNoteId(newNote.id);
      }
    } catch (error) {
      console.error('[NoteEditor] Failed to save note:', error);
    } finally {
      setIsSaving(false);
    }
  }, [content, existingNote, notebookId, createdNoteId]);

  // Auto-save on content change (debounced)
  useEffect(() => {
    if (!content.trim()) return;
    
    const timeoutId = setTimeout(() => {
      handleSave();
    }, 1000); // 1 second debounce
    
    return () => clearTimeout(timeoutId);
  }, [content, handleSave]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Escape to close
    if (e.key === 'Escape' && onClose) {
      e.preventDefault();
      onClose();
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
      <textarea
        ref={textAreaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Start writing your note..."
        className="w-full h-full p-3 text-sm bg-transparent border-0 resize-none focus:outline-none"
        autoFocus
      />
    </div>
  );
}