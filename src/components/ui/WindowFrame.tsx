"use client";

import React, { useCallback, useEffect, memo, useRef, useState } from 'react';
import { Rnd, type Props as RndProps } from 'react-rnd';
import type { StoreApi } from 'zustand';
import type { WindowMeta, WindowContentType, WindowPayload } from '../../../shared/types'; // Adjusted path
import type { WindowStoreState } from '../../store/windowStoreFactory'; // Adjusted path
import { cn } from '@/lib/utils'; // Assuming cn utility is available
import { ChatWindow } from '../apps/chat/ChatWindow'; // Import ChatWindow
import { ClassicBrowserViewWrapper } from '../apps/classic-browser/ClassicBrowser'; // Added import
import { NoteEditor } from '../apps/notes/NoteEditor'; // Import NoteEditor
import { ChatWindowPayload, ClassicBrowserPayload, NoteEditorPayload } from '../../../shared/types'; // Import payload types
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
  sidebarState?: "expanded" | "collapsed";
}

const DRAG_HANDLE_CLASS = 'window-drag-handle';
const MIN_TITLE_BAR_HEIGHT = 20; // Renamed from TITLE_BAR_HEIGHT for clarity in min height calculation
const BORDER_WIDTH = 4; // The visible border of the inner window
const RESIZE_GUTTER_WIDTH = 2; // Invisible gutter for resize handles

const MIN_CONTENT_WIDTH = 200;
const MIN_CONTENT_HEIGHT = 150;

