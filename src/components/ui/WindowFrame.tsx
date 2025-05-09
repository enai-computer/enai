"use client";

import React, { useCallback } from 'react';
import { Rnd, type Props as RndProps } from 'react-rnd';
import type { StoreApi } from 'zustand';
import type { WindowMeta, WindowContentType } from '../../../shared/types'; // Adjusted path
import type { WindowStoreState } from '../../store/windowStoreFactory'; // Adjusted path
import { Button } from './button'; // Assuming button is in the same directory or accessible via alias
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils'; // Assuming cn utility is available
import { ChatWindow } from '../apps/chat/ChatWindow'; // Import ChatWindow
import { ChatWindowPayload } from '../../../shared/types'; // Import ChatWindowPayload

interface WindowFrameProps {
  windowMeta: WindowMeta;
  activeStore: StoreApi<WindowStoreState>;
  // Later, we might pass children here to render actual window content
}

const DRAG_HANDLE_CLASS = 'window-drag-handle';

export const WindowFrame: React.FC<WindowFrameProps> = ({ windowMeta, activeStore }) => {
  const { updateWindowProps, removeWindow, setWindowFocus } = activeStore.getState();

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
  }, [removeWindow, windowMeta.id]);

  const handleMouseDown = useCallback(() => {
    setWindowFocus(windowMeta.id);
  }, [setWindowFocus, windowMeta.id]);

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