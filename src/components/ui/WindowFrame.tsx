"use client";

import React, { useCallback, useEffect, memo } from 'react';
import { Rnd, type Props as RndProps } from 'react-rnd';
import type { StoreApi } from 'zustand';
import type { WindowMeta, WindowContentType } from '../../../shared/types'; // Adjusted path
import type { WindowStoreState } from '../../store/windowStoreFactory'; // Adjusted path
import { cn } from '@/lib/utils'; // Assuming cn utility is available
import { ChatWindow } from '../apps/chat/ChatWindow'; // Import ChatWindow
import { ClassicBrowserViewWrapper } from '../apps/classic-browser/ClassicBrowser'; // Added import
import { ChatWindowPayload, ClassicBrowserPayload } from '../../../shared/types'; // Import ChatWindowPayload and ClassicBrowserPayload // Adjusted path for ClassicBrowserPayload
import { WindowControls } from './WindowControls'; // Import WindowControls

export interface WindowContentGeometry {
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
}

interface WindowFrameProps {
  windowMeta: WindowMeta;
  activeStore: StoreApi<WindowStoreState>;
  notebookId: string;
  headerContent?: React.ReactNode;
  children?: React.ReactNode;
}

const DRAG_HANDLE_CLASS = 'window-drag-handle';
const MIN_TITLE_BAR_HEIGHT = 20; // Renamed from TITLE_BAR_HEIGHT for clarity in min height calculation
const BORDER_WIDTH = 4; // The visible border of the inner window
const RESIZE_GUTTER_WIDTH = 2; // Invisible gutter for resize handles

const MIN_CONTENT_WIDTH = 200;
const MIN_CONTENT_HEIGHT = 150;

// Renaming original component to allow wrapping with memo
const OriginalWindowFrame: React.FC<WindowFrameProps> = ({ windowMeta, activeStore, notebookId, headerContent, children }) => {
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

  const handleVisualWindowMouseDown = useCallback(() => {
    // Optimistically update React state for immediate visual feedback if desired,
    // but the authoritative focus and stacking will come via IPC from main.
    // setWindowFocus(windowMeta.id); // Commenting out direct call, or make it conditional

    if (windowMeta.type === 'classic-browser') {
      activeStore.getState().setWindowFocus(windowId);          // immediate
      if (window.api && typeof window.api.classicBrowserRequestFocus === 'function') {
        console.log(`[WindowFrame ${windowId}] Requesting focus from main process.`);
        window.api.classicBrowserRequestFocus(windowId);
      } else {
        console.warn(`[WindowFrame ${windowId}] classicBrowserRequestFocus API not available.`);
      }
    } else {
      // For non-classic-browser types (like chat), direct setWindowFocus is still appropriate.
      setWindowFocus(windowId);
    }
  }, [setWindowFocus, windowId, windowMeta.type, activeStore]);

  // Effect for syncing BrowserView bounds and visibility (simplified)
  useEffect(() => {
    if (type === 'classic-browser') {
      const shouldBeDrawn = !isMinimized; 
      // isFocused is already available from windowMeta
      
      // This function will now primarily handle visibility and focus for the native view.
      // Bounds updates are delegated to ClassicBrowserViewWrapper.
      const syncView = () => {
        // Set visibility and focus
        if (window.api && typeof window.api.classicBrowserSetVisibility === 'function') {
          window.api.classicBrowserSetVisibility(windowId, shouldBeDrawn, isFocused);
        }
      };
      
      syncView();

    }
  }, [windowId, type, isFocused, isMinimized, x, y, width, height]); // Added isFocused and isMinimized, kept geometry for now although not directly used in this effect for visibility

  // Calculate content geometry to pass to children
  // Content geometry is now always calculated with the BORDER_WIDTH.
  const contentGeometry: WindowContentGeometry = {
    contentX: x + RESIZE_GUTTER_WIDTH + BORDER_WIDTH,
    contentY: y + RESIZE_GUTTER_WIDTH + BORDER_WIDTH + (headerContent ? 40 : MIN_TITLE_BAR_HEIGHT),
    contentWidth: width - 2 * RESIZE_GUTTER_WIDTH - 2 * BORDER_WIDTH,
    contentHeight: height - 2 * RESIZE_GUTTER_WIDTH - (headerContent ? 40 : MIN_TITLE_BAR_HEIGHT) - 2 * BORDER_WIDTH,
  };

  const minRndWidth = MIN_CONTENT_WIDTH + (2 * BORDER_WIDTH) + (2 * RESIZE_GUTTER_WIDTH);
  const minRndHeight = MIN_CONTENT_HEIGHT + MIN_TITLE_BAR_HEIGHT + (2 * BORDER_WIDTH) + (2 * RESIZE_GUTTER_WIDTH);

  return (
    <Rnd
      size={{ width: windowMeta.width, height: windowMeta.height }}
      position={{ x: windowMeta.x, y: windowMeta.y }}
      minWidth={minRndWidth}
      minHeight={minRndHeight}
      dragHandleClassName={DRAG_HANDLE_CLASS}
      onDrag={handleDrag}
      onDragStop={handleDragStop}
      onResize={handleResize}
      bounds="parent"
      className="will-change-transform"
      style={{
        zIndex: windowMeta.zIndex,
        padding: `${RESIZE_GUTTER_WIDTH}px`, // Creates the gutter for resizing
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
      {/* Inner Visual Window Div */}
      <div
        className={cn(
          'h-full w-full flex flex-col overflow-hidden shadow-lg rounded-lg bg-step-1',
          windowMeta.isFocused ? 'border-step-11' : 'border-step-6'
        )}
        style={{
          borderWidth: `${BORDER_WIDTH}px`,
          borderStyle: 'solid',
        }}
        onMouseDown={handleVisualWindowMouseDown} // Focus when clicking the visible window
      >
        {/* Title Bar (New Structure) */}
        <div
          className={cn(
            DRAG_HANDLE_CLASS, // Drag handle class on the title bar
            'flex items-center px-1 select-none border-b',
            headerContent ? 'h-10' : 'h-5', // Dynamic height: h-10 (40px) if headerContent, else h-5 (20px)
            windowMeta.isFocused ? 'bg-step-11' : 'bg-[var(--step-6)]' // Conditional background color
          )}
          style={{ borderColor: 'inherit' }} // Style border color of title bar to match main window border
        >
          {headerContent && (
            <div className="flex flex-1 items-center gap-1 pr-2 no-drag">
              {headerContent}
            </div>
          )}
          <WindowControls id={windowId} activeStore={activeStore} />
        </div>

        {/* Content Area */}
        <div className="p-0 flex-grow overflow-auto bg-step-1 flex flex-col">
          {children}
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
    Object.is(prevProps.windowMeta.payload, nextProps.windowMeta.payload) &&
    // Compare headerContent. If it's a React node, direct comparison might be tricky
    // and could lead to unnecessary re-renders if not handled carefully.
    // For now, simple equality, but this might need refinement if headerContent becomes complex.
    prevProps.headerContent === nextProps.headerContent &&
    prevProps.children === nextProps.children
  );
};

export const WindowFrame = memo(OriginalWindowFrame, windowFramePropsAreEqual); 