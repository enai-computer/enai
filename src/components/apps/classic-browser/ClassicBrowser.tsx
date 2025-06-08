"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { StoreApi } from 'zustand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ArrowRight, RotateCw, XCircle, Globe } from 'lucide-react';
import type { ClassicBrowserPayload, WindowMeta } from '../../../../shared/types';
import type { WindowStoreState } from '../../../store/windowStoreFactory';
import type { WindowContentGeometry } from '../../ui/WindowFrame';

// It's common to have a defined height for the title bar to calculate content area
// const TITLE_BAR_HEIGHT = 40; // This is WindowFrame's concern, remove from here if it was just for reference
const BROWSER_VIEW_TOOLBAR_HEIGHT = 38; // Internal toolbar height for ClassicBrowserViewWrapper
const BROWSER_VIEW_RESIZE_PADDING = 0; // If BrowserView needs to be smaller than contentArea, e.g. for its own visual reasons or to avoid RND handles. Set to 0 if not needed or RND handles are outside content area.

interface ClassicBrowserContentProps {
  windowMeta: WindowMeta; // Changed from 'payload' to 'windowMeta' for full context
  activeStore: StoreApi<WindowStoreState>;
  contentGeometry: WindowContentGeometry; // Add the new prop
  isActuallyVisible: boolean; // Add prop for visibility state
  isDragging?: boolean; // Add prop for dragging state
  isResizing?: boolean; // Add prop for resizing state
  sidebarState?: "expanded" | "collapsed"; // Add prop for sidebar state
  // titleBarHeight: number; // If passed from WindowFrame
}

