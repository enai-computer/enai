"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ArrowRight, RotateCw, X, XCircle, Globe } from 'lucide-react';
import { WEB_LAYER_WINDOW_ID } from '../../../../shared/ipcChannels'; // Adjusted path
import type { ClassicBrowserStateUpdate } from '../../../../shared/types'; // Adjusted path
import { useNativeResource } from '@/hooks/use-native-resource';

const FRAME_MARGIN = 18; // px
const TOOLBAR_HEIGHT = 48; // px, adjust as needed

interface WebLayerProps {
  initialUrl: string;
  isVisible: boolean;
  onClose: () => void;
}

export const WebLayer: React.FC<WebLayerProps> = ({ initialUrl, isVisible, onClose }) => {
  const [addressBarUrl, setAddressBarUrl] = useState<string>(initialUrl);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [pageTitle, setPageTitle] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [canGoBack, setCanGoBack] = useState<boolean>(false);
  const [canGoForward, setCanGoForward] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isAddressBarHovered, setIsAddressBarHovered] = useState<boolean>(false);
  const [isAddressBarFocused, setIsAddressBarFocused] = useState<boolean>(false);
  const isAddressBarFocusedRef = useRef<boolean>(false);
  const creationInProgressRef = useRef<boolean>(false);

  // Log component mount/unmount
  useEffect(() => {
    console.log(`[WebLayer] Component mounted with initialUrl: ${initialUrl}, isVisible: ${isVisible}`);
    return () => {
      console.log(`[WebLayer] Component unmounting`);
    };
  }, []);

  const calculateBounds = useCallback(() => {
    return {
      x: Math.round(FRAME_MARGIN),
      y: Math.round(FRAME_MARGIN + TOOLBAR_HEIGHT),
      width: Math.round(window.innerWidth - 2 * FRAME_MARGIN),
      height: Math.round(window.innerHeight - 2 * FRAME_MARGIN - TOOLBAR_HEIGHT),
    };
  }, []);

  // Create browser view callback
  const createBrowserView = useCallback(async () => {
    // Early return if not visible
    if (!isVisible) {
      console.log(`[WebLayer] Skipping browser view creation - not visible`);
      return;
    }
    
    // Prevent concurrent creation attempts
    if (creationInProgressRef.current) {
      console.log(`[WebLayer] Browser view creation already in progress, skipping duplicate attempt`);
      return;
    }
    
    if (!window.api) {
      console.error("[WebLayer] window.api is not available.");
      setError("Browser API is not available.");
      throw new Error('Browser API not available');
    }

    creationInProgressRef.current = true;
    
    try {
      const bounds = calculateBounds();
      console.log(`[WebLayer] Creating BrowserView with ID ${WEB_LAYER_WINDOW_ID}, bounds:`, bounds, "url:", initialUrl);
      
      // Reset state for new browser view
      setAddressBarUrl(initialUrl);
      setCurrentUrl('');
      setPageTitle('');
      setIsLoading(true);
      setCanGoBack(false);
      setCanGoForward(false);
      setError(null);
      
      // Add a small delay to prevent rapid create/destroy cycles
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await window.api.classicBrowserCreate(WEB_LAYER_WINDOW_ID, bounds, initialUrl);
      console.log(`[WebLayer] classicBrowserCreate call succeeded for ${WEB_LAYER_WINDOW_ID}.`);
    } catch (err) {
      console.error(`[WebLayer] Error calling classicBrowserCreate for ${WEB_LAYER_WINDOW_ID}:`, err);
      setError(`Failed to create browser view: ${err instanceof Error ? err.message : String(err)}`);
      setIsLoading(false);
      throw err;
    } finally {
      creationInProgressRef.current = false;
    }
  }, [initialUrl, calculateBounds, isVisible]);

  // Destroy browser view callback
  const destroyBrowserView = useCallback(async () => {
    console.log(`[WebLayer] Destroying browser view ${WEB_LAYER_WINDOW_ID}`);
    if (window.api?.classicBrowserDestroy) {
      await window.api.classicBrowserDestroy(WEB_LAYER_WINDOW_ID);
    }
  }, []);

  // Use the native resource lifecycle hook only when visible
  // Don't conditionally change the callbacks - let the hook handle lifecycle
  useNativeResource(
    createBrowserView,
    destroyBrowserView,
    [isVisible ? WEB_LAYER_WINDOW_ID : null], // Only create when visible
    {
      unmountDelay: 50,
      debug: true,
      debugLabel: `WebLayer[${WEB_LAYER_WINDOW_ID}]`
    }
  );

  // Separate effect for state updates listener
  useEffect(() => {
    if (!isVisible || !window.api?.onClassicBrowserState) return;

    const unsubscribe = window.api.onClassicBrowserState((update: ClassicBrowserStateUpdate) => {
      if (update.windowId === WEB_LAYER_WINDOW_ID) {
        console.log(`[WebLayer] Received state update:`, update.update);
        
        // Handle tab updates
        if (update.update.tab) {
          const tabUpdate = update.update.tab;
          if (tabUpdate.url !== undefined) {
            setCurrentUrl(tabUpdate.url);
            // Only update address bar if not focused and not actively loading a different URL
            if (!isAddressBarFocusedRef.current && (!isLoading || tabUpdate.url !== addressBarUrl)) {
              setAddressBarUrl(tabUpdate.url);
            }
          }
          if (tabUpdate.title !== undefined) setPageTitle(tabUpdate.title);
          if (tabUpdate.isLoading !== undefined) setIsLoading(tabUpdate.isLoading);
          if (tabUpdate.canGoBack !== undefined) setCanGoBack(tabUpdate.canGoBack);
          if (tabUpdate.canGoForward !== undefined) setCanGoForward(tabUpdate.canGoForward);
          if (tabUpdate.error !== undefined) setError(tabUpdate.error);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isVisible, isLoading, addressBarUrl]);

  // Separate effect for window resize
  useEffect(() => {
    if (!isVisible) return;

    const handleResize = () => {
      if (window.api?.classicBrowserSetBounds) {
        const newBounds = calculateBounds();
        console.log(`[WebLayer] Window resized. Setting new bounds for ${WEB_LAYER_WINDOW_ID}:`, newBounds);
        window.api.classicBrowserSetBounds(WEB_LAYER_WINDOW_ID, newBounds);
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [isVisible, calculateBounds]);

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
    } else if (!urlToLoad.startsWith('http://') && !urlToLoad.startsWith('https://') && !urlToLoad.startsWith('file://') && !urlToLoad.startsWith('about:')) {
      // It's a URL without protocol
      urlToLoad = 'https://' + urlToLoad;
    }
    
    setAddressBarUrl(urlToLoad); // Update UI immediately
    setIsLoading(true); // Optimistic update
    setError(null);

    console.log(`[WebLayer] Requesting load URL: ${urlToLoad} for ${WEB_LAYER_WINDOW_ID}`);
    window.api?.classicBrowserLoadUrl(WEB_LAYER_WINDOW_ID, urlToLoad)
      .catch((err: Error) => {
        console.error(`[WebLayer] Error calling classicBrowserLoadUrl for ${WEB_LAYER_WINDOW_ID}:`, err);
        setError(err.message || 'Failed to load URL');
        setIsLoading(false);
      });
  }, [addressBarUrl]);

  const handleNavigate = useCallback((action: 'back' | 'forward' | 'reload' | 'stop') => {
    console.log(`[WebLayer] Requesting navigation: ${action} for ${WEB_LAYER_WINDOW_ID}`);
    if (action === 'reload') setIsLoading(true);
    if (action === 'stop') setIsLoading(false);
    setError(null);

    window.api?.classicBrowserNavigate(WEB_LAYER_WINDOW_ID, action)
      .catch((err: Error) => {
        console.error(`[WebLayer] Error calling classicBrowserNavigate for ${action} on ${WEB_LAYER_WINDOW_ID}:`, err);
        setError(err.message || `Failed to ${action}`);
        // Revert optimistic loading state if necessary, though events should correct it
        if (action === 'reload') setIsLoading(false);
      });
  }, []);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none" aria-modal="true">
      <div 
        className="w-[calc(100vw-36px)] h-[calc(100vh-36px)] bg-step-4 text-step-12 rounded-[18px] shadow-2xl flex flex-col overflow-hidden pointer-events-auto"
        style={{ 
          margin: `${FRAME_MARGIN}px`,
          boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.1), 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
        }}
      >
        {/* Toolbar */}
        <div 
          className="p-2 flex items-center space-x-1 bg-step-4 shrink-0"
          style={{ height: `${TOOLBAR_HEIGHT}px`}}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleNavigate('back')}
            disabled={!canGoBack || isLoading}
            aria-label="Go back"
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleNavigate('forward')}
            disabled={!canGoForward || isLoading}
            aria-label="Go forward"
            className="h-8 w-8"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleNavigate(isLoading ? 'stop' : 'reload')}
            aria-label={isLoading ? "Stop loading" : "Reload page"}
            className="h-8 w-8"
          >
            {isLoading && !error ? <XCircle className="h-4 w-4 animate-pulse" /> : <RotateCw className="h-4 w-4" />}
          </Button>
          <Input
            type="text"
            value={isAddressBarFocused ? addressBarUrl : (isAddressBarHovered ? currentUrl || addressBarUrl : pageTitle || currentUrl || addressBarUrl)}
            onChange={(e) => setAddressBarUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleLoadUrl();
              }
            }}
            onFocus={() => {
              setIsAddressBarFocused(true);
              isAddressBarFocusedRef.current = true;
              // When focusing, ensure we're showing the actual URL
              if (pageTitle && currentUrl) {
                setAddressBarUrl(currentUrl);
              }
            }}
            onBlur={() => {
              setIsAddressBarFocused(false);
              isAddressBarFocusedRef.current = false;
            }}
            onMouseEnter={() => setIsAddressBarHovered(true)}
            onMouseLeave={() => setIsAddressBarHovered(false)}
            placeholder="Enter URL and press Enter"
            className={`flex-grow mx-1 h-8 text-sm px-2 transition-all bg-step-1/80 focus:bg-step-1 rounded-sm ${
              isAddressBarHovered || isAddressBarFocused 
                ? 'border border-step-6 focus-visible:border-step-8 focus-visible:ring-step-8/50 focus-visible:ring-[3px]' 
                : 'border-none shadow-none'
            }`}
            disabled={isLoading && currentUrl !== addressBarUrl} // Disable if loading a different URL than in address bar
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              console.log(`[WebLayer] Close button clicked`);
              onClose();
            }}
            aria-label="Close WebLayer"
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content Area (Placeholder & Error/Loading Display) */}
        <div className="flex-grow flex items-center justify-center bg-step-4 relative overflow-hidden">
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-step-4/80 z-10 p-4 text-center">
              <RotateCw className="h-6 w-6 animate-spin text-step-12/80 mb-2" />
              <p className="text-xs text-step-12/60 truncate">Loading: {addressBarUrl}</p>
            </div>
          )}
          {error && !isLoading && (
             <div className="absolute inset-0 flex flex-col items-center justify-center bg-destructive/10 text-destructive-foreground p-4 z-20 text-center">
              <XCircle className="h-6 w-6 mb-2" />
              <p className="text-sm font-medium">Error</p>
              <p className="text-xs ">{error}</p>
              <p className="text-xs mt-1 truncate">URL: {currentUrl || addressBarUrl}</p>
            </div>
          )}
          {!isLoading && !error && !currentUrl && (
             <div className="absolute inset-0 flex flex-col items-center justify-center text-step-12/60 p-4 z-0">
               <Globe className="h-10 w-10 mb-2 text-step-12/30" />
               <p className="text-sm">Enter a URL to start browsing or content will appear here.</p>
             </div>
          )}
           {/* The actual BrowserView is rendered by Electron underneath this div. */}
        </div>
      </div>
    </div>
  );
};

export default WebLayer;
