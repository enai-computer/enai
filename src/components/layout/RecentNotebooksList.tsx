"use client";

import React from 'react';
import { RecentNotebook } from '../../../shared/types';
import { Button } from '../ui/button';

interface RecentNotebooksListProps {
  notebooks: RecentNotebook[];
  onSelectNotebook: (notebookId: string) => void;
  topOffset?: number;
}

// Note: The "recently viewed" timestamp may have up to a 5-second delay from the actual
// time of opening, due to the backend activity logging being batched for performance.

/**
 * Simple relative time formatter
 */
function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) {
    return 'just now';
  } else if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  } else if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  } else if (days < 30) {
    return `${days} day${days === 1 ? '' : 's'}`;
  } else {
    return new Date(timestamp).toLocaleDateString();
  }
}

export function RecentNotebooksList({ notebooks, onSelectNotebook, topOffset = 0 }: RecentNotebooksListProps) {
  if (notebooks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">No recent notebooks</p>
        <p className="text-xs mt-1">Your recently viewed notebooks will appear here</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-3" style={{ paddingTop: topOffset ? `${topOffset - 16}px` : 0 }}>
      <h3 className="text-step-9 font-medium text-muted-foreground" style={{ paddingLeft: '48px' }}>Recent Notebooks</h3>
      <div className="flex flex-col space-y-1" style={{ paddingLeft: '48px' }}>
        {notebooks.map((notebook) => (
          <Button
            key={notebook.id}
            variant="ghost"
            className="w-full justify-start text-left h-auto py-2 px-3 hover:bg-step-2/80 dark:hover:bg-step-2/50"
            style={{ marginLeft: '-12px' }}
            onClick={() => onSelectNotebook(notebook.id)}
          >
            <div className="flex items-center justify-between w-full">
              <div className="font-medium text-step-11.5 truncate">
                {notebook.title}
              </div>
              <div className="text-step-11 text-muted-foreground whitespace-nowrap ml-2">
                {getRelativeTime(notebook.lastAccessed)}
              </div>
            </div>
          </Button>
        ))}
      </div>
    </div>
  );
}