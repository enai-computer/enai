"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { StoreApi } from 'zustand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Globe, XCircle } from 'lucide-react';
import type { ClassicBrowserPayload, WindowMeta, ClassicBrowserStateUpdate, TabState } from '../../../../shared/types';
import type { WindowStoreState } from '../../../store/windowStoreFactory';
import type { WindowContentGeometry } from '../../ui/WindowFrame';
import { cn } from '@/lib/utils';
import { WindowControls } from '../../ui/WindowControls';

// Constants from WindowFrame for consistency
const DRAG_HANDLE_CLASS = 'window-drag-handle';
const BORDER_WIDTH = 4; // The visible border of the inner window

// Browser-specific constants
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
  
  // Track mounting/unmounting and sync state on mount
  useEffect(() => {
    console.log(`[ClassicBrowserViewWrapper ${windowId}] Component mounted`, {
      windowId,
      timestamp: new Date().toISOString()
    });
    
    // Sync state on mount if browser view already exists
    if (window.api && typeof window.api.classicBrowserGetState === 'function') {
      window.api.classicBrowserGetState(windowId).then((state) => {
        if (state) {
          console.log(`[ClassicBrowser ${windowId}] Synced state on mount:`, state);
          const { updateWindowProps } = activeStore.getState();
          updateWindowProps(windowId, { payload: state });
          
          // Update address bar with the active tab's URL
          const syncedActiveTab = state.tabs?.find(t => t.id === state.activeTabId);
          if (syncedActiveTab?.url) {
            setAddressBarUrl(syncedActiveTab.url);
          }
        }
      }).catch((err) => {
        console.error(`[ClassicBrowser ${windowId}] Failed to sync state on mount:`, err);
      });
    }
    
    return () => {
      console.log(`[ClassicBrowserViewWrapper ${windowId}] Component unmounting`, {
        windowId,
        timestamp: new Date().toISOString()
      });
    };
  }, [windowId, activeStore]);

  // Get the active tab from the payload
  const activeTab = classicPayload.tabs?.find(t => t.id === classicPayload.activeTabId) || null;
  
  // Ensure we have a valid tab structure
  if (!classicPayload.tabs || classicPayload.tabs.length === 0 || !activeTab) {
    console.warn(`[ClassicBrowser ${windowId}] No valid tab structure found`);
  }
  
  // Initialize address bar with the active tab's URL or fallback values
  const [addressBarUrl, setAddressBarUrl] = useState<string>(
    activeTab?.url || classicPayload.initialUrl || 'https://'
  );
  const webContentsViewRef = useRef<HTMLDivElement>(null); // Renamed for clarity - this is the placeholder for the native view
  const boundsRAF = React.useRef<number>(0); // For throttling setBounds during rapid geometry changes
  const destroyTimerRef = useRef<NodeJS.Timeout | null>(null); // For handling StrictMode gracefully
  
  // Header-specific state
  const [inputWidthClass, setInputWidthClass] = useState('flex-1');
  const headerRef = useRef<HTMLDivElement>(null);
  const [isInputHovered, setIsInputHovered] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Derived state from the active tab for UI binding
  const {
    url: currentUrl = '',
    isLoading = false,
    canGoBack = false,
    canGoForward = false,
    error = null,
    title: pageTitle = '', // Page title from the active tab
    faviconUrl = null,
  } = activeTab || {};

  // Effect for CREATING and DESTROYING the BrowserView instance
  useEffect(() => {
    console.log(`[ClassicBrowserViewWrapper ${windowId}] Creation effect running`, {
      windowId,
      initialUrl: classicPayload.initialUrl,
      timestamp: new Date().toISOString()
    });
    
    // Cancel any pending destruction from a previous unmount (StrictMode)
    if (destroyTimerRef.current) {
      console.log(`[ClassicBrowser ${windowId}] Cancelling pending destruction timer`);
      clearTimeout(destroyTimerRef.current);
      destroyTimerRef.current = null;
    }
    
    const { updateWindowProps } = activeStore.getState();
    let unsubscribeFromState: (() => void) | undefined;
    
    // Listen for navigation state to prevent destruction during navigation
    if (window.api && typeof window.api.onClassicBrowserState === 'function') {
      unsubscribeFromState = window.api.onClassicBrowserState((update: ClassicBrowserStateUpdate) => {
        if (update.windowId === windowId) {
          // Track navigation state if needed
        }
      });
    }
    
    // Use getBoundingClientRect to get actual screen coordinates
    const calculateInitialBounds = () => {
      if (webContentsViewRef.current) {
        const rect = webContentsViewRef.current.getBoundingClientRect();
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

    // Create browser view immediately - backend handles idempotency
    const initialViewBounds = calculateInitialBounds();
    // Prioritize non-empty URLs in a more sensible order for restored windows
    const urlToLoad = 
      (activeTab?.url && activeTab.url !== '' ? activeTab.url : null) ||
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

    return () => {
      // Schedule destruction with a delay to handle React StrictMode gracefully
      console.log(`[ClassicBrowser ${windowId}] Creation effect cleanup running. Scheduling destroy with delay.`, {
        windowId,
        timestamp: new Date().toISOString()
      });
      
      // Clear any existing timer before setting a new one
      if (destroyTimerRef.current) {
        clearTimeout(destroyTimerRef.current);
      }
      
      // Schedule destruction after a short delay
      destroyTimerRef.current = setTimeout(() => {
        console.log(`[ClassicBrowser ${windowId}] Executing delayed destruction.`);
        if (window.api && typeof window.api.classicBrowserDestroy === 'function') {
          window.api.classicBrowserDestroy(windowId)
            .catch((err: Error) => console.error(`[ClassicBrowser ${windowId}] Error calling classicBrowserDestroy:`, err));
        } else {
          console.warn(`[ClassicBrowser ${windowId}] window.api.classicBrowserDestroy is not available.`);
        }
        destroyTimerRef.current = null;
      }, 50); // 50ms delay to allow for StrictMode remounting
      
      if (unsubscribeFromState) {
        unsubscribeFromState();
      }
      
      if (boundsRAF.current) { // also clean up RAF if unmounting
        cancelAnimationFrame(boundsRAF.current);
        boundsRAF.current = 0;
      }
    };
  }, [windowId, activeStore]); // Dependencies for creation/destruction - removed classicPayload.initialUrl to prevent re-creation

  // Cleanup effect to ensure timer is cleared on final unmount
  useEffect(() => {
    return () => {
      // This runs only on final unmount when component is removed from tree
      if (destroyTimerRef.current) {
        clearTimeout(destroyTimerRef.current);
        destroyTimerRef.current = null;
      }
    };
  }, []); // Empty deps means this only runs on final unmount

  // Effect for UPDATING BrowserView BOUNDS when contentGeometry changes or sidebar state changes
  useEffect(() => {
    const calculateAndSetBounds = () => {
      // During dragging or resizing, calculate bounds based on content div position
      if ((isDragging || isResizing) && webContentsViewRef.current) {
        // Use getBoundingClientRect for position and height, but use contentGeometry for width to avoid layout thrashing
        const rect = webContentsViewRef.current.getBoundingClientRect();
        const viewBounds = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(contentGeometry.contentWidth), // Keep original logic for width
          height: Math.round(rect.height), // Use measured height, which is correct
        };

        if (window.api && typeof window.api.classicBrowserSetBounds === 'function') {
          window.api.classicBrowserSetBounds(windowId, viewBounds);
        }
        return;
      }
      
      // When not dragging, use getBoundingClientRect for accuracy
      if (webContentsViewRef.current) {
        const rect = webContentsViewRef.current.getBoundingClientRect();
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
    if (!isActuallyVisible || !webContentsViewRef.current) return;
    
    // Wait for sidebar transition to complete (200ms based on sidebar.tsx transition duration)
    const timer = setTimeout(() => {
      if (webContentsViewRef.current) {
        const rect = webContentsViewRef.current.getBoundingClientRect();
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
  
  // Effect to sync addressBarUrl with payload changes from main process (from header)
  // This should happen when the input is NOT focused, to avoid overriding user typing.
  useEffect(() => {
    if (!isInputFocused) {
      const newUrlToShow = currentUrl; // In tab-centric model, url is always the current/requested URL
      if (newUrlToShow && newUrlToShow !== addressBarUrl) {
        setAddressBarUrl(newUrlToShow);
      } else if (!newUrlToShow && classicPayload.initialUrl && classicPayload.initialUrl !== addressBarUrl) {
        // Fallback to initialUrl if current/requested are empty (e.g. new tab)
        setAddressBarUrl(classicPayload.initialUrl);
      }
    }
  }, [currentUrl, isLoading, classicPayload.initialUrl, isInputFocused, addressBarUrl]);

  // Effect to observe parent width and set input class (from header)
  useEffect(() => {
    const parentElement = headerRef.current;
    if (!parentElement) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const parentWidth = entry.contentRect.width;
        // Approx. width of buttons (3 * 28px = 84px) + gaps (3 * 4px = 12px) = 96px
        const nonInputWidth = 96; 
        const fixedInputWidth = 350;

        if (parentWidth > fixedInputWidth + nonInputWidth) {
          setInputWidthClass('w-[350px]');
        } else {
          setInputWidthClass('flex-1');
        }
      }
    });

    resizeObserver.observe(parentElement);

    return () => {
      resizeObserver.unobserve(parentElement);
    };
  }, []); // Empty dependency array, runs once on mount and cleans up

  // Effect to subscribe to state updates from the main process
  useEffect(() => {
    if (window.api && typeof window.api.onClassicBrowserState === 'function') {
      const unsubscribe = window.api.onClassicBrowserState((update: ClassicBrowserStateUpdate) => {
        if (update.windowId === windowId) {
          console.log(`[ClassicBrowser ${windowId}] Received state update from main:`, update.update);
          const { updateWindowProps, windows } = activeStore.getState();
          const currentWindow = windows.find(w => w.id === windowId);
          if (currentWindow) {
            const existingPayload = currentWindow.payload as ClassicBrowserPayload;
            
            // Start with a copy of the existing payload
            let newPayload: ClassicBrowserPayload = { ...existingPayload };

            // Apply granular updates
            if (update.update.activeTabId !== undefined) {
              newPayload.activeTabId = update.update.activeTabId;
            }

            if (update.update.tab) {
              // Find the tab to update
              const tabIndex = newPayload.tabs.findIndex(t => t.id === update.update.tab!.id);
              if (tabIndex !== -1) {
                // Update the existing tab
                newPayload.tabs[tabIndex] = {
                  ...newPayload.tabs[tabIndex],
                  ...update.update.tab
                };
              } else {
                // This shouldn't happen in normal operation, but handle it gracefully
                console.warn(`[ClassicBrowser ${windowId}] Received update for unknown tab ${update.update.tab.id}`);
              }
            }

            // Get the active tab for UI updates
            const activeTab = newPayload.tabs.find(t => t.id === newPayload.activeTabId);
            
            // Update window title if the active tab's title changed
            let newWindowTitle = currentWindow.title;
            if (activeTab?.title && activeTab.title !== currentWindow.title) {
              newWindowTitle = activeTab.title;
            }

            updateWindowProps(windowId, { title: newWindowTitle, payload: newPayload });

            // Update address bar based on active tab's URL
            if (activeTab) {
              if (activeTab.url && (!activeTab.isLoading || activeTab.url !== addressBarUrl)) {
                if (activeTab.url !== addressBarUrl) setAddressBarUrl(activeTab.url);
              }
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
      // No need for optimistic updates - backend will send state updates
      window.api.classicBrowserLoadUrl(windowId, urlToLoad)
        .catch((err: Error) => {
          console.error(`[ClassicBrowser ${windowId}] Error calling classicBrowserLoadUrl for URL load:`, err);
          // Error will be handled by backend state updates
        });
    } else {
      console.warn('[ClassicBrowser] window.api.classicBrowserLoadUrl is not available.');
    }
  }, [addressBarUrl, windowId]);

  // Handle mouse down to focus the window
  const handleVisualWindowMouseDown = useCallback(() => {
    activeStore.getState().setWindowFocus(windowId);
    if (window.api && typeof window.api.classicBrowserRequestFocus === 'function') {
      console.log(`[ClassicBrowser ${windowId}] Requesting focus from main process.`);
      window.api.classicBrowserRequestFocus(windowId);
    }
  }, [windowId, activeStore]);

  const handleNavigate = useCallback((action: 'back' | 'forward' | 'reload' | 'stop') => {
    console.log(`[ClassicBrowser ${windowId}] Requesting navigation:`, action);
    if (window.api && typeof window.api.classicBrowserNavigate === 'function') {
      // No need for optimistic updates - backend will send state updates
      window.api.classicBrowserNavigate(windowId, action)
        .catch((err: Error) => {
          console.error(`[ClassicBrowser ${windowId}] Error calling classicBrowserNavigate for ${action}:`, err);
          // Error will be handled by backend state updates
        });
    } else {
      console.warn('[ClassicBrowser] window.api.classicBrowserNavigate is not available.');
    }
  }, [windowId]);

  // Conditional rendering for error state or placeholder before view is ready
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 bg-destructive/10 text-destructive-foreground">
        <XCircle className="w-12 h-12 mb-2" />
        <p className="text-lg font-semibold">Error</p>
        <p className="text-sm text-center">{error}</p>
        <Button onClick={handleLoadUrl} variant="outline" className="mt-4">
          Retry: {currentUrl || 'page'}
        </Button>
      </div>
    );
  }

  // Main component structure with header and content area
  return (
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
      onMouseDown={handleVisualWindowMouseDown}
    >
      {/* Browser header with navigation controls and window controls */}
      <div 
        ref={headerRef}
        className={cn(
          DRAG_HANDLE_CLASS,
          "flex items-center gap-1 h-10 px-1 select-none border-b",
          windowMeta.isFocused ? 'bg-step-4' : 'bg-step-3'
        )}
        style={{ borderColor: 'inherit' }}
      >
        <Button variant="ghost" size="icon" onClick={() => handleNavigate('back')} disabled={!canGoBack || isLoading} className={cn("h-7 w-7", "no-drag")}>
          <svg width="24" height="24" viewBox="3 3 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16.9062 18.3273L18 17.2477L13.4972 12.7449V11.1824L18 6.69376L16.9062 5.60001L10.5426 11.9636L16.9062 18.3273Z" fill="currentColor"/>
          </svg>
        </Button>
        <Button variant="ghost" size="icon" onClick={() => handleNavigate('forward')} disabled={!canGoForward || isLoading} className={cn("h-7 w-7", "no-drag")}>
          <svg width="24" height="24" viewBox="3 3 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.09375 18.7273L6 17.6477L10.5028 13.1449V11.5824L6 7.09375L7.09375 6L13.4574 12.3636L7.09375 18.7273Z" fill="currentColor"/>
          </svg>
        </Button>
        <div className={cn("relative flex items-center", inputWidthClass)}>
          {/* Favicon display */}
          {faviconUrl ? (
            <img 
              src={faviconUrl} 
              alt="Site favicon" 
              className="absolute left-2 w-4 h-4 z-10 pointer-events-none"
              onError={(e) => {
                // If favicon fails to load, hide it
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <Globe className="absolute left-2 w-4 h-4 z-10 pointer-events-none text-step-12/50" />
          )}
          
          <Input
            value={isInputHovered || isInputFocused ? addressBarUrl : (pageTitle || addressBarUrl)}
            onChange={e => {
              setAddressBarUrl(e.target.value);
              // If user starts typing, ensure input stays active for URL display
              if (!isInputFocused) setIsInputFocused(true); 
              if (!isInputHovered) setIsInputHovered(true);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleLoadUrl();
                // Optional: Blur input after enter to show title again if not hovered
                // e.currentTarget.blur(); 
              }
            }}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => {
              setIsInputFocused(false);
              // If not hovering when blurred, revert to title display
              if (!isInputHovered) setAddressBarUrl(currentUrl || 'https://');
            }}
            onMouseEnter={() => setIsInputHovered(true)}
            onMouseLeave={() => setIsInputHovered(false)}
            onMouseDownCapture={e => {
              e.stopPropagation();
            }}
            placeholder={isInputHovered || isInputFocused ? "Enter URL and press Enter" : (pageTitle || "Enter URL and press Enter")}
            className={cn(
              "h-7 rounded-sm text-sm pl-8 pr-2 bg-step-1/80 focus:bg-step-1 w-full",
              // Conditionally apply border styles
              (isInputHovered || isInputFocused) ? 
                "border border-step-6 focus-visible:border-step-8 focus-visible:ring-step-8/50 focus-visible:ring-[3px]" : 
                "border-none shadow-none"
            )}
            title={addressBarUrl} // Tooltip always shows the actual URL
          />
        </div>
        <div className="no-drag ml-auto">
          <WindowControls id={windowId} activeStore={activeStore} isFocused={windowMeta.isFocused} />
        </div>
      </div>
      
      {/* Content area that will host the BrowserView */}
      <div 
        ref={webContentsViewRef} 
        className={`relative flex-1 w-full focus:outline-none overflow-hidden rounded-t-lg ${
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
          className="absolute inset-0 z-20 transition-opacity duration-200 ease-in-out rounded-t-lg overflow-hidden"
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
            <p className="text-sm text-step-12/80">Loading {currentUrl}...</p>
          </div>
        )}
        {!isLoading && !currentUrl && (
           <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
            <Globe className="w-16 h-16 mb-4 text-step-12/30" />
            <p className="text-lg text-step-12/60">New Tab</p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

export default ClassicBrowserViewWrapper; 