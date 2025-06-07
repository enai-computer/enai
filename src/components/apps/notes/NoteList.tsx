"use client";

import { useState, useEffect } from "react";
import { Note } from "@/../shared/types";
import { NoteItem } from "./NoteItem";
import { Button } from "@/components/ui/button";
import { Plus, StickyNote } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface NoteListProps {
  notebookId: string;
  onNewNote: () => void;
  onEditNote: (note: Note) => void;
}

export function NoteList({ notebookId, onNewNote, onEditNote }: NoteListProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load notes for the notebook
  useEffect(() => {
    loadNotes();
  }, [notebookId]);

  const loadNotes = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const loadedNotes = await window.api.getNotesForNotebook(notebookId);
      setNotes(loadedNotes);
    } catch (err) {
      console.error('[NoteList] Failed to load notes:', err);
      setError('Failed to load notes');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      const success = await window.api.deleteNote(noteId);
      if (success) {
        // Remove from local state immediately
        setNotes(prev => prev.filter(n => n.id !== noteId));
      }
    } catch (err) {
      console.error('[NoteList] Failed to delete note:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-destructive">{error}</p>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={loadNotes}
          className="mt-2"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Notes</h3>
          <span className="text-xs text-muted-foreground">({notes.length})</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onNewNote}
          className="h-7 px-2"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          New
        </Button>
      </div>

      {notes.length === 0 ? (
        <div className="text-center py-8">
          <StickyNote className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No notes yet</p>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={onNewNote}
            className="mt-2"
          >
            Create your first note
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              onEdit={onEditNote}
              onDelete={handleDeleteNote}
            />
          ))}
        </div>
      )}
    </div>
  );
}