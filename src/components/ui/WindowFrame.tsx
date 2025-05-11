"use client";

import React, { useCallback, useEffect } from 'react';
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

interface WindowFrameProps {
  windowMeta: WindowMeta;
  activeStore: StoreApi<WindowStoreState>;
  // Later, we might pass children here to render actual window content
}

const DRAG_HANDLE_CLASS = 'window-drag-handle';
const TITLE_BAR_HEIGHT = 40; // Assuming h-10 title bar (10 * 4px = 40px)
const RESIZE_HANDLE_PADDING = 6; // Pixels to reserve for resize handles
const CLASSIC_BROWSER_TOOLBAR_HEIGHT = 38; // Estimated height for the internal classic browser toolbar

export const WindowFrame: React.FC<WindowFrameProps> = ({ windowMeta, activeStore }) => {
  const { updateWindowProps, removeWindow, setWindowFocus } = activeStore.getState();
  const { id: windowId, x, y, width, height, isFocused, isMinimized, type, title, payload, zIndex } = windowMeta;
  const resizeRAF = React.useRef<number>(0);
  const dragRAF = React.useRef<number>(0); // Ref for drag RAF

  const handleDrag: RndProps['onDrag'] = (_e, d) => {
    // 1. Optimistically update React so the frame tracks the cursor
    updateWindowProps(windowId, { x: d.x, y: d.y });

    // 2. Throttle a direct bounds update for the BrowserView during drag
    if (type === 'classic-browser') {
      if (dragRAF.current) {
        cancelAnimationFrame(dragRAF.current);
      }
      dragRAF.current = requestAnimationFrame(() => {
        dragRAF.current = 0;
        if (window.api && typeof window.api.classicBrowserSetBounds === 'function') {
          const viewBounds = {
            x: Math.round(d.x),
            y: Math.round(d.y + TITLE_BAR_HEIGHT + CLASSIC_BROWSER_TOOLBAR_HEIGHT),
            width: Math.round(width - RESIZE_HANDLE_PADDING), // Use current width from state
            height: Math.round(height - TITLE_BAR_HEIGHT - CLASSIC_BROWSER_TOOLBAR_HEIGHT - RESIZE_HANDLE_PADDING), // Use current height
          };
          window.api.classicBrowserSetBounds(windowId, viewBounds)
            .catch((err: Error) => console.error(`[WindowFrame ${windowId}] Error in throttled (drag) classicBrowserSetBounds:`, err));
        }
      });
    }
  };

  const handleDragStop: RndProps['onDragStop'] = (_e, d) => {
    updateWindowProps(windowMeta.id, { x: d.x, y: d.y });
    // Ensure any pending drag RAF is cleared on drag stop, although it should have executed
    if (dragRAF.current) {
      cancelAnimationFrame(dragRAF.current);
      dragRAF.current = 0;
    }
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

    // 2. Throttle a direct bounds update for the BrowserView
    if (type === 'classic-browser') {
      if (resizeRAF.current) {
        cancelAnimationFrame(resizeRAF.current);
      }
      resizeRAF.current = requestAnimationFrame(() => {
        resizeRAF.current = 0;
        if (window.api && typeof window.api.classicBrowserSetBounds === 'function') {
          const viewBounds = {
            x: Math.round(position.x),
            y: Math.round(position.y + TITLE_BAR_HEIGHT + (type === 'classic-browser' ? CLASSIC_BROWSER_TOOLBAR_HEIGHT : 0)),
            width: Math.round(newWidth - RESIZE_HANDLE_PADDING),
            height: Math.round(newHeight - TITLE_BAR_HEIGHT - (type === 'classic-browser' ? CLASSIC_BROWSER_TOOLBAR_HEIGHT : 0) - RESIZE_HANDLE_PADDING),
          };
          window.api.classicBrowserSetBounds(windowId, viewBounds)
            .catch((err: Error) => console.error(`[WindowFrame ${windowId}] Error in throttled (resize) classicBrowserSetBounds:`, err));
        }
      });
    }
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
      
      // This function will now primarily handle visibility and non-resize related bound changes.
      // Bounds during active resize are handled by the onResize -> requestAnimationFrame logic.
      const syncView = () => {
        // Set initial/non-resize bounds
        // This is still important if the window is moved/resized programmatically, not via RND.
        if (window.api && typeof window.api.classicBrowserSetBounds === 'function') {
          const viewBounds = { 
            x: Math.round(x),
            y: Math.round(y + TITLE_BAR_HEIGHT + CLASSIC_BROWSER_TOOLBAR_HEIGHT),
            width: Math.round(width - RESIZE_HANDLE_PADDING),
            height: Math.round(height - TITLE_BAR_HEIGHT - CLASSIC_BROWSER_TOOLBAR_HEIGHT - RESIZE_HANDLE_PADDING)
          };
          window.api.classicBrowserSetBounds(windowId, viewBounds)
            .catch((err: Error) => console.error(`[WindowFrame ${windowId}] Error in effect classicBrowserSetBounds:`, err));
        }

        // Set visibility
        if (window.api && typeof window.api.classicBrowserSetVisibility === 'function') {
          window.api.classicBrowserSetVisibility(windowId, calculatedIsVisible)
            .catch((err: Error) => console.error(`[WindowFrame ${windowId}] Error syncing classic-browser visibility (classicBrowserSetVisibility):`, err));
        }
      };
      
      // Run once on mount and when relevant props change,
      // but not necessarily inside a requestAnimationFrame unless there are performance concerns
      // with how often these props might change outside of direct manipulation.
      // For now, direct call is fine as these props (x,y,width,height,isFocused,isMinimized)
      // changing outside of RND is less frequent.
      syncView();

      // Cleanup for the RAF if it was somehow set by onResize and component unmounts
      return () => {
        if (resizeRAF.current) {
          cancelAnimationFrame(resizeRAF.current);
          resizeRAF.current = 0;
        }
        if (dragRAF.current) { // Cleanup drag RAF
          cancelAnimationFrame(dragRAF.current);
          dragRAF.current = 0;
        }
      };
    }
  }, [windowId, type, x, y, width, height, isFocused, isMinimized, activeStore]); // Ensure all relevant dependencies are here. `activeStore` might be too broad; consider specific functions if possible. For now, keeping it as it influences `updateWindowProps`. Removed direct call to `requestAnimationFrame` from the main body of `useEffect` to simplify.

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
        'shadow-lg rounded-lg bg-card border flex flex-col overflow-hidden', // Simulating Card appearance
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
            />
          ) : type === 'classic-browser' && payload ? (
            <ClassicBrowserViewWrapper
              windowMeta={windowMeta}
              activeStore={activeStore}
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