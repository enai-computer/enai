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

export const WindowFrame: React.FC<WindowFrameProps> = ({ windowMeta, activeStore }) => {
  const { updateWindowProps, removeWindow, setWindowFocus } = activeStore.getState();
  const { id: windowId, x, y, width, height, isFocused, isMinimized, type } = windowMeta;

  const handleDragStop: RndProps['onDragStop'] = (_e, d) => {
    updateWindowProps(windowMeta.id, { x: d.x, y: d.y });
  };

  const handleResizeStop: RndProps['onResizeStop'] = (
    _e,
    _direction,
    ref,
    _delta,
    position
  ) => {
    updateWindowProps(windowMeta.id, {
      width: parseInt(ref.style.width, 10),
      height: parseInt(ref.style.height, 10),
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

  // Effect for syncing BrowserView bounds and visibility
  useEffect(() => {
    if (type === 'classic-browser') {
      // isVisible can be determined by focus and minimized state.
      // If isMinimized is undefined, we assume it's not minimized.
      const calculatedIsVisible = isFocused && !isMinimized;
      
      const syncView = () => {
        if (window.api && typeof window.api.classicBrowserSyncView === 'function') {
          const currentBounds = { 
            x: Math.round(x), 
            y: Math.round(y), 
            width: Math.round(width), 
            height: Math.round(height) 
          };
          // console.log(`[WindowFrame ${windowId}] Syncing classic-browser: bounds=`, currentBounds, `visible=`, calculatedIsVisible);
          window.api.classicBrowserSyncView(windowId, currentBounds, calculatedIsVisible)
            .catch(err => console.error(`[WindowFrame ${windowId}] Error syncing classic-browser view:`, err));
        }
      };

      // Throttle with requestAnimationFrame
      const animationFrameId = requestAnimationFrame(syncView);
      return () => cancelAnimationFrame(animationFrameId);
    }
  }, [windowId, type, x, y, width, height, isFocused, isMinimized]); // Dependencies for sync

  return (
    <Rnd
      size={{ width: windowMeta.width, height: windowMeta.height }}
      position={{ x: windowMeta.x, y: windowMeta.y }}
      minWidth={200}
      minHeight={150}
      dragHandleClassName={DRAG_HANDLE_CLASS}
      onDragStop={handleDragStop}
      onResizeStop={handleResizeStop}
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
          <span className="font-medium text-sm truncate">{windowMeta.title}</span>
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
          {windowMeta.type === 'chat' && windowMeta.payload && (windowMeta.payload as ChatWindowPayload).sessionId ? (
            <ChatWindow 
              payload={windowMeta.payload as ChatWindowPayload} 
              windowId={windowMeta.id} 
            />
          ) : windowMeta.type === 'classic-browser' && windowMeta.payload ? (
            <ClassicBrowserViewWrapper
              payload={windowMeta.payload as ClassicBrowserPayload}
              windowId={windowMeta.id}
            />
          ) : (
            // Default placeholder content if not a chat window or payload is incorrect
            <div className="p-4">
              <p className="text-xs text-muted-foreground">ID: {windowMeta.id}</p>
              <p className="text-sm">Type: {windowMeta.type}</p>
              <p className="text-sm">Payload: {JSON.stringify(windowMeta.payload)}</p>
            </div>
          )}
        </div>
      </div>
    </Rnd>
  );
}; 