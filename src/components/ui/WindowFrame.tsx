"use client";

import React, { useCallback, useEffect, memo } from 'react';
import { Rnd, type Props as RndProps } from 'react-rnd';
import type { StoreApi } from 'zustand';
import type { WindowMeta, WindowContentType } from '../../../shared/types'; // Adjusted path
import type { WindowStoreState } from '../../store/windowStoreFactory'; // Adjusted path
import { Button } from './button'; // Assuming button is in the same directory or accessible via alias
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils'; // Assuming cn utility is available
import { ChatWindow } from '../apps/chat/ChatWindow'; // Import ChatWindow
import { ClassicBrowserViewWrapper } from '../apps/classic-browser/ClassicBrowser'; // Added import
import { ChatWindowPayload, ClassicBrowserPayload } from '../../../shared/types'; // Import ChatWindowPayload and ClassicBrowserPayload // Adjusted path for ClassicBrowserPayload

export interface WindowContentGeometry {
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
}

interface WindowFrameProps {
  windowMeta: WindowMeta;
  activeStore: StoreApi<WindowStoreState>;
  notebookId: string; // Added notebookId prop
  // Later, we might pass children here to render actual window content
}

const DRAG_HANDLE_CLASS = 'window-drag-handle';
const TITLE_BAR_HEIGHT = 40; // Assuming h-10 title bar (10 * 4px = 40px)

// Renaming original component to allow wrapping with memo
const OriginalWindowFrame: React.FC<WindowFrameProps> = ({ windowMeta, activeStore, notebookId }) => {
  const { updateWindowProps, removeWindow, setWindowFocus } = activeStore.getState();
  const { id: windowId, x, y, width, height, isFocused, isMinimized, type, title, payload, zIndex } = windowMeta;

  const handleDrag: RndProps['onDrag'] = (_e, d) => {
    // 1. Optimistically update React so the frame tracks the cursor
    updateWindowProps(windowId, { x: d.x, y: d.y });
  };

  const handleDragStop: RndProps['onDragStop'] = (_e, d) => {
    updateWindowProps(windowMeta.id, { x: d.x, y: d.y });
  };

  const handleResize: RndProps['onResize'] = (
    _e,
    _direction,
    ref,
    _delta,
    position
  ) => {
    const newWidth = parseInt(ref.style.width, 10);
    const newHeight = parseInt(ref.style.height, 10);

    // 1. Optimistically update React so the frame tracks the cursor
    updateWindowProps(windowMeta.id, {
      width: newWidth,
      height: newHeight,
      x: position.x,
      y: position.y,
    });
  };

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent focus logic if clicking close
    removeWindow(windowMeta.id);
    // If this window was a classic browser, tell main process to destroy its BrowserView
    if (windowMeta.type === 'classic-browser') {
      if (window.api && typeof window.api.classicBrowserDestroy === 'function') {
        window.api.classicBrowserDestroy(windowMeta.id)
          .catch(err => console.error(`[WindowFrame ${windowMeta.id}] Error on classicBrowserDestroy:`, err));
      }
    }
  }, [removeWindow, windowMeta.id, windowMeta.type]);

  const handleMouseDown = useCallback(() => {
    setWindowFocus(windowMeta.id);
    if (windowMeta.type === 'classic-browser') {
      // Electron typically focuses the BrowserView when the window is focused and the view is attached.
      // If more explicit focus control is needed, a dedicated IPC like classicBrowserFocus(windowId) could be added.
      // For now, relying on default behavior and the setVisibility logic in the service.
      console.log(`[WindowFrame ${windowMeta.id}] Clicked on classic-browser window. Focus handled by setWindowFocus and BrowserView visibility logic.`);
      // TODO: If Electron's default focus on BrowserView is insufficient, implement:
      // window.api.classicBrowserFocus(windowMeta.id); // Requires new IPC and service method
    }
  }, [setWindowFocus, windowMeta.id, windowMeta.type]);

  // Effect for syncing BrowserView bounds and visibility (simplified)
  useEffect(() => {
    if (type === 'classic-browser') {
      const calculatedIsVisible = isFocused && !isMinimized;
      
      // This function will now primarily handle visibility.
      // Bounds updates are delegated to ClassicBrowserViewWrapper.
      const syncView = () => {
        // Set visibility
        if (window.api && typeof window.api.classicBrowserSetVisibility === 'function') {
          window.api.classicBrowserSetVisibility(windowId, calculatedIsVisible)
          // .catch((err: Error) => console.error(`[WindowFrame ${windowId}] Error syncing classic-browser visibility (classicBrowserSetVisibility):`, err)); // No longer returns a promise
        }
      };
      
      syncView();

      // Cleanup for RAF is REMOVED as RAFs are removed
      return () => {
        // No specific cleanup related to bounds needed here anymore
      };
    }
  }, [windowId, type, x, y, width, height, isFocused, isMinimized]); // Removed activeStore, simplified dependencies.

  // Calculate content geometry to pass to children
  const contentGeometry: WindowContentGeometry = {
    contentX: x, // Relative to parent, BrowserView needs absolute screen coords.
                 // If RND provides absolute, these are fine. If relative, adjust.
                 // For now, assuming x,y from RND are absolute or what BrowserView needs.
    contentY: y + TITLE_BAR_HEIGHT,
    contentWidth: width,
    contentHeight: height - TITLE_BAR_HEIGHT,
  };

  return (
    <Rnd
      size={{ width: windowMeta.width, height: windowMeta.height }}
      position={{ x: windowMeta.x, y: windowMeta.y }}
      minWidth={200}
      minHeight={150}
      dragHandleClassName={DRAG_HANDLE_CLASS}
      onDrag={handleDrag}
      onDragStop={handleDragStop}
      onResize={handleResize}
      onMouseDown={handleMouseDown}
      bounds="parent" // Constrain to parent (desktop area)
      className={cn(
        'shadow-lg rounded-lg bg-card border flex flex-col overflow-hidden will-change-transform', // Simulating Card appearance
        windowMeta.isFocused ? 'ring-2 ring-primary ring-offset-2' : 'ring-1 ring-border'
      )}
      style={{
        zIndex: windowMeta.zIndex,
      }}
      enableResizing={{
        top: false,
        right: true,
        bottom: true,
        left: false,
        topRight: false,
        bottomRight: true,
        bottomLeft: false,
        topLeft: false,
      }}
    >
      {/* This div is the direct child that Rnd controls, styled as a card */}
      <div className="flex flex-col h-full">
        {/* Title Bar */}
        <div
          className={cn(
            DRAG_HANDLE_CLASS,
            'h-10 flex items-center justify-between px-3 py-2 bg-muted/50 border-b select-none cursor-grab active:cursor-grabbing'
          )}
        >
          <span className="font-medium text-sm truncate">{title}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleClose}
            aria-label="Close window"
          >
            <XIcon className="h-4 w-4" />
          </Button>
        </div>

        {/* Content Area */}
        <div className="p-0 flex-grow overflow-auto bg-background flex flex-col">
          {type === 'chat' && payload && (payload as ChatWindowPayload).sessionId ? (
            <ChatWindow 
              payload={payload as ChatWindowPayload} 
              windowId={windowId}
              notebookId={notebookId} // Pass notebookId here
            />
          ) : type === 'classic-browser' && payload ? (
            <ClassicBrowserViewWrapper
              windowMeta={windowMeta}
              activeStore={activeStore}
              contentGeometry={contentGeometry} // Pass content geometry
              isActuallyVisible={isFocused && !isMinimized} // Pass combined visibility
            />
          ) : (
            // Default placeholder content if not a chat window or payload is incorrect
            <div className="p-4">
              <p className="text-xs text-muted-foreground">ID: {windowId}</p>
              <p className="text-sm">Type: {type}</p>
              <p className="text-sm">Payload: {JSON.stringify(payload)}</p>
            </div>
          )}
        </div>
      </div>
    </Rnd>
  );
}; 