export const ClassicBrowserViewWrapper: React.FC<ClassicBrowserContentProps> = ({ // Renamed component for clarity if needed, sticking to existing for now
  windowMeta,
  activeStore,
  contentGeometry,
  isActuallyVisible,
  isDragging = false,
  isResizing = false,
  sidebarState,
}) => {
  const { id: windowId, payload, isFrozen = false, snapshotDataUrl = null } = windowMeta;
  // Ensure payload is of type ClassicBrowserPayload
  const classicPayload = payload as ClassicBrowserPayload;
  
  console.log(`[ClassicBrowserViewWrapper] Mounting for window ${windowId}`, {
    payload: classicPayload,
    isActuallyVisible,
    timestamp: new Date().toISOString()
  });
  
  console.log(`[ClassicBrowserViewWrapper ${windowId}] Mounting/Rendering:`, {
    windowId,
    isActuallyVisible,
    payload: classicPayload,
    contentGeometry,
    isFrozen,
    snapshotDataUrl: snapshotDataUrl ? 'present' : 'null',
    timestamp: new Date().toISOString()
  });
  
  // Track mounting/unmounting
  useEffect(() => {
    console.log(`[ClassicBrowserViewWrapper ${windowId}] Component mounted`, {
      windowId,
      timestamp: new Date().toISOString()
    });
    
    return () => {
      console.log(`[ClassicBrowserViewWrapper ${windowId}] Component unmounting`, {
        windowId,
        timestamp: new Date().toISOString()
      });
    };
  }, [windowId]);

  const [addressBarUrl, setAddressBarUrl] = useState<string>(classicPayload.requestedUrl || classicPayload.currentUrl || classicPayload.initialUrl || 'https://');
  const contentRef = useRef<HTMLDivElement>(null); // For observing content area size and position
  const boundsRAF = React.useRef<number>(0); // For throttling setBounds during rapid geometry changes

  // Derived state from windowMeta.payload for UI binding
  const {
    currentUrl = '',
    requestedUrl = '',
    isLoading = false,
    canGoBack = false,
    canGoForward = false,
    error = null,
  } = classicPayload;

  // Effect for CREATING and DESTROYING the BrowserView instance
  useEffect(() => {
    console.log(`[ClassicBrowserViewWrapper ${windowId}] Creation effect running`, {
      windowId,
      initialUrl: classicPayload.initialUrl,
      timestamp: new Date().toISOString()
    });
    
    const { updateWindowProps } = activeStore.getState();
    let isNavigating = false;
    let unsubscribeFromState: (() => void) | undefined;
    
    // Listen for navigation state to prevent destruction during navigation
    if (window.api && typeof window.api.onClassicBrowserState === 'function') {
      unsubscribeFromState = window.api.onClassicBrowserState((update: { windowId: string; state: Partial<ClassicBrowserPayload> }) => {
        if (update.windowId === windowId) {
          if (update.state.isLoading !== undefined) {
            isNavigating = update.state.isLoading;
          }
        }
      });
    }
    
    // Use getBoundingClientRect to get actual screen coordinates
    const calculateInitialBounds = () => {
      if (contentRef.current) {
        const rect = contentRef.current.getBoundingClientRect();
        return {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }
      // Fallback to contentGeometry if ref not ready
      const { contentX, contentY, contentWidth, contentHeight } = contentGeometry;
      return {
        x: Math.round(contentX),
        y: Math.round(contentY + BROWSER_VIEW_TOOLBAR_HEIGHT),
        width: Math.round(contentWidth - BROWSER_VIEW_RESIZE_PADDING * 2),
        height: Math.round(contentHeight - BROWSER_VIEW_TOOLBAR_HEIGHT - BROWSER_VIEW_RESIZE_PADDING),
      };
    };

    // Delay creation slightly to ensure DOM is ready
    const createTimeout = setTimeout(() => {
      const initialViewBounds = calculateInitialBounds();
      // Prioritize non-empty URLs in a more sensible order for restored windows
      const urlToLoad = 
        (classicPayload.currentUrl && classicPayload.currentUrl !== '' ? classicPayload.currentUrl : null) ||
        (classicPayload.requestedUrl && classicPayload.requestedUrl !== '' ? classicPayload.requestedUrl : null) ||
        (classicPayload.initialUrl && classicPayload.initialUrl !== '' ? classicPayload.initialUrl : null) ||
        'about:blank';

      console.log(`[ClassicBrowser ${windowId}] Payload:`, classicPayload);
      console.log(`[ClassicBrowser ${windowId}] Calling classicBrowserCreate with bounds:`, initialViewBounds, "initialUrl:", urlToLoad);
      if (window.api && typeof window.api.classicBrowserCreate === 'function') {
        window.api.classicBrowserCreate(windowId, initialViewBounds, urlToLoad)
          .then((result: { success: boolean } | undefined) => {
            if (result && result.success) {
              console.log(`[ClassicBrowser ${windowId}] classicBrowserCreate successful.`);
            } else {
              console.error(`[ClassicBrowser ${windowId}] classicBrowserCreate failed or returned unexpected result.`, result);
              updateWindowProps(windowId, { payload: { ...classicPayload, error: "Browser view creation failed." } });
            }
          })
          .catch((err: Error) => {
            console.error(`[ClassicBrowser ${windowId}] Error calling classicBrowserCreate:`, err);
            updateWindowProps(windowId, { payload: { ...classicPayload, error: `Failed to create browser view: ${err.message}` } });
          });
      } else {
        console.warn(`[ClassicBrowser ${windowId}] window.api.classicBrowserCreate is not available.`);
        updateWindowProps(windowId, { payload: { ...classicPayload, error: 'Browser API for creation not available.' } });
      }
    }, 50); // Small delay to ensure DOM is ready

    return () => {
      clearTimeout(createTimeout);
      
      // Always attempt to destroy the BrowserView on unmount.
      // The main process service should handle if the view is already gone or in an error state.
      console.log(`[ClassicBrowser ${windowId}] Creation effect cleanup running. Calling classicBrowserDestroy.`, {
        windowId,
        timestamp: new Date().toISOString()
      });
      if (window.api && typeof window.api.classicBrowserDestroy === 'function') {
        window.api.classicBrowserDestroy(windowId)
          .catch((err: Error) => console.error(`[ClassicBrowser ${windowId}] Error calling classicBrowserDestroy on unmount:`, err));
      } else {
        console.warn(`[ClassicBrowser ${windowId}] window.api.classicBrowserDestroy is not available.`);
      }
      
      if (unsubscribeFromState) {
        unsubscribeFromState();
      }
      
      if (boundsRAF.current) { // also clean up RAF if unmounting
        cancelAnimationFrame(boundsRAF.current);
        boundsRAF.current = 0;
      }
    };
  }, [windowId, activeStore]); // Dependencies for creation/destruction - removed classicPayload.initialUrl to prevent re-creation

  // Effect for UPDATING BrowserView BOUNDS when contentGeometry changes or sidebar state changes
  useEffect(() => {
    const calculateAndSetBounds = () => {
      // During dragging or resizing, calculate bounds based on content div position
      if ((isDragging || isResizing) && contentRef.current) {
        // Use getBoundingClientRect but cache the dimensions from contentGeometry
        // This gives us the correct viewport-relative position while avoiding layout thrashing
        const rect = contentRef.current.getBoundingClientRect();
        const viewBounds = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(contentGeometry.contentWidth),
          height: Math.round(contentGeometry.contentHeight),
        };

        if (window.api && typeof window.api.classicBrowserSetBounds === 'function') {
          window.api.classicBrowserSetBounds(windowId, viewBounds);
        }
        return;
      }
      
      // When not dragging, use getBoundingClientRect for accuracy
      if (contentRef.current) {
        const rect = contentRef.current.getBoundingClientRect();
        const viewBounds = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };

        if (window.api && typeof window.api.classicBrowserSetBounds === 'function') {
          window.api.classicBrowserSetBounds(windowId, viewBounds);
        }
      }
    };

    if (!isActuallyVisible) {
      if (boundsRAF.current) {
        cancelAnimationFrame(boundsRAF.current);
        boundsRAF.current = 0;
      }
      return;
    }

    // During dragging or resizing, update immediately without RAF for smoother movement
    if (isDragging || isResizing) {
      calculateAndSetBounds();
      return;
    }

    // When not dragging, use RAF for performance
    if (boundsRAF.current) {
      cancelAnimationFrame(boundsRAF.current);
    }
    boundsRAF.current = requestAnimationFrame(() => {
      boundsRAF.current = 0;
      calculateAndSetBounds();
    });

    return () => {
       if (boundsRAF.current) {
        cancelAnimationFrame(boundsRAF.current);
        boundsRAF.current = 0;
      }
    }
  }, [windowId, contentGeometry.contentX, contentGeometry.contentY, contentGeometry.contentWidth, contentGeometry.contentHeight, isActuallyVisible, isDragging, isResizing]); // Use individual geometry values to prevent unnecessary updates

  // Separate effect for sidebar state changes with delay
  useEffect(() => {
    if (!isActuallyVisible || !contentRef.current) return;
    
    // Wait for sidebar transition to complete (200ms based on sidebar.tsx transition duration)
    const timer = setTimeout(() => {
      if (contentRef.current) {
        const rect = contentRef.current.getBoundingClientRect();
        const viewBounds = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };

        if (window.api && typeof window.api.classicBrowserSetBounds === 'function') {
          window.api.classicBrowserSetBounds(windowId, viewBounds);
        }
      }
    }, 250); // Slightly longer than transition duration to ensure completion

    return () => clearTimeout(timer);
  }, [sidebarState, windowId, isActuallyVisible]);

  // Effect to subscribe to state updates from the main process
  useEffect(() => {
    if (window.api && typeof window.api.onClassicBrowserState === 'function') {
      const unsubscribe = window.api.onClassicBrowserState((update: { windowId: string; state: Partial<ClassicBrowserPayload> }) => {
        if (update.windowId === windowId) {
          console.log(`[ClassicBrowser ${windowId}] Received state update from main:`, update.state);
          const { updateWindowProps, windows } = activeStore.getState();
          const currentWindow = windows.find(w => w.id === windowId);
          if (currentWindow) {
            const existingPayload = currentWindow.payload as ClassicBrowserPayload;
            const newPayload: ClassicBrowserPayload = {
              ...existingPayload,
              ...update.state,
            };

            // Update windowMeta.title if it has changed from the incoming state update
            let newWindowTitle = currentWindow.title; // Keep current title by default
            if (update.state.title && update.state.title !== currentWindow.title) {
              newWindowTitle = update.state.title;
            }

            updateWindowProps(windowId, { title: newWindowTitle, payload: newPayload });

            // Update address bar if URL changed and not currently loading a different requested URL
            if (update.state.currentUrl && (!update.state.isLoading || update.state.currentUrl !== (existingPayload.requestedUrl || ''))) {
              if (update.state.currentUrl !== addressBarUrl) setAddressBarUrl(update.state.currentUrl);
            } else if (update.state.requestedUrl && update.state.isLoading) {
              if (update.state.requestedUrl !== addressBarUrl) setAddressBarUrl(update.state.requestedUrl);
            }
          }
        }
      });

      return () => {
        console.log(`[ClassicBrowser ${windowId}] Unsubscribing from onClassicBrowserState.`);
        unsubscribe();
      };
    } else {
      console.warn(`[ClassicBrowser ${windowId}] window.api.onClassicBrowserState is not available.`);
    }
  }, [windowId, activeStore, addressBarUrl]); // addressBarUrl in deps to re-evaluate if needed

  const handleLoadUrl = useCallback(() => {
    let urlToLoad = addressBarUrl.trim();
    if (!urlToLoad) return;
    
    // Check if it's a URL-like string (contains dots or starts with protocol)
    const isUrl = urlToLoad.includes('.') || 
                  urlToLoad.startsWith('http://') || 
                  urlToLoad.startsWith('https://') ||
                  urlToLoad.startsWith('file://') ||
                  urlToLoad.startsWith('about:');
    
    if (!isUrl) {
      // It's a search query - use Perplexity
      const encodedQuery = encodeURIComponent(urlToLoad);
      urlToLoad = `https://www.perplexity.ai/search?q=${encodedQuery}`;
    } else if (!urlToLoad.startsWith('http://') && !urlToLoad.startsWith('https://')) {
      // It's a URL without protocol
      urlToLoad = 'https://' + urlToLoad;
    }
    
    setAddressBarUrl(urlToLoad); // Update UI immediately
    
    console.log(`[ClassicBrowser ${windowId}] Requesting load URL:`, urlToLoad);
    if (window.api && typeof window.api.classicBrowserLoadUrl === 'function') {
      const { updateWindowProps } = activeStore.getState();
      // Optimistically update payload for loading state
      updateWindowProps(windowId, { payload: { ...classicPayload, isLoading: true, requestedUrl: urlToLoad, error: null } });

      window.api.classicBrowserLoadUrl(windowId, urlToLoad)
        .catch((err: Error) => {
          console.error(`[ClassicBrowser ${windowId}] Error calling classicBrowserLoadUrl for URL load:`, err);
          updateWindowProps(windowId, { payload: { ...classicPayload, isLoading: false, error: err.message || 'Failed to load URL' } });
        });
    } else {
      console.warn('[ClassicBrowser] window.api.classicBrowserLoadUrl is not available.');
      const { updateWindowProps } = activeStore.getState();
      updateWindowProps(windowId, { payload: { ...classicPayload, error: 'Browser API not available for URL loading.' } });
    }
  }, [addressBarUrl, windowId, activeStore, classicPayload]);

  const handleNavigate = useCallback((action: 'back' | 'forward' | 'reload' | 'stop') => {
    console.log(`[ClassicBrowser ${windowId}] Requesting navigation:`, action);
    if (window.api && typeof window.api.classicBrowserNavigate === 'function') {
      const { updateWindowProps } = activeStore.getState();
      // Optimistic update for 'reload' and 'stop'
      if (action === 'reload') {
        updateWindowProps(windowId, { payload: { ...classicPayload, isLoading: true, error: null } });
      } else if (action === 'stop') {
         updateWindowProps(windowId, { payload: { ...classicPayload, isLoading: false } });
      }

      window.api.classicBrowserNavigate(windowId, action)
        .catch((err: Error) => {
          console.error(`[ClassicBrowser ${windowId}] Error calling classicBrowserNavigate for ${action}:`, err);
          updateWindowProps(windowId, { payload: { ...classicPayload, isLoading: false, error: err.message || `Failed to ${action}` } });
        });
    } else {
      console.warn('[ClassicBrowser] window.api.classicBrowserNavigate is not available.');
      const { updateWindowProps } = activeStore.getState();
      updateWindowProps(windowId, { payload: { ...classicPayload, error: 'Browser API not available.' } });
    }
  }, [windowId, activeStore, classicPayload]);

  // Conditional rendering for error state or placeholder before view is ready
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 bg-destructive/10 text-destructive-foreground">
        <XCircle className="w-12 h-12 mb-2" />
        <p className="text-lg font-semibold">Error</p>
        <p className="text-sm text-center">{error}</p>
        <Button onClick={handleLoadUrl} variant="outline" className="mt-4">
          Retry: {requestedUrl || currentUrl || 'page'}
        </Button>
      </div>
    );
  }

  // Main content div that will host the BrowserView
  // This div's bounds are used to position the BrowserView via classicBrowserSetBounds
  return (
    <div 
      ref={contentRef} 
      className={`relative flex-1 w-full h-full focus:outline-none overflow-hidden ${
        windowMeta.isFocused ? 'bg-step-4' : 'bg-step-3'
      }`}
      // The actual BrowserView will be positioned over this div by Electron.
      // We can add a placeholder or loading indicator here if desired.
      // For now, it will be blank until the BrowserView is created and loaded.
      style={{
        // If isActuallyVisible is false, we might want to hide this or show a placeholder
        // visibility: isActuallyVisible ? 'visible' : 'hidden',
        // backgroundColor: 'transparent' // Or a specific color if needed
      }}
    >
      {/* Snapshot overlay when frozen */}
      {isFrozen && snapshotDataUrl && (
        <div 
          className="absolute inset-0 z-20 transition-opacity duration-200 ease-in-out"
          style={{ 
            opacity: 1,
            pointerEvents: 'none' // Prevent interaction with the snapshot
          }}
        >
          <img 
            src={snapshotDataUrl} 
            alt="Browser snapshot"
            className="w-full h-full object-cover"
            style={{
              imageRendering: 'crisp-edges', // Ensure sharp rendering
              backgroundColor: windowMeta.isFocused ? '#1a1a1a' : '#161616' // Match bg-step-4/3
            }}
          />
        </div>
      )}
      
      {/* Live view container - hidden when frozen */}
      <div 
        className={`absolute inset-0 transition-opacity duration-200 ease-in-out`}
        style={{ 
          opacity: isFrozen ? 0 : 1,
          pointerEvents: isFrozen ? 'none' : 'auto'
        }}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <p className="text-sm text-step-12/80">Loading {requestedUrl || currentUrl}...</p>
          </div>
        )}
        {!isLoading && !currentUrl && !requestedUrl && (
           <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
            <Globe className="w-16 h-16 mb-4 text-step-12/30" />
            <p className="text-lg text-step-12/60">New Tab</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ClassicBrowserViewWrapper; 