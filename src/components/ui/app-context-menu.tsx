"use client";

import React, { useState } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/ui/context-menu';
import { 
  ExternalLink, 
  Plus, 
  Copy, 
  Search, 
  Globe,
  BookOpen,
  AppWindow,
  Brain,
  X
} from 'lucide-react';
import { ContextMenuTarget } from '@shared/types';
import { detectContextTarget } from '@/utils/contextDetection';

interface AppContextMenuProps {
  children?: React.ReactNode;
  className?: string;
}

/**
 * Context menu wrapper that auto-detects DOM element context and renders appropriate menu
 */
export function AppContextMenu({ children, className }: AppContextMenuProps) {
  const [target, setTarget] = useState<ContextMenuTarget | null>(null);

  // Action handlers
  const handleOpenInNewTab = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleOpenInNewWindow = (url: string) => {
    window.open(url, '_blank', 'width=1200,height=800,menubar=yes,toolbar=yes,location=yes,status=yes,resizable=yes,scrollbars=yes');
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // TODO: Add toast notification
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleSearch = (query: string, engine: 'google' | 'perplexity') => {
    const encodedQuery = encodeURIComponent(query);
    const url = engine === 'google' 
      ? `https://www.google.com/search?q=${encodedQuery}`
      : `https://www.perplexity.ai/search?q=${encodedQuery}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };


  // Regular DOM-based context menu
  return (
    <ContextMenu>
      <ContextMenuTrigger 
        asChild 
        className={className}
        onContextMenu={(e) => {
          const detected = detectContextTarget(e.target as HTMLElement);
          setTarget(detected);
        }}
      >
        {children}
      </ContextMenuTrigger>
      
      <ContextMenuContent>
        {/* Link context menu */}
        {target?.type === 'link' && (
          <>
            <ContextMenuItem onClick={() => handleOpenInNewTab(target.url)}>
              <ExternalLink className="w-4 h-4 mr-2" />
              Open in new tab
            </ContextMenuItem>
            
            <ContextMenuItem onClick={() => handleOpenInNewWindow(target.url)}>
              <Plus className="w-4 h-4 mr-2" />
              Open in new window
            </ContextMenuItem>
            
            <ContextMenuSeparator />
            
            <ContextMenuItem onClick={() => handleCopy(target.url)}>
              Copy link
            </ContextMenuItem>
          </>
        )}

        {/* Text selection context menu */}
        {target?.type === 'text-selection' && (
          <>
            <ContextMenuItem onClick={() => handleCopy(target.text)}>
              <Copy className="w-4 h-4 mr-2" />
              Copy
            </ContextMenuItem>
            
            <ContextMenuSeparator />
            
            <ContextMenuItem onClick={() => handleSearch(target.text, 'google')}>
              <Search className="w-4 h-4 mr-2" />
              Search Google
            </ContextMenuItem>
            
            <ContextMenuItem onClick={() => handleSearch(target.text, 'perplexity')}>
              <Globe className="w-4 h-4 mr-2" />
              Search Perplexity
            </ContextMenuItem>
          </>
        )}

        {/* Browser tab context menu */}
        {target?.type === 'browser-tab' && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <BookOpen className="w-4 h-4 mr-2" />
                Move to Notebook
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {/* TODO: Populate with notebooks in Phase 3 */}
                <ContextMenuItem disabled>No notebooks available</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <AppWindow className="w-4 h-4 mr-2" />
                Move to Window
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {/* TODO: Populate with windows in Phase 3 */}
                <ContextMenuItem disabled>No other windows</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            
            <ContextMenuSeparator />
            
            <ContextMenuItem onClick={() => {
              // TODO: Implement memory toggle in Phase 3
              console.log('Toggle memory for tab:', target.tabId);
              // Close menu after action
            }}>
              {target.inMemory ? (
                <>
                  <X className="w-4 h-4 mr-2" />
                  Remove from Memory
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Add to Memory
                </>
              )}
            </ContextMenuItem>
          </>
        )}

        {/* Default context menu */}
        {(!target || target.type === 'default') && (
          <ContextMenuItem disabled>
            No actions available
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}