"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAutosizeTextArea } from "@/hooks/use-autosize-textarea";
import { Note, NoteType, NoteEditorPayload } from "@/../shared/types";
import type { WindowStoreState } from "@/store/windowStoreFactory";
import type { StoreApi } from "zustand";
import { cn } from "@/lib/utils";

interface NoteEditorProps {
  noteId?: string;
  notebookId: string;
  windowId?: string;
  activeStore?: StoreApi<WindowStoreState>;
  onClose?: () => void;
  isSelected?: boolean;
}

export function NoteEditor({ noteId, notebookId, windowId, activeStore, onClose, isSelected = true }: NoteEditorProps) {
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [existingNote, setExistingNote] = useState<Note | null>(null);
  const [createdNoteId, setCreatedNoteId] = useState<string | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  
  // Ref to store the latest values for saving
  const saveStateRef = useRef({
    content: "",
    existingNote: null as Note | null,
    createdNoteId: null as string | null,
    notebookId: notebookId,
  });
  
  // Update the ref whenever these values change
  useEffect(() => {
    saveStateRef.current = {
      content,
      existingNote,
      createdNoteId,
      notebookId,
    };
  }, [content, existingNote, createdNoteId, notebookId]);
  
  useAutosizeTextArea({
    ref: textAreaRef,
    dependencies: [content]
  });

  // Load note function
  const loadNote = useCallback(async () => {
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
  }, [noteId, notebookId]);

  // Load existing note if noteId is provided
  useEffect(() => {
    if (noteId) {
      loadNote();
    }
  }, [noteId, loadNote]);

  // Stable save function that reads from ref
  const handleSave = useCallback(async () => {
    const { content, existingNote, createdNoteId, notebookId } = saveStateRef.current;
    
    if (!content.trim()) return;
    
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
        
        // Update the window payload to include the noteId
        if (windowId && activeStore) {
          const updatedPayload: NoteEditorPayload = {
            noteId: newNote.id,
            notebookId,
          };
          activeStore.getState().updateWindowProps(windowId, {
            payload: updatedPayload,
          });
        }
      }
    } catch (error) {
      console.error('[NoteEditor] Failed to save note:', error);
    }
  }, []); // No dependencies - reads from ref instead

  // Auto-save on content change (debounced)
  useEffect(() => {
    if (!content.trim()) return;
    
    const timeoutId = setTimeout(() => {
      handleSave();
    }, 1000); // 1 second debounce
    
    return () => clearTimeout(timeoutId);
  }, [content]); // Only depend on content, not handleSave

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
    <div className={cn(
      'flex flex-col h-full p-4',
      isSelected ? 'bg-step-2' : 'bg-step-2'
    )}>
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