// Custom comparison function for React.memo
const windowFramePropsAreEqual = (prevProps: WindowFrameProps, nextProps: WindowFrameProps) => {
  // Compare critical props that affect WindowFrame's rendering
  return (
    prevProps.notebookId === nextProps.notebookId &&
    prevProps.activeStore === nextProps.activeStore && // Instance should be stable per notebook
    prevProps.windowMeta.id === nextProps.windowMeta.id &&
    prevProps.windowMeta.x === nextProps.windowMeta.x &&
    prevProps.windowMeta.y === nextProps.windowMeta.y &&
    prevProps.windowMeta.width === nextProps.windowMeta.width &&
    prevProps.windowMeta.height === nextProps.windowMeta.height &&
    prevProps.windowMeta.zIndex === nextProps.windowMeta.zIndex &&
    prevProps.windowMeta.isFocused === nextProps.windowMeta.isFocused &&
    prevProps.windowMeta.isMinimized === nextProps.windowMeta.isMinimized && // Assuming isMinimized is used by WindowFrame
    prevProps.windowMeta.title === nextProps.windowMeta.title &&
    prevProps.windowMeta.type === nextProps.windowMeta.type &&
    // Shallow compare payload. If payload is complex and its internal changes
    // should re-render WindowFrame (not just its children), a deep compare or more specific checks needed.
    // For now, assuming children handle their own payload changes or payload is simple.
    Object.is(prevProps.windowMeta.payload, nextProps.windowMeta.payload)
  );
};

export const WindowFrame = memo(OriginalWindowFrame, windowFramePropsAreEqual); 