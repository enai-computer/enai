"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
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

// Simple HTML sanitizer - removes scripts and dangerous elements
function sanitizeHTML(html: string): string {
  // Create a temporary div to parse HTML
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  // Remove script tags and event handlers
  const scripts = temp.querySelectorAll('script, style, iframe, object, embed, link');
  scripts.forEach(el => el.remove());
  
  // Remove all event attributes
  temp.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('on')) {
        el.removeAttribute(attr.name);
      }
    });
  });
  
  return temp.innerHTML;
}

// Check if content might be markdown (legacy notes)
function isMarkdown(content: string): boolean {
  const markdownPatterns = [
    /^#{1,6}\s/m,     // Headers
    /\*\*.*\*\*/,     // Bold
    /\*[^*]+\*/,      // Italic
    /\[.*\]\(.*\)/,   // Links
    /^[-*+]\s/m,      // Lists
    /^>\s/m,          // Blockquotes
    /```/             // Code blocks
  ];
  
  return markdownPatterns.some(pattern => pattern.test(content));
}

// Simple markdown to HTML converter for legacy notes
function markdownToHTML(markdown: string): string {
  let html = markdown;
  
  // Convert bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // Convert italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  
  // Convert line breaks
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

export function NoteEditor({ noteId, notebookId, windowId, activeStore, onClose, isSelected = true }: NoteEditorProps) {
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [existingNote, setExistingNote] = useState<Note | null>(null);
  const [createdNoteId, setCreatedNoteId] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  
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

  // Load note function
  const loadNote = useCallback(async () => {
    if (!noteId) return;
    
    setIsLoading(true);
    try {
      const notes = await window.api.getNotesForNotebook(notebookId);
      const note = notes.find(n => n.id === noteId);
      if (note) {
        setExistingNote(note);
        
        // Handle legacy markdown notes
        let htmlContent = note.content;
        if (isMarkdown(note.content)) {
          htmlContent = markdownToHTML(note.content);
        }
        
        setContent(htmlContent);
        
        // Update the editor's innerHTML if it exists
        if (editorRef.current) {
          editorRef.current.innerHTML = sanitizeHTML(htmlContent);
        }
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
  
  // Focus editor when component mounts or becomes selected
  useEffect(() => {
    if (isSelected && editorRef.current) {
      const timer = setTimeout(() => {
        editorRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isSelected]);

  // Initialize content in the editor
  useEffect(() => {
    if (editorRef.current && content && !editorRef.current.innerHTML) {
      editorRef.current.innerHTML = sanitizeHTML(content);
    }
  }, [content]);

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
  }, [activeStore, windowId]);

  // Auto-save on content change (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      handleSave();
    }, 1000); // 1 second debounce
    
    return () => clearTimeout(timeoutId);
  }, [content, handleSave]);

  // Handle input changes
  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const newContent = e.currentTarget.innerHTML;
    const sanitized = sanitizeHTML(newContent);
    setContent(sanitized);
  }, []);

  // Apply formatting using execCommand
  const applyFormat = useCallback((tag: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    
    const range = selection.getRangeAt(0);
    if (range.collapsed) return; // No text selected
    
    // Use execCommand which handles all edge cases properly
    if (tag === 'strong') {
      document.execCommand('bold', false);
    } else if (tag === 'em') {
      document.execCommand('italic', false);
    }
    
    // Update our state with the new HTML
    if (editorRef.current) {
      setContent(editorRef.current.innerHTML);
      // Keep focus (execCommand maintains selection automatically)
      editorRef.current.focus();
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Escape to blur
    if (e.key === 'Escape') {
      e.preventDefault();
      editorRef.current?.blur();
      return;
    }

    const modifier = e.metaKey || e.ctrlKey;
    
    if (modifier) {
      switch (e.key) {
        case 'b':
          e.preventDefault();
          applyFormat('strong');
          break;
        case 'i':
          e.preventDefault();
          applyFormat('em');
          break;
      }
    }
  }, [applyFormat]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-muted-foreground">Loading note...</div>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex flex-col h-full overflow-y-auto',
      isSelected ? 'bg-step-2' : 'bg-step-2'
    )}>
      <div
        ref={editorRef}
        role="textbox"
        aria-label="Note editor"
        contentEditable
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          handleSave(); // Explicitly save on blur
        }}
        suppressContentEditableWarning
        className={cn(
          "w-full min-h-full p-6 text-sm bg-transparent border-0 resize-none focus:outline-none",
          "prose prose-sm dark:prose-invert prose-p:my-1 prose-headings:my-2 max-w-none",
          "[&:empty]:before:content-[attr(data-placeholder)]",
          "[&:empty]:before:text-muted-foreground"
        )}
        data-placeholder="Start writing your note..."
        style={{
          outline: 'none',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap'
        }}
      />
    </div>
  );
}