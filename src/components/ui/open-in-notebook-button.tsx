"use client";

import React, { useState, useCallback } from 'react';
import { ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

interface OpenInNotebookButtonProps {
  url: string;
  className?: string;
  onBeforeOpen?: () => Promise<void>;
  onAfterClose?: () => Promise<void>;
}

export function OpenInNotebookButton({ url, className, onBeforeOpen, onAfterClose }: OpenInNotebookButtonProps) {
  const [notebooks, setNotebooks] = useState<Array<{ id: string; title: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const loadNotebooks = useCallback(async () => {
    setIsLoading(true);
    try {
      const recent = await window.api.getRecentlyViewedNotebooks();
      // Limit to 5 most recent
      setNotebooks(recent.slice(0, 5));
    } catch (error) {
      console.error('Failed to load notebooks:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleOpenInNotebook = useCallback(async (notebookId: string) => {
    // Navigate to notebook
    router.push(`/notebook/${notebookId}`);
    
    // Send intent to open URL
    await window.api.setIntent({
      intentText: `open ${url}`,
      context: 'notebook',
      notebookId: notebookId
    });
  }, [url, router]);

  const handleCreateNewNotebook = useCallback(async () => {
    try {
      // Extract domain for default title
      const urlObj = new URL(url);
      const title = `Notes on ${urlObj.hostname}`;
      
      const { notebookId } = await window.api.composeNotebook({ title });
      await handleOpenInNotebook(notebookId);
    } catch (error) {
      console.error('Failed to create notebook:', error);
    }
  }, [url, handleOpenInNotebook]);

  return (
    <DropdownMenu onOpenChange={async (open) => {
      if (open) {
        await onBeforeOpen?.();
        loadNotebooks();
      } else {
        await onAfterClose?.();
      }
    }}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="browserAction"
          size="sm"
          className={cn(
            "h-7 px-2 text-xs rounded-full",
            className
          )}
        >
          <ExternalLink className="w-3 h-3 mr-1" />
          Open in notebook
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 z-[200]">
        {isLoading ? (
          <DropdownMenuItem disabled>Loading notebooks...</DropdownMenuItem>
        ) : notebooks.length > 0 ? (
          <>
            {notebooks.map((notebook) => (
              <DropdownMenuItem
                key={notebook.id}
                onClick={() => handleOpenInNotebook(notebook.id)}
              >
                {notebook.title}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onClick={handleCreateNewNotebook}>
          Create new notebook
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}