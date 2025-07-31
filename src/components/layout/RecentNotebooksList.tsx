"use client";

import React from 'react';
import { RecentNotebook } from '../../../shared/types';
import { Button } from '../ui/button';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/dropdown-menu';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '../ui/hover-card';

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
function getRelativeTime(timestamp: string): string {
  const now = Date.now();
  const diff = now - new Date(timestamp).getTime();
  
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
      <motion.div 
        className="flex flex-col items-center justify-center h-full text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <p className="text-sm">No recent notebooks</p>
        <p className="text-xs mt-1">Your recently viewed notebooks will appear here</p>
      </motion.div>
    );
  }

  return (
    <motion.div 
      className="flex flex-col space-y-3" 
      style={{ paddingTop: topOffset ? `${topOffset - 16}px` : 0 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div style={{ paddingLeft: '48px' }}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="text-step-11 font-medium hover:text-step-12 flex items-center gap-1 transition-colors"
            >
              Notebooks
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem>Discover</DropdownMenuItem>
            <DropdownMenuItem>Playlists</DropdownMenuItem>
            <DropdownMenuItem>Goals</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-col space-y-1" style={{ paddingLeft: '48px' }}>
        {notebooks.map((notebook, index) => (
          <motion.div
            key={notebook.id}
            initial={{ opacity: 0 }}
            animate={{ 
              opacity: [0, 0.8, 1]
            }}
            transition={{ 
              duration: 1.8,
              delay: index * 0.1,
              times: [0, 0.5, 1],
              ease: "easeOut"
            }}
          >
            <HoverCard openDelay={700} closeDelay={0}>
              <HoverCardTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start text-left h-auto py-2 px-3 hover:bg-step-2 dark:hover:bg-step-2 data-[state=open]:bg-step-2"
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
              </HoverCardTrigger>
              <HoverCardContent 
                className="w-80 py-2 px-3 bg-step-2 text-step-11.5 dark:text-step-11 border-0 rounded-tl-none rounded-tr-none shadow-none"
                align="end"
                sideOffset={-8}
              >
                <div className="space-y-2">
                  <p className="text-sm">
                    {/* TODO: Fetch actual summary from JeffersObject using notebook.objectId */}
                    Beautiful country burn again, Point Pinos down to the
                    Sur Rivers. Burn as before with bitter wonders, land and ocean and the Carmel water.
                  </p>
                  <div className="flex justify-between text-sm">
                    <div className="flex gap-3">
                      <button className="text-step-11 hover:text-birkin transition-colors">Details</button>
                      <button className="text-step-11 hover:text-birkin transition-colors">Open</button>
                    </div>
                    <button className="text-step-11 hover:text-birkin transition-colors">Delete</button>
                  </div>
                </div>
              </HoverCardContent>
            </HoverCard>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}