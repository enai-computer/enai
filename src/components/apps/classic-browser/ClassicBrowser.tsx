"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { StoreApi } from 'zustand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Globe, XCircle, Loader2 } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ClassicBrowserPayload, WindowMeta, ClassicBrowserStateUpdate } from '../../../../shared/types';
import type { WindowStoreState } from '../../../store/windowStoreFactory';
import type { WindowContentGeometry } from '../../ui/WindowFrame';
import { cn } from '@/lib/utils';
import { WindowControls } from '../../ui/WindowControls';
import { useNativeResource } from '@/hooks/use-native-resource';
import { useBrowserWindowController } from '@/hooks/useBrowserWindowController';
import { TabBar } from './TabBar';

// Constants from WindowFrame for consistency
const DRAG_HANDLE_CLASS = 'window-drag-handle';
const BORDER_WIDTH = 4; // The visible border of the inner window

// Browser-specific constants
const BROWSER_VIEW_TOOLBAR_HEIGHT = 38; // Internal toolbar height for ClassicBrowserViewWrapper
const TAB_BAR_HEIGHT = 32; // Height of the tab bar when visible
const BROWSER_VIEW_RESIZE_PADDING = 0; // If BrowserView needs to be smaller than contentArea, e.g. for its own visual reasons or to avoid RND handles. Set to 0 if not needed or RND handles are outside content area.

interface ClassicBrowserContentProps {
  windowMeta: WindowMeta; // Changed from 'payload' to 'windowMeta' for full context
  activeStore: StoreApi<WindowStoreState>;
  contentGeometry: WindowContentGeometry; // Add the new prop
  isActuallyVisible: boolean; // Add prop for visibility state
  isDragging?: boolean; // Add prop for dragging state
  isResizing?: boolean; // Add prop for resizing state
  // titleBarHeight: number; // If passed from WindowFrame
}

