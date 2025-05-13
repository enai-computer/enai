"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ArrowRight, RotateCw, X, XCircle, Globe } from 'lucide-react';
import { WEB_LAYER_WINDOW_ID } from '../../../../shared/ipcChannels'; // Adjusted path
import type { ClassicBrowserPayload } from '../../../../shared/types'; // Adjusted path

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

  const calculateBounds = useCallback(() => {
    return {
      x: Math.round(FRAME_MARGIN),
      y: Math.round(FRAME_MARGIN + TOOLBAR_HEIGHT),
      width: Math.round(window.innerWidth - 2 * FRAME_MARGIN),
      height: Math.round(window.innerHeight - 2 * FRAME_MARGIN - TOOLBAR_HEIGHT),
    };
  }, []);

  useEffect(() => {
    if (!window.api) {
      console.error("[WebLayer] window.api is not available.");
      setError("Browser API is not available.");
      return;
    }

    let unsubscribeFromStateUpdates: (() => void) | undefined;

    if (isVisible) {
      const bounds = calculateBounds();
      console.log(`[WebLayer] Creating BrowserView with ID ${WEB_LAYER_WINDOW_ID}, bounds:`, bounds, "url:", initialUrl);
      
      // Reset state for new visibility
      setAddressBarUrl(initialUrl);
      setCurrentUrl('');
      setPageTitle('');
      setIsLoading(true);
      setCanGoBack(false);
      setCanGoForward(false);
      setError(null);
      
      window.api.classicBrowserCreate(WEB_LAYER_WINDOW_ID, bounds, initialUrl)
        .then(() => {
          console.log(`[WebLayer] classicBrowserCreate call succeeded for ${WEB_LAYER_WINDOW_ID}.`);
        })
        .catch((err: Error) => {
          console.error(`[WebLayer] Error calling classicBrowserCreate for ${WEB_LAYER_WINDOW_ID}:`, err);
          setError(`Failed to create browser view: ${err.message}`);
          setIsLoading(false);
        });

      unsubscribeFromStateUpdates = window.api.onClassicBrowserState((update: { windowId: string; state: Partial<ClassicBrowserPayload> }) => {
        if (update.windowId === WEB_LAYER_WINDOW_ID) {
          console.log(`[WebLayer] Received state update:`, update.state);
          if (update.state.currentUrl !== undefined) {
            setCurrentUrl(update.state.currentUrl);
            if (!isLoading || update.state.currentUrl !== addressBarUrl ) { // Update address bar if not actively loading a different one
                 setAddressBarUrl(update.state.currentUrl);
            }
          }
          if (update.state.title !== undefined) setPageTitle(update.state.title);
          if (update.state.isLoading !== undefined) setIsLoading(update.state.isLoading);
          if (update.state.canGoBack !== undefined) setCanGoBack(update.state.canGoBack);
          if (update.state.canGoForward !== undefined) setCanGoForward(update.state.canGoForward);
          if (update.state.error !== undefined) setError(update.state.error);
           // If loading started for a new requested URL, update address bar
          if (update.state.isLoading && update.state.requestedUrl && update.state.requestedUrl !== addressBarUrl) {
            setAddressBarUrl(update.state.requestedUrl);
          }
        }
      });

      const handleResize = () => {
        if (window.api?.classicBrowserSetBounds) {
          const newBounds = calculateBounds();
          console.log(`[WebLayer] Window resized. Setting new bounds for ${WEB_LAYER_WINDOW_ID}:`, newBounds);
          window.api.classicBrowserSetBounds(WEB_LAYER_WINDOW_ID, newBounds)
            .catch(err => console.error(`[WebLayer] Error setting bounds on resize for ${WEB_LAYER_WINDOW_ID}:`, err));
        }
      };
      window.addEventListener('resize', handleResize);

      return () => {
        console.log(`[WebLayer] Cleaning up for ${WEB_LAYER_WINDOW_ID}. isVisible is now false or component unmounting.`);
        window.removeEventListener('resize', handleResize);
        if (unsubscribeFromStateUpdates) {
          unsubscribeFromStateUpdates();
        }
        if (window.api?.classicBrowserDestroy) {
          console.log(`[WebLayer] Calling classicBrowserDestroy for ${WEB_LAYER_WINDOW_ID}.`);
          window.api.classicBrowserDestroy(WEB_LAYER_WINDOW_ID)
            .catch((err: Error) => console.error(`[WebLayer] Error calling classicBrowserDestroy for ${WEB_LAYER_WINDOW_ID}:`, err));
        }
      };
    }
  }, [isVisible, initialUrl, calculateBounds]); // Removed isLoading from deps to avoid loop with setAddressBarUrl

  const handleLoadUrl = useCallback(() => {
    let urlToLoad = addressBarUrl.trim();
    if (!urlToLoad) return;
    if (!urlToLoad.startsWith('http://') && !urlToLoad.startsWith('https://') && !urlToLoad.startsWith('file://') && !urlToLoad.startsWith('about:')) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" aria-modal="true">
      <div 
        className="w-[calc(100vw-36px)] h-[calc(100vh-36px)] bg-card text-card-foreground rounded-[18px] shadow-2xl flex flex-col overflow-hidden border"
        style={{ margin: `${FRAME_MARGIN}px` }} // Ensures the div itself doesn't exceed viewport due to calc issues with border/padding
      >
        {/* Toolbar */}
        <div 
          className="p-2 border-b flex items-center space-x-1 bg-muted/30 shrink-0"
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
            value={addressBarUrl}
            onChange={(e) => setAddressBarUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleLoadUrl();
              }
            }}
            placeholder="Enter URL and press Enter"
            className="flex-grow mx-1 h-8 text-sm px-2"
            disabled={isLoading && currentUrl !== addressBarUrl} // Disable if loading a different URL than in address bar
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close WebLayer"
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content Area (Placeholder & Error/Loading Display) */}
        <div className="flex-grow flex items-center justify-center bg-muted/10 relative overflow-hidden">
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10 p-4 text-center">
              <RotateCw className="h-6 w-6 animate-spin text-primary mb-2" />
              <p className="text-xs text-muted-foreground truncate">Loading: {addressBarUrl}</p>
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
             <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground p-4 z-0">
               <Globe className="h-10 w-10 mb-2" />
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
