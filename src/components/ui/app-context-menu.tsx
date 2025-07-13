"use client";

import React, { useState, useEffect, useRef } from 'react';
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
  X,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Download,
  Eye,
  Code,
  Scissors,
  Clipboard,
  Type
} from 'lucide-react';
import { ContextMenuTarget, BrowserContextMenuData } from '@shared/types';
import { detectContextTarget } from '@/utils/contextDetection';

interface AppContextMenuProps {
  children?: React.ReactNode;
  className?: string;
  // Browser overlay mode props
  browserContext?: BrowserContextMenuData;
  onClose?: () => void;
  open?: boolean;
}

/**
 * Base context menu wrapper that auto-detects context and renders appropriate menu
 * Can also be used in overlay mode with browser context data
 */
export function AppContextMenu({ children, className, browserContext, onClose, open }: AppContextMenuProps) {
  const [target, setTarget] = useState<ContextMenuTarget | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOverlayMode = !!browserContext;

  // Overlay mode effect for browser contexts
  useEffect(() => {
    if (!isOverlayMode || !onClose) return;

    // Focus the menu for keyboard navigation
    if (menuRef.current) {
      menuRef.current.focus();
    }

    // Handle clicks outside menu
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // Handle escape key
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOverlayMode, onClose]);

  // Detect context when menu opens
  const handleContextMenu = (event: Event) => {
    const detected = detectContextTarget(event.target as HTMLElement);
    setTarget(detected);
  };

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
    if (isOverlayMode && onClose) onClose();
  };

  const handleSearch = (query: string, engine: 'google' | 'perplexity') => {
    const encodedQuery = encodeURIComponent(query);
    const url = engine === 'google' 
      ? `https://www.google.com/search?q=${encodedQuery}`
      : `https://www.perplexity.ai/search?q=${encodedQuery}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Browser-specific action handler
  const handleBrowserAction = async (action: string, actionData?: any) => {
    if (!browserContext) return;
    
    await window.api?.browserContextMenu?.sendAction(action, {
      windowId: browserContext.windowId,
      ...actionData
    });
    if (onClose) onClose();
  };


  // Overlay mode for browser contexts
  if (isOverlayMode && browserContext) {
    const { browserContext: ctx } = browserContext;
    const menuStyle: React.CSSProperties = {
      position: 'fixed',
      left: `${browserContext.x}px`,
      top: `${browserContext.y}px`,
      zIndex: 9999,
      pointerEvents: 'auto',
    };

    return (
      <div ref={menuRef} style={menuStyle} className="browser-context-menu">
        <ContextMenu open={true} onOpenChange={(open) => !open && onClose?.()}>
          <ContextMenuTrigger asChild>
            <div style={{ width: 1, height: 1 }} />
          </ContextMenuTrigger>
          
          <ContextMenuContent>
            {/* Navigation actions */}
            <ContextMenuItem 
              onClick={() => handleBrowserAction('navigate:back')}
              disabled={!ctx.canGoBack}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </ContextMenuItem>
            
            <ContextMenuItem 
              onClick={() => handleBrowserAction('navigate:forward')}
              disabled={!ctx.canGoForward}
            >
              <ArrowRight className="w-4 h-4 mr-2" />
              Forward
            </ContextMenuItem>
            
            <ContextMenuItem onClick={() => handleBrowserAction('navigate:reload')}>
              <RotateCw className="w-4 h-4 mr-2" />
              Reload
            </ContextMenuItem>
            
            <ContextMenuSeparator />

            {/* Link actions */}
            {ctx.linkURL && (
              <>
                <ContextMenuItem onClick={() => handleBrowserAction('link:open-new-tab', { url: ctx.linkURL })}>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open link in new tab
                </ContextMenuItem>
                
                <ContextMenuItem onClick={() => handleCopy(ctx.linkURL!)}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy link address
                </ContextMenuItem>
                
                <ContextMenuSeparator />
              </>
            )}

            {/* Image actions */}
            {ctx.srcURL && ctx.mediaType === 'image' && (
              <>
                <ContextMenuItem onClick={() => handleBrowserAction('image:open-new-tab', { url: ctx.srcURL })}>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open image in new tab
                </ContextMenuItem>
                
                <ContextMenuItem onClick={() => handleCopy(ctx.srcURL!)}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy image address
                </ContextMenuItem>
                
                <ContextMenuItem onClick={() => handleBrowserAction('image:save', { url: ctx.srcURL })}>
                  <Download className="w-4 h-4 mr-2" />
                  Save image as...
                </ContextMenuItem>
                
                <ContextMenuSeparator />
              </>
            )}

            {/* Text selection actions */}
            {ctx.selectionText && (
              <>
                <ContextMenuItem onClick={() => handleCopy(ctx.selectionText!)}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </ContextMenuItem>
                
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Search className="w-4 h-4 mr-2" />
                    Search for "{ctx.selectionText.slice(0, 20)}..."
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    <ContextMenuItem onClick={() => handleSearch(ctx.selectionText!, 'google')}>
                      Search with Google
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleBrowserAction('search:jeffers', { query: ctx.selectionText })}>
                      Search in Jeffers
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
                
                <ContextMenuSeparator />
              </>
            )}

            {/* Edit actions for editable fields */}
            {ctx.isEditable && (
              <>
                {ctx.editFlags.canUndo && (
                  <ContextMenuItem onClick={() => handleBrowserAction('edit:undo')}>
                    Undo
                  </ContextMenuItem>
                )}
                
                {ctx.editFlags.canRedo && (
                  <ContextMenuItem onClick={() => handleBrowserAction('edit:redo')}>
                    Redo
                  </ContextMenuItem>
                )}
                
                <ContextMenuSeparator />
                
                {ctx.editFlags.canCut && (
                  <ContextMenuItem onClick={() => handleBrowserAction('edit:cut')}>
                    <Scissors className="w-4 h-4 mr-2" />
                    Cut
                  </ContextMenuItem>
                )}
                
                {ctx.editFlags.canCopy && (
                  <ContextMenuItem onClick={() => handleBrowserAction('edit:copy')}>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy
                  </ContextMenuItem>
                )}
                
                {ctx.editFlags.canPaste && (
                  <ContextMenuItem onClick={() => handleBrowserAction('edit:paste')}>
                    <Clipboard className="w-4 h-4 mr-2" />
                    Paste
                  </ContextMenuItem>
                )}
                
                {ctx.editFlags.canSelectAll && (
                  <ContextMenuItem onClick={() => handleBrowserAction('edit:select-all')}>
                    <Type className="w-4 h-4 mr-2" />
                    Select All
                  </ContextMenuItem>
                )}
                
                <ContextMenuSeparator />
              </>
            )}

            {/* Developer actions */}
            <ContextMenuItem onClick={() => handleBrowserAction('dev:view-source')}>
              <Code className="w-4 h-4 mr-2" />
              View page source
            </ContextMenuItem>
            
            <ContextMenuItem onClick={() => handleBrowserAction('dev:inspect', { x: browserContext.x, y: browserContext.y })}>
              <Eye className="w-4 h-4 mr-2" />
              Inspect element
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    );
  }

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