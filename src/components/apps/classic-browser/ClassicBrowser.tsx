"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ArrowRight, RotateCw, XCircle } from 'lucide-react';
import type { ClassicBrowserPayload } from '../../../../shared/types';

interface ClassicBrowserViewWrapperProps {
  payload: ClassicBrowserPayload;
  windowId: string;
}

export const ClassicBrowserViewWrapper: React.FC<ClassicBrowserViewWrapperProps> = ({
  payload: initialPayload,
  windowId,
}) => {
  const [currentPayload, setCurrentPayload] = useState<ClassicBrowserPayload>(initialPayload);
  const [addressBarUrl, setAddressBarUrl] = useState<string>(initialPayload.requestedUrl || initialPayload.currentUrl || 'https://');
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentPayload(initialPayload);
    const newAddressBarUrl = initialPayload.requestedUrl || initialPayload.currentUrl || 'https://';
    if (newAddressBarUrl !== addressBarUrl) {
      setAddressBarUrl(newAddressBarUrl);
    }
  }, [initialPayload]);

  useEffect(() => {
    const urlToLoad = initialPayload.requestedUrl || initialPayload.currentUrl;

    if (window.api) {
      window.api.classicBrowserInitView(windowId, { x: 0, y: 0, width: 1, height: 1 }, urlToLoad)
        .then(result => {
          if (result.success) {
            console.log(`[ClassicBrowser ${windowId}] classicBrowserInitView successful.`);
          } else {
            console.error(`[ClassicBrowser ${windowId}] classicBrowserInitView failed.`);
            setCurrentPayload(prev => ({...prev, error: "Browser view initialization failed."}));
          }
        })
        .catch(err => {
          console.error(`[ClassicBrowser ${windowId}] Error calling classicBrowserInitView:`, err);
          setCurrentPayload(prev => ({...prev, error: "Failed to initialize browser view."}));
        });

      const unsubscribe = window.api.onClassicBrowserStateUpdate((update: { windowId: string; state: Partial<ClassicBrowserPayload>; }) => {
        const { windowId: id, state: newState } = update;
        if (id === windowId) {
          console.log(`[ClassicBrowser ${windowId}] Received state update from main:`, newState);
          setCurrentPayload((prev) => ({ ...prev, ...newState }));
          if (newState.currentUrl && (!newState.isLoading || newState.currentUrl !== (currentPayload.requestedUrl || ''))) {
            if (newState.currentUrl !== addressBarUrl) setAddressBarUrl(newState.currentUrl);
          } else if (newState.requestedUrl && newState.isLoading) {
            if (newState.requestedUrl !== addressBarUrl) setAddressBarUrl(newState.requestedUrl);
          }
        }
      });

      return () => {
        console.log(`[ClassicBrowser ${windowId}] Cleaning up. Destroying BrowserView.`);
        unsubscribe();
        if (window.api && typeof window.api.classicBrowserDestroy === 'function') {
          window.api.classicBrowserDestroy(windowId)
            .catch(err => console.error(`[ClassicBrowser ${windowId}] Error calling classicBrowserDestroy:`, err));
        }
      };
    } else {
      console.warn(`[ClassicBrowser ${windowId}] window.api not available for init.`);
    }
  }, [windowId, initialPayload.initialUrl, initialPayload.requestedUrl, initialPayload.currentUrl]);

  const handleLoadUrl = useCallback(() => {
    let urlToLoad = addressBarUrl.trim();
    if (!urlToLoad.startsWith('http://') && !urlToLoad.startsWith('https://')) {
      urlToLoad = 'https://' + urlToLoad;
    }
    setAddressBarUrl(urlToLoad);
    console.log(`[ClassicBrowser ${windowId}] Requesting load URL:`, urlToLoad);
    if (window.api && typeof window.api.classicBrowserLoadUrl === 'function') {
      window.api.classicBrowserLoadUrl(windowId, urlToLoad)
        .catch((err: Error) => {
          console.error(`[ClassicBrowser ${windowId}] Error calling classicBrowserLoadUrl:`, err);
          setCurrentPayload((prev: ClassicBrowserPayload) => ({...prev, error: err.message || 'Failed to load URL'}));
        });
      setCurrentPayload((prev: ClassicBrowserPayload) => ({...prev, isLoading: true, requestedUrl: urlToLoad, error: null }));
    } else {
      console.warn('[ClassicBrowser] window.api.classicBrowserLoadUrl is not available.');
      setCurrentPayload((prev: ClassicBrowserPayload) => ({...prev, error: 'Browser API not available.'}));
    }
  }, [addressBarUrl, windowId]);

  const handleNavigate = useCallback((action: 'back' | 'forward' | 'reload' | 'stop') => {
    console.log(`[ClassicBrowser ${windowId}] Requesting navigation:`, action);
    if (window.api && typeof window.api.classicBrowserNavigate === 'function') {
      window.api.classicBrowserNavigate(windowId, action)
        .then(() => {
          if (action === 'reload' || action === 'stop') {
            setCurrentPayload((prev: ClassicBrowserPayload) => ({...prev, isLoading: action === 'reload', error: null }));
          }
        })
        .catch((err: Error) => {
          console.error(`[ClassicBrowser ${windowId}] Error calling classicBrowserNavigate:`, err);
          setCurrentPayload((prev: ClassicBrowserPayload) => ({...prev, error: err.message || `Failed to ${action}`}));
        });
    } else {
      console.warn('[ClassicBrowser] window.api.classicBrowserNavigate is not available.');
      setCurrentPayload((prev: ClassicBrowserPayload) => ({...prev, error: 'Browser API not available.'}));
    }
  }, [windowId]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center p-2 border-b bg-muted/30">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => handleNavigate('back')}
          disabled={!currentPayload.canGoBack || currentPayload.isLoading}
          aria-label="Go back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => handleNavigate('forward')}
          disabled={!currentPayload.canGoForward || currentPayload.isLoading}
          aria-label="Go forward"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => handleNavigate('reload')}
          disabled={currentPayload.isLoading}
          aria-label="Reload page"
        >
          <RotateCw className="h-4 w-4" />
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
          className="flex-grow mx-2 h-8 text-sm"
          disabled={currentPayload.isLoading}
        />
      </div>

      {/* Content Area (Placeholder) */}
      <div ref={contentRef} className="flex-grow flex items-center justify-center bg-muted/10 relative">
        {currentPayload.isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10">
            <RotateCw className="h-8 w-8 animate-spin text-primary mb-2" />
            <p className="text-sm text-muted-foreground">Loading: {currentPayload.requestedUrl || currentPayload.currentUrl}</p>
          </div>
        )}
        {currentPayload.error && (
           <div className="absolute inset-0 flex flex-col items-center justify-center bg-destructive/10 text-destructive-foreground p-4 z-20">
            <XCircle className="h-8 w-8 mb-2" />
            <p className="text-sm font-medium">Error loading page</p>
            <p className="text-xs text-center">{currentPayload.error}</p>
            <p className="text-xs text-center mt-1">URL: {currentPayload.requestedUrl || currentPayload.currentUrl}</p>
          </div>
        )}
        {/* This is where the WebContentsView would be visually. */}
        {/* For now, we show a placeholder if not loading and no error. */}
        {!currentPayload.isLoading && !currentPayload.error && (
          <div className="text-center">
            <p className="text-lg text-muted-foreground">Browser Content Area</p>
            <p className="text-sm text-muted-foreground">
              {currentPayload.currentUrl ? `Current URL: ${currentPayload.currentUrl}` : "No URL loaded"}
            </p>
            <p className="text-xs text-muted-foreground mt-2">(Actual web content is rendered by Electron's WebContentsView)</p>
          </div>
        )}
      </div>
      {/* Status Bar (Optional) */}
      {/* <div className="p-1 border-t text-xs text-muted-foreground">
        {currentPayload.isLoading ? \`Loading \${currentPayload.requestedUrl}...\` : currentPayload.title || currentPayload.currentUrl || 'Ready'}
      </div> */}
    </div>
  );
};

// Export a default for lazy loading if desired, though direct export is fine
export default ClassicBrowserViewWrapper; 