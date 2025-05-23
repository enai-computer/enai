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

const DEBUG = process.env.NODE_ENV !== 'production';

interface ClassicBrowserContentProps {
  windowMeta: WindowMeta; // Changed from 'payload' to 'windowMeta' for full context
  activeStore: StoreApi<WindowStoreState>;
  contentGeometry: WindowContentGeometry; // Add the new prop
  isActuallyVisible: boolean; // Add prop for visibility state
  // titleBarHeight: number; // If passed from WindowFrame
}

export const ClassicBrowserViewWrapper: React.FC<ClassicBrowserContentProps> = ({ // Renamed component for clarity if needed, sticking to existing for now
  windowMeta,
  activeStore,
  contentGeometry,
  isActuallyVisible,
}) => {
  const { id: windowId, payload } = windowMeta;
  // Ensure payload is of type ClassicBrowserPayload
  const classicPayload = payload as ClassicBrowserPayload;

  const [addressBarUrl, setAddressBarUrl] = useState<string>(classicPayload.requestedUrl || classicPayload.currentUrl || 'https://');
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
    const { updateWindowProps } = activeStore.getState();
    
    // Calculate bounds purely from contentGeometry to avoid layout thrashing
    const calculateInitialBounds = () => {
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
      const urlToLoad = classicPayload.currentUrl || classicPayload.requestedUrl || classicPayload.initialUrl || 'about:blank';

      if (DEBUG) {
        console.log(`[ClassicBrowser ${windowId}] Calling classicBrowserCreate with bounds:`, initialViewBounds, "initialUrl:", urlToLoad);
      }
      if (window.api && typeof window.api.classicBrowserCreate === 'function') {
        window.api.classicBrowserCreate(windowId, initialViewBounds, urlToLoad)
          .then((result: { success: boolean } | undefined) => {
            if (result && result.success) {
              if (DEBUG) {
                console.log(`[ClassicBrowser ${windowId}] classicBrowserCreate successful.`);
              }
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
      if (DEBUG) {
        console.log(`[ClassicBrowser ${windowId}] Unmounting. Calling classicBrowserDestroy.`);
      }
      if (window.api && typeof window.api.classicBrowserDestroy === 'function') {
        window.api.classicBrowserDestroy(windowId)
          .catch((err: Error) => console.error(`[ClassicBrowser ${windowId}] Error calling classicBrowserDestroy on unmount:`, err));
      }
      if (boundsRAF.current) { // also clean up RAF if unmounting
        cancelAnimationFrame(boundsRAF.current);
        boundsRAF.current = 0;
      }
    };
  }, [windowId, activeStore, classicPayload.initialUrl]); // Dependencies for creation/destruction.

  // Effect for UPDATING BrowserView BOUNDS when contentGeometry changes or sidebar state changes
  useEffect(() => {
    const calculateAndSetBounds = () => {
      const { contentX, contentY, contentWidth, contentHeight } = contentGeometry;
      const viewBounds = {
        x: Math.round(contentX),
        y: Math.round(contentY + BROWSER_VIEW_TOOLBAR_HEIGHT),
        width: Math.round(contentWidth - BROWSER_VIEW_RESIZE_PADDING * 2),
        height: Math.round(contentHeight - BROWSER_VIEW_TOOLBAR_HEIGHT - BROWSER_VIEW_RESIZE_PADDING),
      };

      if (DEBUG) {
        console.log(`[ClassicBrowser ${windowId}] Syncing bounds via RAF:`, viewBounds, "Visible:", isActuallyVisible);
      }

      if (window.api && typeof window.api.classicBrowserSetBounds === 'function') {
        window.api.classicBrowserSetBounds(windowId, viewBounds);
      }
    };

    if (!isActuallyVisible) {
      if (DEBUG) {
        console.log(`[ClassicBrowser ${windowId}] View is not visible, skipping bounds update.`);
      }
      // If there's a pending RAF, we might want to cancel it if becoming invisible.
      if (boundsRAF.current) {
        cancelAnimationFrame(boundsRAF.current);
        boundsRAF.current = 0;
      }
      return; // Skip bounds update if not visible
    }

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
  }, [windowId, contentGeometry, isActuallyVisible]); // Added isActuallyVisible to dependencies

  // Effect to subscribe to state updates from the main process
  useEffect(() => {
    if (window.api && typeof window.api.onClassicBrowserState === 'function') {
      const unsubscribe = window.api.onClassicBrowserState((update: { windowId: string; state: Partial<ClassicBrowserPayload> }) => {
        if (update.windowId === windowId) {
          if (DEBUG) {
            console.log(`[ClassicBrowser ${windowId}] Received state update from main:`, update.state);
          }
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
        if (DEBUG) {
          console.log(`[ClassicBrowser ${windowId}] Unsubscribing from onClassicBrowserState.`);
        }
        unsubscribe();
      };
    } else {
      console.warn(`[ClassicBrowser ${windowId}] window.api.onClassicBrowserState is not available.`);
    }
  }, [windowId, activeStore, addressBarUrl]); // addressBarUrl in deps to re-evaluate if needed

  const handleLoadUrl = useCallback(() => {
    let urlToLoad = addressBarUrl.trim();
    if (!urlToLoad) return;
    if (!urlToLoad.startsWith('http://') && !urlToLoad.startsWith('https://')) {
      urlToLoad = 'https://' + urlToLoad;
    }
    setAddressBarUrl(urlToLoad); // Update UI immediately
    
    if (DEBUG) {
      console.log(`[ClassicBrowser ${windowId}] Requesting load URL:`, urlToLoad);
    }
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
    if (DEBUG) {
      console.log(`[ClassicBrowser ${windowId}] Requesting navigation:`, action);
    }
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

  return (
    <div className="flex flex-col h-full bg-step-1">
      {/* Content Area (Placeholder & Error/Loading Display) */}
      <div ref={contentRef} className="flex-grow flex items-center justify-center bg-step-2/10 relative overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-step-1/80 z-10 p-4 text-center">
            <RotateCw className="h-6 w-6 animate-spin text-step-11 mb-2" />
            <p className="text-xs text-step-10 truncate">Loading: {requestedUrl || currentUrl}</p>
          </div>
        )}
        {error && !isLoading && ( // Only show error if not currently loading something else
           <div className="absolute inset-0 flex flex-col items-center justify-center bg-destructive/10 text-destructive-foreground p-4 z-20 text-center">
            <XCircle className="h-6 w-6 mb-2" />
            <p className="text-sm font-medium">Error</p>
            <p className="text-xs ">{error}</p>
            <p className="text-xs  mt-1 truncate">URL: {requestedUrl || currentUrl}</p>
          </div>
        )}
        {!isLoading && !error && !currentUrl && (
           <div className="absolute inset-0 flex flex-col items-center justify-center text-step-10 p-4 z-0">
             <Globe className="h-10 w-10 mb-2" />
             <p className="text-sm">Enter a URL to start browsing</p>
           </div>
        )}
         {/* The actual BrowserView is rendered by Electron underneath this div. */}
         {/* This div acts as a placeholder for the UI elements and overlays. */}
         {/* It needs to fill the space so the BrowserView is correctly positioned by the main process. */}
      </div>
    </div>
  );
};

export default ClassicBrowserViewWrapper; 