// Renaming original component to allow wrapping with memo
const OriginalWindowFrame: React.FC<WindowFrameProps> = ({ windowMeta, activeStore, notebookId, headerContent, children }) => {
  const { id: windowId, x, y, width, height, isFocused, isMinimized, type, payload } = windowMeta;
  const isDraggingRef = useRef(false);
  const [dragPosition, setDragPosition] = useState({ x, y });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeSize, setResizeSize] = useState({ width, height });

  // Sync dragPosition and resizeSize with windowMeta when not dragging/resizing
  useEffect(() => {
    if (!isDraggingRef.current) {
      setDragPosition({ x, y });
    }
    if (!isResizing) {
      setResizeSize({ width, height });
    }
  }, [x, y, width, height, isResizing]);

  const handleDrag: RndProps['onDrag'] = (_e, d) => {
    // Update local position for contentGeometry calculation during drag
    setDragPosition({ x: d.x, y: d.y });
    if (!isDraggingRef.current) {
      console.log(`[WindowFrame ${windowId}] Started dragging window`);
      isDraggingRef.current = true;
      setIsDragging(true);
    }
  };

  const handleDragStop: RndProps['onDragStop'] = (_e, d) => {
    console.log(`[WindowFrame ${windowId}] Drag stopped at (${d.x}, ${d.y})`);
    isDraggingRef.current = false;
    setIsDragging(false);
    activeStore.getState().updateWindowProps(windowMeta.id, { x: d.x, y: d.y });
  };

  const handleResize: RndProps['onResize'] = (
    _e,
    _direction,
    ref,
    _delta,
    position
  ) => {
    // Update local size and position for contentGeometry calculation during resize
    const newWidth = parseInt(ref.style.width, 10);
    const newHeight = parseInt(ref.style.height, 10);
    setResizeSize({ width: newWidth, height: newHeight });
    setDragPosition({ x: position.x, y: position.y });
    
    if (!isResizing) {
      console.log(`[WindowFrame ${windowId}] Started resizing window`);
      setIsResizing(true);
    }
  };

  const handleResizeStop: RndProps['onResizeStop'] = (
    _e,
    _direction,
    ref,
    _delta,
    position
  ) => {
    const newWidth = parseInt(ref.style.width, 10);
    const newHeight = parseInt(ref.style.height, 10);

    console.log(`[WindowFrame ${windowId}] Resize stopped at size (${newWidth}, ${newHeight})`);
    setIsResizing(false);
    
    activeStore.getState().updateWindowProps(windowMeta.id, {
      width: newWidth,
      height: newHeight,
      x: position.x,
      y: position.y,
    });
  };

  const handleVisualWindowMouseDown = useCallback(() => {
    // Set focus in the store for all window types
    // The controller pattern will handle any necessary browser-specific focus operations
    activeStore.getState().setWindowFocus(windowId);
  }, [windowId, activeStore]);

  // Effect for syncing BrowserView bounds and visibility (simplified)
  useEffect(() => {
    if (type === 'classic-browser') {
      // The view should only be 'drawn' (visible) if it's not minimized.
      // Note: We don't check isFrozen here because the freeze/unfreeze operations
      // handle visibility timing themselves to prevent flicker.
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
      
      // Cleanup: hide the view when WindowFrame unmounts
      return () => {
        if (window.api && typeof window.api.classicBrowserSetVisibility === 'function') {
          // Hide the view when component unmounts (e.g., when leaving notebook)
          window.api.classicBrowserSetVisibility(windowId, false, false);
        }
      };
    }
  }, [windowId, type, isFocused, isMinimized]); // Dependencies updated to only include logical state, not geometry

  // Calculate content geometry to pass to children
  // Use local state during drag/resize for immediate updates, otherwise use store values
  const currentX = (isDraggingRef.current || isResizing) ? dragPosition.x : x;
  const currentY = (isDraggingRef.current || isResizing) ? dragPosition.y : y;
  const currentWidth = isResizing ? resizeSize.width : width;
  const currentHeight = isResizing ? resizeSize.height : height;
  
  // Memoize contentGeometry to prevent unnecessary re-renders
  // For classic-browser windows, we don't subtract the title bar height since the header is internal
  const isClassicBrowser = type === 'classic-browser';
  const titleBarHeight = headerContent ? 40 : MIN_TITLE_BAR_HEIGHT;
  const contentGeometry = React.useMemo<WindowContentGeometry>(() => ({
    contentX: currentX + RESIZE_GUTTER_WIDTH + BORDER_WIDTH,
    contentY: currentY + RESIZE_GUTTER_WIDTH + BORDER_WIDTH + (isClassicBrowser ? MIN_TITLE_BAR_HEIGHT : titleBarHeight),
    contentWidth: currentWidth - 2 * RESIZE_GUTTER_WIDTH - 2 * BORDER_WIDTH,
    contentHeight: currentHeight - 2 * RESIZE_GUTTER_WIDTH - (isClassicBrowser ? MIN_TITLE_BAR_HEIGHT : titleBarHeight) - 2 * BORDER_WIDTH,
  }), [currentX, currentY, currentWidth, currentHeight, isClassicBrowser, titleBarHeight]);

  const minRndWidth = MIN_CONTENT_WIDTH + (2 * BORDER_WIDTH) + (2 * RESIZE_GUTTER_WIDTH);
  const minRndHeight = MIN_CONTENT_HEIGHT + MIN_TITLE_BAR_HEIGHT + (2 * BORDER_WIDTH) + (2 * RESIZE_GUTTER_WIDTH);

  // Hide the window if it's minimized
  if (isMinimized) {
    return null;
  }


  return (
    <Rnd
      size={{ width: windowMeta.width, height: windowMeta.height }}
      position={{ x: windowMeta.x, y: windowMeta.y }}
      minWidth={minRndWidth}
      minHeight={minRndHeight}
      dragHandleClassName={DRAG_HANDLE_CLASS}
      cancel=".no-drag"
      onDrag={handleDrag}
      onDragStop={handleDragStop}
      onResize={handleResize}
      onResizeStop={handleResizeStop}
      bounds="parent"
      className="will-change-transform"
      disableDragging={false}
      enableUserSelectHack={false}
      style={{
        zIndex: windowMeta.zIndex,
        padding: `${RESIZE_GUTTER_WIDTH}px`, // Creates the gutter for resizing
        transform: 'translateZ(0)', // Force hardware acceleration
        backfaceVisibility: 'hidden', // Improve performance
      }}
      dragAxis="both"
      dragGrid={[1, 1]}
      resizeGrid={[1, 1]}
      enableResizing={{
        top: false,
        right: true,
        bottom: true,
        left: true,
        topRight: true,
        bottomRight: true,
        bottomLeft: true,
        topLeft: true,
      }}
    >
      {type === 'classic-browser' ? (
        // For classic-browser, render minimal wrapper with no UI
        <div
          className="h-full w-full"
          onMouseDown={handleVisualWindowMouseDown} // Keep focus handling
        >
          <ClassicBrowserViewWrapper
            key={windowId}
            windowMeta={windowMeta}
            activeStore={activeStore}
            contentGeometry={contentGeometry}
            isActuallyVisible={!isMinimized}
            isDragging={isDragging}
            isResizing={isResizing}
          />
        </div>
      ) : (
        // For other window types, render the full UI with border and title bar
        <div
          className={cn(
            'h-full w-full flex flex-col overflow-hidden shadow-lg rounded-lg',
            windowMeta.isFocused ? 'bg-step-4' : 'bg-step-3',
            windowMeta.isFocused ? 'border-step-4' : 'border-step-3'
          )}
          style={{
            borderWidth: `${BORDER_WIDTH}px`,
            borderStyle: 'solid',
          }}
          onMouseDown={handleVisualWindowMouseDown} // Focus when clicking the visible window
        >
          {/* Title Bar - Only for non-browser windows */}
          <div
            className={cn(
              DRAG_HANDLE_CLASS, // Drag handle class on the title bar
              'flex items-center px-1 select-none border-b',
              headerContent ? 'h-10' : 'h-5', // Dynamic height: h-10 (40px) if headerContent, else h-5 (20px)
              windowMeta.isFocused ? 'bg-step-4' : 'bg-step-3' // Conditional background color
            )}
            style={{ borderColor: 'inherit' }} // Style border color of title bar to match main window border
          >
            {headerContent && (
              <div className="flex flex-1 items-center gap-1 h-full">
                {headerContent}
              </div>
            )}
            {!headerContent && <div className="flex-1" />}
            <div className="no-drag">
              <WindowControls id={windowId} activeStore={activeStore} isFocused={windowMeta.isFocused} />
            </div>
          </div>

          {/* Content Area - Designated content slot */}
          <div className="p-0 flex-grow overflow-hidden bg-transparent flex flex-col rounded-t-lg">
            {type === 'chat' && (
              <ChatWindow
                key={windowId}
                payload={payload as ChatWindowPayload}
                windowId={windowId}
                notebookId={notebookId}
              />
            )}
            {type === 'note_editor' && (
              <NoteEditor
                key={windowId}
                noteId={(payload as NoteEditorPayload).noteId}
                notebookId={(payload as NoteEditorPayload).notebookId}
                windowId={windowId}
                activeStore={activeStore}
                onClose={() => activeStore.getState().removeWindow(windowId)}
                isSelected={windowMeta.isFocused}
              />
            )}
            {type !== 'chat' && type !== 'note_editor' && children}
          </div>
        </div>
      )}
    </Rnd>
  );
}; 