export const ClassicBrowserViewWrapper: React.FC<ClassicBrowserContentProps> = ({ // Renamed component for clarity if needed, sticking to existing for now
  windowMeta,
  activeStore,
  contentGeometry,
  isActuallyVisible,
  isDragging = false,
  isResizing = false,
}) => {
  const { id: windowId, payload } = windowMeta;
  // Ensure payload is of type ClassicBrowserPayload
  const classicPayload = payload as ClassicBrowserPayload;
  
  // Track bookmarking status for each tab individually to handle tab switching correctly
  const [bookmarkingTabs, setBookmarkingTabs] = useState<Record<string, boolean>>({});
  
  // Use the browser window controller hook
  const controller = useBrowserWindowController(windowId, activeStore);
  
  // Get freeze state from the payload
  const freezeState = classicPayload.freezeState || { type: 'ACTIVE' };
  const isFrozen = freezeState.type === 'FROZEN';
  const isCapturing = freezeState.type === 'CAPTURING';
  const isAwaitingRender = freezeState.type === 'AWAITING_RENDER';
  const snapshotUrl = ('snapshotUrl' in freezeState) ? freezeState.snapshotUrl : null;
  
  // Track whether loading UI should be visible (hide when frozen to show snapshot)
  const [showWebContentsView, setShowWebContentsView] = useState<boolean>(freezeState.type === 'ACTIVE');
  
  
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
    freezeState: freezeState.type,
    snapshotUrl: snapshotUrl ? 'present' : 'null',
    timestamp: new Date().toISOString()
  });
  
  // Track mounting/unmounting and sync state on mount
  useEffect(() => {
    console.log(`[ClassicBrowserViewWrapper ${windowId}] Component mounted`, {
      windowId,
      timestamp: new Date().toISOString()
    });
    
    // Backend will send initial state via onClassicBrowserState after creation
    // No need to sync state on mount - let the backend be the source of truth
    
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
  
  // Header-specific state
  const [inputWidthClass, setInputWidthClass] = useState('flex-1');
  const headerRef = useRef<HTMLDivElement>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  
  // Update address bar when active tab changes
  useEffect(() => {
    if (activeTab?.url && activeTab.url !== addressBarUrl && !isInputFocused) {
      setAddressBarUrl(activeTab.url);
    }
  }, [activeTab?.url, activeTab?.id, isInputFocused]); // activeTab.id ensures update on tab switch

  // Derived state from the active tab for UI binding
  const {
    url: currentUrl = '',
    isLoading = false,
    canGoBack = false,
    canGoForward = false,
    error = null,
    title: pageTitle = '', // Page title from the active tab
    faviconUrl = null,
    isBookmarked = false,
    bookmarkedAt = null,
    id: activeTabId = null,
  } = activeTab || {};
  
  // Check if the current tab is in the process of being bookmarked
  const isCurrentlyBookmarking = activeTabId ? !!bookmarkingTabs[activeTabId] : false;

  // Calculate initial bounds for browser view
  const calculateInitialBounds = useCallback(() => {
    const hasMultipleTabs = classicPayload.tabs && classicPayload.tabs.length > 1;
    const tabBarOffset = hasMultipleTabs ? TAB_BAR_HEIGHT : 0;
    
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
      y: Math.round(contentY + BROWSER_VIEW_TOOLBAR_HEIGHT + tabBarOffset),
      width: Math.round(contentWidth - BROWSER_VIEW_RESIZE_PADDING * 2),
      height: Math.round(contentHeight - BROWSER_VIEW_TOOLBAR_HEIGHT - tabBarOffset - BROWSER_VIEW_RESIZE_PADDING),
    };
  }, [contentGeometry, classicPayload.tabs.length]);

  // Create browser view callback
  const createBrowserView = useCallback(async () => {
    const { updateWindowProps } = activeStore.getState();
    
    // Get the current window and payload from store at call time
    const currentWindow = activeStore.getState().windows.find(w => w.id === windowId);
    if (!currentWindow) {
      console.error(`[ClassicBrowser ${windowId}] Window not found in store`);
      throw new Error(`Window ${windowId} not found in store`);
    }
    
    const currentPayload = currentWindow.payload as ClassicBrowserPayload;
    const initialViewBounds = calculateInitialBounds();
    
    console.log(`[ClassicBrowser ${windowId}] Calling classicBrowserCreate with payload:`, {
      tabs: currentPayload.tabs.length,
      activeTabId: currentPayload.activeTabId,
      initialUrl: currentPayload.initialUrl
    });
    
    if (!window.api?.classicBrowserCreate) {
      console.warn(`[ClassicBrowser ${windowId}] window.api.classicBrowserCreate is not available.`);
      updateWindowProps(windowId, { payload: { ...currentPayload, error: 'Browser API for creation not available.' } });
      throw new Error('Browser API not available');
    }

    try {
      // Pass the full, hydrated payload to the backend for the one-time seed
      const result = await window.api.classicBrowserCreate(windowId, initialViewBounds, currentPayload);
      if (result && result.success) {
        console.log(`[ClassicBrowser ${windowId}] classicBrowserCreate successful.`);
      } else {
        console.error(`[ClassicBrowser ${windowId}] classicBrowserCreate failed or returned unexpected result.`, result);
        updateWindowProps(windowId, { payload: { ...currentPayload, error: "Browser view creation failed." } });
        throw new Error('Browser view creation failed');
      }
    } catch (err) {
      console.error(`[ClassicBrowser ${windowId}] Error calling classicBrowserCreate:`, err);
      updateWindowProps(windowId, { payload: { ...currentPayload, error: `Failed to create browser view: ${err instanceof Error ? err.message : String(err)}` } });
      throw err;
    }
  }, [windowId, activeStore]); // Stable dependencies only

  // Destroy browser view callback
  const destroyBrowserView = useCallback(async () => {
    console.log(`[ClassicBrowser ${windowId}] Destroying browser view`);
    if (window.api?.classicBrowserDestroy) {
      await window.api.classicBrowserDestroy(windowId);
    } else {
      console.warn(`[ClassicBrowser ${windowId}] window.api.classicBrowserDestroy is not available.`);
    }
    
    // Clean up RAF if still pending
    if (boundsRAF.current) {
      cancelAnimationFrame(boundsRAF.current);
      boundsRAF.current = 0;
    }
  }, [windowId]);

  // Use the native resource lifecycle hook
  useNativeResource(
    createBrowserView,
    destroyBrowserView,
    [windowId, activeStore, createBrowserView],
    {
      unmountDelay: 50,
      debug: true,
      debugLabel: `ClassicBrowser[${windowId}]`
    }
  );

  // Separate effect for navigation state listener (doesn't affect lifecycle)
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    
    if (window.api?.onClassicBrowserState) {
      unsubscribe = window.api.onClassicBrowserState((update: ClassicBrowserStateUpdate) => {
        if (update.windowId === windowId) {
          const { updateWindowProps } = activeStore.getState();
          const window = activeStore.getState().windows.find(w => w.id === windowId);
          
          if (!window) {
            console.warn(`[ClassicBrowser ${windowId}] Window not found in store during state update`);
            return;
          }
          
          const currentPayload = window.payload as ClassicBrowserPayload;
          
          // Complete state replacement - always use tabs and activeTabId from update
          if (update.update.tabs && update.update.activeTabId) {
            console.log(`[ClassicBrowser ${windowId}] Replacing state with ${update.update.tabs.length} tabs, active: ${update.update.activeTabId}`);
            
            // Create the new payload - backend is source of truth
            const newPayload: ClassicBrowserPayload = {
              initialUrl: currentPayload?.initialUrl || update.update.tabs.find(t => t.id === update.update.activeTabId)?.url || 'about:blank',
              tabs: update.update.tabs,
              activeTabId: update.update.activeTabId,
              freezeState: currentPayload?.freezeState || { type: 'ACTIVE' } // Preserve existing freeze state or default to ACTIVE
            };
            
            updateWindowProps(windowId, {
              payload: newPayload,
              title: update.update.tabs.find(t => t.id === update.update.activeTabId)?.title || window.title
            });
            
            // Update address bar with the active tab's URL
            const newActiveTab = update.update.tabs.find(t => t.id === update.update.activeTabId);
            if (newActiveTab?.url) {
              setAddressBarUrl(newActiveTab.url);
            }
          }
        }
      });
    }
    
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [windowId, activeStore]);

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
  }, [windowId, contentGeometry.contentX, contentGeometry.contentY, contentGeometry.contentWidth, contentGeometry.contentHeight, isActuallyVisible, isDragging, isResizing, classicPayload.tabs.length]); // Use individual geometry values to prevent unnecessary updates


  // Effect to sync WebContentsView background color with window focus state
  useEffect(() => {
    const hexColor = windowMeta.isFocused ? '#2a2a28' : '#222221'; // step-4 : step-3
    
    // Send the color to the main process
    if (window.api?.classicBrowserSetBackgroundColor) {
      window.api.classicBrowserSetBackgroundColor(windowId, hexColor);
      console.log(`[ClassicBrowser ${windowId}] Set background color to ${hexColor}`);
    }
  }, [windowId, windowMeta.isFocused]);
  
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

  // Effect to handle showing/hiding web contents based on freeze state
  useEffect(() => {
    // Show web contents only when in ACTIVE state
    setShowWebContentsView(freezeState.type === 'ACTIVE');
  }, [freezeState.type]);

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

  // Tab management callbacks
  const handleTabClick = useCallback((tabId: string) => {
    console.log(`[ClassicBrowser ${windowId}] Switching to tab:`, tabId);
    if (window.api?.classicBrowserSwitchTab) {
      window.api.classicBrowserSwitchTab(windowId, tabId)
        .then(result => {
          if (!result.success) {
            console.error(`[ClassicBrowser ${windowId}] Failed to switch tab:`, result.error);
          }
        })
        .catch(err => {
          console.error(`[ClassicBrowser ${windowId}] Error switching tab:`, err);
        });
    }
  }, [windowId]);

  const handleTabClose = useCallback((tabId: string) => {
    console.log(`[ClassicBrowser ${windowId}] Closing tab:`, tabId);
    
    // Clean up local bookmarking state for the closed tab
    setBookmarkingTabs(prev => {
      const newState = { ...prev };
      delete newState[tabId];
      return newState;
    });
    
    if (window.api?.classicBrowserCloseTab) {
      window.api.classicBrowserCloseTab(windowId, tabId)
        .then(result => {
          if (!result.success) {
            console.error(`[ClassicBrowser ${windowId}] Failed to close tab:`, result.error);
          }
        })
        .catch(err => {
          console.error(`[ClassicBrowser ${windowId}] Error closing tab:`, err);
        });
    }
  }, [windowId]);

  const handleNewTab = useCallback(() => {
    console.log(`[ClassicBrowser ${windowId}] Creating new tab`);
    if (window.api?.classicBrowserCreateTab) {
      window.api.classicBrowserCreateTab(windowId)
        .then(result => {
          if (result.success && result.tabId) {
            console.log(`[ClassicBrowser ${windowId}] Created new tab:`, result.tabId);
          } else {
            console.error(`[ClassicBrowser ${windowId}] Failed to create tab:`, result.error);
          }
        })
        .catch(err => {
          console.error(`[ClassicBrowser ${windowId}] Error creating tab:`, err);
        });
    }
  }, [windowId]);
  
  // Handle bookmark click
  const handleBookmarkClick = useCallback(async () => {
    // Prevent action if no active tab, no URL, or already in progress
    if (!activeTabId || !currentUrl || isCurrentlyBookmarking) {
      return;
    }
    
    // If already bookmarked, ask for confirmation to delete
    if (isBookmarked) {
      const confirmed = window.confirm('This page is bookmarked. Remove it from your bookmarks?');
      if (!confirmed) {
        return;
      }
      
      // Set optimistic UI state for deletion
      setBookmarkingTabs(prev => ({ ...prev, [activeTabId]: true }));
      
      try {
        console.log(`[Bookmark] Deleting bookmark for URL: ${currentUrl}`);
        const result = await window.api.deleteObjectBySourceUri(windowId, currentUrl);
        
        if (result.successful.length > 0) {
          console.log(`[Bookmark] Successfully deleted bookmark for: ${currentUrl}`);
          // The backend will refresh the tab state and push the update
        } else if (result.notFound.length > 0) {
          console.log(`[Bookmark] Bookmark not found for URL: ${currentUrl}`);
        }
      } catch (error) {
        console.error('[Bookmark] Failed to delete bookmark:', error);
        // Optional: Add a toast notification for the user here.
      } finally {
        // Reset the optimistic UI state for this tab
        setBookmarkingTabs(prev => {
          const newState = { ...prev };
          delete newState[activeTabId];
          return newState;
        });
      }
      return;
    }
    
    // Set optimistic UI state for this specific tab
    setBookmarkingTabs(prev => ({ ...prev, [activeTabId]: true }));
    
    try {
      console.log(`[Bookmark] Ingesting URL: ${currentUrl}`);
      const result = await window.api.ingestUrl(currentUrl, pageTitle);
      
      if (result.alreadyExists) {
        console.log(`[Bookmark] URL already bookmarked: ${currentUrl}`);
      } else {
        console.log(`[Bookmark] Successfully queued URL for ingestion: ${currentUrl}, jobId: ${result.jobId}`);
      }
      // The backend will eventually push a new TabState with isBookmarked: true,
      // which will automatically update the UI. We don't need to do it here.
    } catch (error) {
      console.error('[Bookmark] Failed to ingest URL:', error);
      // Optional: Add a toast notification for the user here.
    } finally {
      // Reset the optimistic UI state for this tab
      setBookmarkingTabs(prev => {
        const newState = { ...prev };
        delete newState[activeTabId];
        return newState;
      });
    }
  }, [activeTabId, currentUrl, pageTitle, isBookmarked, isCurrentlyBookmarking]);

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
          windowMeta.isFocused ? 'bg-step-4' : 'bg-step-3',
          windowMeta.isFocused ? 'opacity-100' : 'opacity-90'
        )}
        style={{ borderColor: 'inherit' }}
      >
        <Button variant="ghost" size="icon" onClick={() => handleNavigate('back')} disabled={!canGoBack || isLoading} className={cn("h-7 w-7", "no-drag", windowMeta.isFocused ? "text-step-11" : "text-step-9")}>
          <svg width="24" height="24" viewBox="3 3 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16.9062 18.3273L18 17.2477L13.4972 12.7449V11.1824L18 6.69376L16.9062 5.60001L10.5426 11.9636L16.9062 18.3273Z" fill="currentColor"/>
          </svg>
        </Button>
        <Button variant="ghost" size="icon" onClick={() => handleNavigate('forward')} disabled={!canGoForward || isLoading} className={cn("h-7 w-7", "no-drag", windowMeta.isFocused ? "text-step-11" : "text-step-9")}>
          <svg width="24" height="24" viewBox="3 3 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.09375 18.7273L6 17.6477L10.5028 13.1449V11.5824L6 7.09375L7.09375 6L13.4574 12.3636L7.09375 18.7273Z" fill="currentColor"/>
          </svg>
        </Button>
        
        {/* URL bar container - takes all available space between nav buttons and window controls */}
        <div className="flex-1 flex items-center justify-start px-2 gap-1 py-0.5">
          <div className={cn("relative flex items-center group/urlbar", inputWidthClass)}>
            {/* Favicon/Bookmark display - switches on hover or focus */}
            <div className="absolute left-2 w-4 h-4 z-10 group/urlbar">
              {/* Favicon - hidden on parent hover or input focus */}
              {faviconUrl ? (
                <img 
                  src={faviconUrl} 
                  alt="Site favicon" 
                  className={cn(
                    "absolute inset-0 w-4 h-4 transition-opacity duration-200",
                    isInputFocused ? "opacity-0" : "opacity-100 group-hover/urlbar:opacity-0"
                  )}
                  onError={(e) => {
                    // If favicon fails to load, hide it
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <Globe className={cn(
                  "absolute inset-0 w-4 h-4 text-step-12/50 transition-opacity duration-200",
                  isInputFocused ? "opacity-0" : "opacity-100 group-hover/urlbar:opacity-0"
                )} />
              )}
              
              {/* Bookmark icon - shown on parent hover or input focus */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={cn(
                        "absolute inset-0 w-4 h-4 flex items-center justify-center transition-all duration-200",
                        "hover:bg-step-6/20 rounded-sm",
                        // Base color state - match navigation buttons
                        !isBookmarked && (windowMeta.isFocused ? "text-step-11" : "text-step-9"),
                        // Bookmarked state - use birkin color
                        isBookmarked && "text-birkin",
                        // Visibility logic
                        isInputFocused ? "opacity-100" : "opacity-0 group-hover/urlbar:opacity-100",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBookmarkClick();
                      }}
                      disabled={isCurrentlyBookmarking} // Only disable when in progress
                    >
                      {isCurrentlyBookmarking ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isBookmarked ? (
                        // Filled Icon
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12 2H4C3.44772 2 3 2.44772 3 3V14L8 11L13 14V3C13 2.44772 12.5523 2 12 2Z"/>
                        </svg>
                      ) : (
                        // Outlined Icon
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12 2H4C3.44772 2 3 2.44772 3 3V14L8 11L13 14V3C13 2.44772 12.5523 2 12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {isBookmarked && bookmarkedAt
                        ? `Bookmarked on ${new Date(bookmarkedAt).toLocaleDateString()}`
                        : isBookmarked
                        ? "Remove bookmark"
                        : "Bookmark this page"}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            
            <Input
              value={isInputFocused ? addressBarUrl : (pageTitle || addressBarUrl)}
              onChange={e => setAddressBarUrl(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleLoadUrl();
                  e.currentTarget.blur();
                }
              }}
              onFocus={() => {
                setIsInputFocused(true);
                // When focusing, ensure we show the URL
                if (pageTitle && addressBarUrl !== currentUrl) {
                  setAddressBarUrl(currentUrl || '');
                }
              }}
              onBlur={() => setIsInputFocused(false)}
              onMouseDownCapture={e => {
                e.stopPropagation();
              }}
              placeholder="Enter URL and press Enter"
              className={cn(
                "h-7 rounded-sm text-sm pl-8 pr-2 bg-step-3 dark:bg-step-3 focus:bg-step-1 dark:focus:bg-step-1 w-full",
                windowMeta.isFocused ? "border border-step-6" : "border border-transparent",
                "focus-visible:border-step-8 focus-visible:ring-step-8/50 focus-visible:ring-[3px]",
                windowMeta.isFocused ? "shadow-xs" : "shadow-none [box-shadow:0_0_2px_0_var(--step-7)]"
              )}
              title={addressBarUrl} // Always show URL in tooltip
            />
          </div>
          
          {/* New tab button - only show when single tab */}
          {classicPayload.tabs.length === 1 && (
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleNewTab} 
              className={cn("h-7 w-7 text-step-11", "no-drag")}
              title="Open new tab"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Button>
          )}
        </div>
        
        <div className="no-drag">
          <WindowControls id={windowId} activeStore={activeStore} isFocused={windowMeta.isFocused} />
        </div>
      </div>
      
      {/* Tab bar - only visible when multiple tabs */}
      <TabBar
        tabs={classicPayload.tabs}
        activeTabId={classicPayload.activeTabId}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onNewTab={handleNewTab}
        isFocused={windowMeta.isFocused}
      />
      
      {/* Content area that will host the BrowserView */}
      <div 
        ref={webContentsViewRef} 
        className={cn(
          "relative flex-1 w-full focus:outline-none overflow-hidden rounded-t-lg",
          windowMeta.isFocused ? 'bg-step-4' : 'bg-step-3'
        )}
        // The actual BrowserView will be positioned over this div by Electron.
        // We can add a placeholder or loading indicator here if desired.
        // For now, it will be blank until the BrowserView is created and loaded.
        style={{
          // If isActuallyVisible is false, we might want to hide this or show a placeholder
          // visibility: isActuallyVisible ? 'visible' : 'hidden',
          // backgroundColor: 'transparent' // Or a specific color if needed
        }}
      >
      {/* Snapshot overlay when frozen or awaiting render */}
      {(isAwaitingRender || isFrozen) && snapshotUrl && (
        <div 
          className="absolute inset-0 z-20 transition-opacity duration-200 ease-in-out rounded-t-lg overflow-hidden"
          style={{ 
            opacity: 1,
            pointerEvents: 'none' // Prevent interaction with the snapshot
          }}
        >
          <img 
            src={snapshotUrl} 
            alt="Browser snapshot"
            className="w-full h-full object-cover"
            style={{
              imageRendering: 'crisp-edges', // Ensure sharp rendering
              backgroundColor: windowMeta.isFocused ? '#2a2a28' : '#222221' // step-4 : step-3
            }}
            onLoad={() => {
              console.log(`[ClassicBrowser ${windowId}] Snapshot image loaded and rendered`);
              // Notify the controller that the snapshot has been rendered
              if (isAwaitingRender) {
                controller.handleSnapshotLoaded();
              }
            }}
          />
        </div>
      )}
      
      {/* Live view container - hidden when frozen or during unfreeze delay */}
      <div 
        className="absolute inset-0"
        style={{ 
          opacity: showWebContentsView ? 1 : 0,
          pointerEvents: showWebContentsView ? 'auto' : 'none'
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