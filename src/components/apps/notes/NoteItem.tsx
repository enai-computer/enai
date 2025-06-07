"use client";

import { Note } from "@/../shared/types";
import { Button } from "@/components/ui/button";
import { Trash2, Edit } from "lucide-react";

interface NoteItemProps {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (noteId: string) => void;
}

export function NoteItem({ note, onEdit, onDelete }: NoteItemProps) {
  // Create a preview of the content (first 100 characters)
  const preview = note.content.length > 100 
    ? note.content.substring(0, 100) + "..." 
    : note.content;
  
  // Format the date nicely
  const date = new Date(note.updatedAt);
  const formattedDate = date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  return (
    <div className="group relative p-3 border rounded-md hover:bg-accent/50 transition-colors">
      <div 
        className="cursor-pointer"
        onClick={() => onEdit(note)}
      >
        <div className="pr-16">
          <p className="text-sm leading-relaxed">{preview}</p>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-muted-foreground">{formattedDate}</span>
          {note.type === 'ai_generated' && (
            <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">
              AI
            </span>
          )}
        </div>
      </div>
      
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(note);
          }}
        >
          <Edit className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(note.id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}