// Helper function to compare payloads based on window type
const payloadsAreEqual = (type: WindowContentType, prevPayload: WindowPayload, nextPayload: WindowPayload): boolean => {
  if (prevPayload === nextPayload) return true;
  
  // Handle undefined/null cases
  if (!prevPayload || !nextPayload) return false;
  
  // For classic-browser, do deep comparison of relevant fields
  if (type === 'classic-browser') {
    const prev = prevPayload as ClassicBrowserPayload;
    const next = nextPayload as ClassicBrowserPayload;
    
    // Check if tabs array has changed (by length and IDs)
    if (prev.tabs.length !== next.tabs.length) return false;
    if (prev.activeTabId !== next.activeTabId) return false;
    
    // Check if freezeState has changed
    if (prev.freezeState.type !== next.freezeState.type) return false;
    if ('snapshotUrl' in prev.freezeState && 'snapshotUrl' in next.freezeState) {
      if (prev.freezeState.snapshotUrl !== next.freezeState.snapshotUrl) return false;
    }
    
    // Check if any tab has changed
    for (let i = 0; i < prev.tabs.length; i++) {
      const prevTab = prev.tabs[i];
      const nextTab = next.tabs[i];
      if (prevTab.id !== nextTab.id ||
          prevTab.url !== nextTab.url ||
          prevTab.title !== nextTab.title ||
          prevTab.isLoading !== nextTab.isLoading ||
          prevTab.error !== nextTab.error) {
        return false;
      }
    }
    
    return true;
  }
  
  // For other types, fall back to reference equality
  return prevPayload === nextPayload;
};

// Custom comparison function for React.memo
const windowFramePropsAreEqual = (prevProps: WindowFrameProps, nextProps: WindowFrameProps) => {
  // No longer force re-render for classic-browser windows
  // The ClassicBrowserViewWrapper handles its own lifecycle properly now
  
  const isEqual = (
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
    // Deep comparison for payload based on window type
    payloadsAreEqual(prevProps.windowMeta.type, prevProps.windowMeta.payload, nextProps.windowMeta.payload) &&
    // Compare headerContent. If it's a React node, direct comparison might be tricky
    // and could lead to unnecessary re-renders if not handled carefully.
    // For now, simple equality, but this might need refinement if headerContent becomes complex.
    prevProps.headerContent === nextProps.headerContent &&
    prevProps.children === nextProps.children &&
    prevProps.sidebarState === nextProps.sidebarState
  );
  
  if (!isEqual) {
    console.log(`[WindowFrame ${nextProps.windowMeta.id}] Props changed, will re-render`, {
      windowId: nextProps.windowMeta.id,
      type: nextProps.windowMeta.type,
      changes: {
        notebookId: prevProps.notebookId !== nextProps.notebookId,
        activeStore: prevProps.activeStore !== nextProps.activeStore,
        windowMeta: {
          id: prevProps.windowMeta.id !== nextProps.windowMeta.id,
          x: prevProps.windowMeta.x !== nextProps.windowMeta.x,
          y: prevProps.windowMeta.y !== nextProps.windowMeta.y,
          width: prevProps.windowMeta.width !== nextProps.windowMeta.width,
          height: prevProps.windowMeta.height !== nextProps.windowMeta.height,
          zIndex: prevProps.windowMeta.zIndex !== nextProps.windowMeta.zIndex,
          isFocused: prevProps.windowMeta.isFocused !== nextProps.windowMeta.isFocused,
          isMinimized: prevProps.windowMeta.isMinimized !== nextProps.windowMeta.isMinimized,
          title: prevProps.windowMeta.title !== nextProps.windowMeta.title,
          type: prevProps.windowMeta.type !== nextProps.windowMeta.type,
          payload: prevProps.windowMeta.payload !== nextProps.windowMeta.payload,
        },
        headerContent: prevProps.headerContent !== nextProps.headerContent,
        children: prevProps.children !== nextProps.children,
        sidebarState: prevProps.sidebarState !== nextProps.sidebarState
      },
      timestamp: new Date().toISOString()
    });
  }
  
  return isEqual;
};

export const WindowFrame = memo(OriginalWindowFrame, windowFramePropsAreEqual); 