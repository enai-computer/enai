"use client";

import React, { useEffect, useRef } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { 
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ExternalLink,
  Copy,
  Download,
  Eye,
  Code,
  Scissors,
  Clipboard,
  Type,
  Search,
  X,
  BookOpen,
  FolderOpen,
  Plus,
  Send
} from 'lucide-react';
import { BrowserContextMenuData } from '@shared/types';

interface BrowserContextMenuProps {
  contextData: BrowserContextMenuData;
  onClose: () => void;
}

/**
 * Browser-specific context menu component for WebContentsView overlays
 * Uses DropdownMenu for controlled positioning and state management
 */
export function BrowserContextMenu({ contextData, onClose }: BrowserContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { browserContext: ctx, tabContext, contextType, availableNotebooks } = contextData;
  const isTabContext = contextType === 'tab';

  console.log('[BrowserContextMenu] Rendered with contextData:', {
    contextType,
    isTabContext,
    hasTabContext: !!tabContext,
    availableNotebooks: availableNotebooks?.length || 0,
    tabContext
  });

  useEffect(() => {
    // Focus the menu for keyboard navigation
    if (menuRef.current) {
      const firstMenuItem = menuRef.current.querySelector('[role="menuitem"]');
      if (firstMenuItem instanceof HTMLElement) {
        firstMenuItem.focus();
      }
    }

    // Handle escape key
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Action handlers
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
    onClose();
  };

  const handleSearch = (query: string) => {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.google.com/search?q=${encodedQuery}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    onClose();
  };

  const handleBrowserAction = async (action: string, actionData?: { url?: string; query?: string; x?: number; y?: number }) => {
    await window.api?.browserContextMenu?.sendAction(action, {
      windowId: contextData.windowId,
      ...actionData
    });
    onClose();
  };

  const handleTabAction = async (action: string, tabId: string) => {
    switch (action) {
      case 'close':
        await window.api?.classicBrowserCloseTab?.(contextData.windowId, tabId);
        break;
    }
    onClose();
  };

  const handleTabTransfer = async (targetNotebookId: string, targetTabGroupId?: string) => {
    if (!tabContext) return;
    
    try {
      const result = await window.api?.classicBrowserTabTransfer?.({
        sourceTabId: tabContext.tabId,
        sourceWindowId: contextData.windowId,
        targetNotebookId,
        targetTabGroupId
      });
      
      if (!result?.success) {
        console.error('Failed to transfer tab:', result?.error);
      }
    } catch (error) {
      console.error('Error transferring tab:', error);
    }
    onClose();
  };

  // Fixed positioning at cursor location
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: `${contextData.x}px`,
    top: `${contextData.y}px`,
    zIndex: 9999,
  };

  return (
    <div ref={menuRef} style={menuStyle}>
      <DropdownMenu open={true} onOpenChange={(open) => !open && onClose()}>
        <DropdownMenuTrigger asChild>
          <div style={{ width: 0, height: 0 }} />
        </DropdownMenuTrigger>
        
        <DropdownMenuContent 
          align="start" 
          side="bottom"
          sideOffset={0}
          className="min-w-[200px]"
          onInteractOutside={onClose}
        >
          {/* Tab context menu */}
          {isTabContext && tabContext && (
            <>
              {/* Send to Notebook submenu */}
              {contextData.availableNotebooks && contextData.availableNotebooks.length > 0 && (
                <>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Send className="w-4 h-4 mr-2" />
                      Send to Notebook
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-56">
                      {contextData.availableNotebooks.map(notebook => (
                        <DropdownMenuSub key={notebook.notebookId}>
                          <DropdownMenuSubTrigger>
                            <BookOpen className="w-4 h-4 mr-2" />
                            {notebook.notebookTitle}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-48">
                            {/* Option to create new tab group */}
                            <DropdownMenuItem 
                              onClick={() => handleTabTransfer(notebook.notebookId)}
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Create New Tab Group
                            </DropdownMenuItem>
                            
                            {/* Existing tab groups */}
                            {notebook.tabGroups.length > 0 && (
                              <>
                                <DropdownMenuSeparator />
                                {notebook.tabGroups.map(tabGroup => (
                                  <DropdownMenuItem 
                                    key={tabGroup.tabGroupId}
                                    onClick={() => handleTabTransfer(notebook.notebookId, tabGroup.tabGroupId)}
                                  >
                                    <FolderOpen className="w-4 h-4 mr-2" />
                                    {tabGroup.title} ({tabGroup.tabCount} tabs)
                                  </DropdownMenuItem>
                                ))}
                              </>
                            )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  
                  <DropdownMenuSeparator />
                </>
              )}

              {/* Close tab option */}
              <DropdownMenuItem 
                onClick={() => handleTabAction('close', tabContext.tabId)}
                disabled={!tabContext.canClose}
                className={!tabContext.canClose ? "" : "text-red-600"}
              >
                <X className="w-4 h-4 mr-2" />
                Close Tab
              </DropdownMenuItem>
            </>
          )}

          {/* Browser context menu */}
          {!isTabContext && ctx && (
            <>
          {/* Navigation actions */}
          <DropdownMenuItem 
            onClick={() => handleBrowserAction('navigate:back')}
            disabled={!ctx.canGoBack}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </DropdownMenuItem>
          
          <DropdownMenuItem 
            onClick={() => handleBrowserAction('navigate:forward')}
            disabled={!ctx.canGoForward}
          >
            <ArrowRight className="w-4 h-4 mr-2" />
            Forward
          </DropdownMenuItem>
          
          <DropdownMenuItem onClick={() => handleBrowserAction('navigate:reload')}>
            <RotateCw className="w-4 h-4 mr-2" />
            Reload
          </DropdownMenuItem>
          
          <DropdownMenuSeparator />

          {/* Link actions */}
          {ctx.linkURL && (
            <>
              <DropdownMenuItem onClick={() => handleBrowserAction('link:open-new-tab', { url: ctx.linkURL })}>
                <ExternalLink className="w-4 h-4 mr-2" />
                Open link in new tab
              </DropdownMenuItem>
              
              <DropdownMenuItem onClick={() => handleCopy(ctx.linkURL!)}>
                <Copy className="w-4 h-4 mr-2" />
                Copy link address
              </DropdownMenuItem>
              
              <DropdownMenuSeparator />
            </>
          )}

          {/* Image actions */}
          {ctx.srcURL && ctx.mediaType === 'image' && (
            <>
              <DropdownMenuItem onClick={() => handleBrowserAction('image:open-new-tab', { url: ctx.srcURL })}>
                <ExternalLink className="w-4 h-4 mr-2" />
                Open image in new tab
              </DropdownMenuItem>
              
              <DropdownMenuItem onClick={() => handleCopy(ctx.srcURL!)}>
                <Copy className="w-4 h-4 mr-2" />
                Copy image address
              </DropdownMenuItem>
              
              <DropdownMenuItem onClick={() => handleBrowserAction('image:save', { url: ctx.srcURL })}>
                <Download className="w-4 h-4 mr-2" />
                Save image as...
              </DropdownMenuItem>
              
              <DropdownMenuSeparator />
            </>
          )}

          {/* Text selection actions */}
          {ctx.selectionText && (
            <>
              <DropdownMenuItem onClick={() => handleCopy(ctx.selectionText!)}>
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </DropdownMenuItem>
              
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Search className="w-4 h-4 mr-2" />
                  Search for &quot;{ctx.selectionText.slice(0, 20)}...&quot;
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => handleSearch(ctx.selectionText!)}>
                    Search with Google
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBrowserAction('search:jeffers', { query: ctx.selectionText })}>
                    Search in Jeffers
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              
              <DropdownMenuSeparator />
            </>
          )}

          {/* Edit actions for editable fields */}
          {ctx.isEditable && (
            <>
              {ctx.editFlags.canUndo && (
                <DropdownMenuItem onClick={() => handleBrowserAction('edit:undo')}>
                  Undo
                </DropdownMenuItem>
              )}
              
              {ctx.editFlags.canRedo && (
                <DropdownMenuItem onClick={() => handleBrowserAction('edit:redo')}>
                  Redo
                </DropdownMenuItem>
              )}
              
              <DropdownMenuSeparator />
              
              {ctx.editFlags.canCut && (
                <DropdownMenuItem onClick={() => handleBrowserAction('edit:cut')}>
                  <Scissors className="w-4 h-4 mr-2" />
                  Cut
                </DropdownMenuItem>
              )}
              
              {ctx.editFlags.canCopy && (
                <DropdownMenuItem onClick={() => handleBrowserAction('edit:copy')}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </DropdownMenuItem>
              )}
              
              {ctx.editFlags.canPaste && (
                <DropdownMenuItem onClick={() => handleBrowserAction('edit:paste')}>
                  <Clipboard className="w-4 h-4 mr-2" />
                  Paste
                </DropdownMenuItem>
              )}
              
              {ctx.editFlags.canSelectAll && (
                <DropdownMenuItem onClick={() => handleBrowserAction('edit:select-all')}>
                  <Type className="w-4 h-4 mr-2" />
                  Select All
                </DropdownMenuItem>
              )}
              
              <DropdownMenuSeparator />
            </>
          )}

          {/* Developer actions */}
          <DropdownMenuItem onClick={() => handleBrowserAction('dev:view-source')}>
            <Code className="w-4 h-4 mr-2" />
            View page source
          </DropdownMenuItem>
          
          <DropdownMenuItem onClick={() => handleBrowserAction('dev:inspect', { x: contextData.x, y: contextData.y })}>
            <Eye className="w-4 h-4 mr-2" />
            Inspect element
          </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}