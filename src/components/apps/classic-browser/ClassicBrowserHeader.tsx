"use client";

import React, { useState, useCallback, useEffect } from 'react';
import type { StoreApi } from 'zustand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ArrowRight, RotateCw, XCircle } from 'lucide-react';
import type { ClassicBrowserPayload, WindowMeta } from '../../../../shared/types';
import type { WindowStoreState } from '../../../store/windowStoreFactory';
import { cn } from '@/lib/utils';

// Placeholder for the actual hook - THIS WILL NOT BE USED FOR THE DIRECT FIX
// const useClassicBrowserIpc = (windowId: string) => { ... };

interface ClassicBrowserHeaderProps {
  windowId: string;
  activeStore: StoreApi<WindowStoreState>;
  // Pass the whole windowMeta or just classicPayload. For now, classicPayload is simpler.
  classicPayload: ClassicBrowserPayload; 
  windowMeta: WindowMeta; // Added to access the full windowMeta for title updates, etc.
}

export const ClassicBrowserHeader: React.FC<ClassicBrowserHeaderProps> = ({ windowId, activeStore, classicPayload, windowMeta }) => {
  const [addressBarUrl, setAddressBarUrl] = useState<string>(classicPayload.requestedUrl || classicPayload.currentUrl || 'https://');
  
  const { isFocused } = windowMeta;

  // Derived state from classicPayload for UI binding
  const {
    currentUrl = '',
    requestedUrl = '',
    isLoading = false,
    canGoBack = false,
    canGoForward = false,
    // error = null, // Error display can be handled by ClassicBrowserViewWrapper for now
  } = classicPayload;

  // Effect to sync addressBarUrl with payload changes from main process
  useEffect(() => {
    // If a navigation is actively loading and the requestedUrl is different, update.
    if (isLoading && requestedUrl && requestedUrl !== addressBarUrl) {
      setAddressBarUrl(requestedUrl);
    } 
    // If not loading, and the actual currentUrl is different, update.
    else if (!isLoading && currentUrl && currentUrl !== addressBarUrl) {
      setAddressBarUrl(currentUrl);
    }
    // Initial state is handled by useState. This effect reacts to subsequent changes from main process.
  }, [currentUrl, requestedUrl, isLoading, classicPayload.initialUrl]); // addressBarUrl removed from dependencies

  const handleLoadUrlCallback = useCallback(() => {
    let urlToLoad = addressBarUrl.trim();
    if (!urlToLoad) return;
    if (!urlToLoad.startsWith('http://') && !urlToLoad.startsWith('https://')) {
      urlToLoad = 'https://' + urlToLoad;
    }
    setAddressBarUrl(urlToLoad); // Update UI immediately
    
    console.log(`[ClassicBrowserHeader ${windowId}] Requesting load URL:`, urlToLoad);
    if (window.api && typeof window.api.classicBrowserLoadUrl === 'function') {
      const { updateWindowProps } = activeStore.getState();
      updateWindowProps(windowId, { payload: { ...classicPayload, isLoading: true, requestedUrl: urlToLoad, error: null } });

      window.api.classicBrowserLoadUrl(windowId, urlToLoad)
        .catch((err: Error) => {
          console.error(`[ClassicBrowserHeader ${windowId}] Error calling classicBrowserLoadUrl:`, err);
          updateWindowProps(windowId, { payload: { ...classicPayload, isLoading: false, error: err.message || 'Failed to load URL' } });
        });
    } else {
      console.warn(`[ClassicBrowserHeader ${windowId}] window.api.classicBrowserLoadUrl is not available.`);
      const { updateWindowProps } = activeStore.getState();
      updateWindowProps(windowId, { payload: { ...classicPayload, error: 'Browser API not available for URL loading.' } });
    }
  }, [addressBarUrl, windowId, activeStore, classicPayload]);

  const handleNavigateCallback = useCallback((action: 'back' | 'forward' | 'reload' | 'stop') => {
    console.log(`[ClassicBrowserHeader ${windowId}] Requesting navigation:`, action);
    if (window.api && typeof window.api.classicBrowserNavigate === 'function') {
      const { updateWindowProps } = activeStore.getState();
      if (action === 'reload') {
        updateWindowProps(windowId, { payload: { ...classicPayload, isLoading: true, error: null } });
      } else if (action === 'stop') {
         updateWindowProps(windowId, { payload: { ...classicPayload, isLoading: false } });
      }

      window.api.classicBrowserNavigate(windowId, action)
        .catch((err: Error) => {
          console.error(`[ClassicBrowserHeader ${windowId}] Error calling classicBrowserNavigate for ${action}:`, err);
          updateWindowProps(windowId, { payload: { ...classicPayload, isLoading: false, error: err.message || `Failed to ${action}` } });
        });
    } else {
      console.warn(`[ClassicBrowserHeader ${windowId}] window.api.classicBrowserNavigate is not available.`);
      const { updateWindowProps } = activeStore.getState();
      updateWindowProps(windowId, { payload: { ...classicPayload, error: 'Browser API not available.' } });
    }
  }, [windowId, activeStore, classicPayload]);

  return (
    <div className={cn(
      "flex flex-1 items-center gap-1 h-full",
      // The background will come from the WindowFrame's title bar area.
      // Specific backgrounds for elements like Input are handled below.
    )}>
      <Button variant="ghost" size="icon" onClick={() => handleNavigateCallback('back')} disabled={!canGoBack || isLoading} className="h-7 w-7">
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => handleNavigateCallback('forward')} disabled={!canGoForward || isLoading} className="h-7 w-7">
        <ArrowRight className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => handleNavigateCallback(isLoading ? 'stop' : 'reload')}
        className="h-7 w-7"
        aria-label={isLoading ? "Stop loading" : "Reload page"}
      >
        {isLoading ? <XCircle className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />}
      </Button>
      <Input
        value={addressBarUrl}
        onChange={e => setAddressBarUrl(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            handleLoadUrlCallback();
          }
        }}
        onMouseDownCapture={e => {
          e.stopPropagation();
        }}
        placeholder="Enter URL and press Enter"
        className="flex-1 h-7 rounded-sm text-sm px-2 bg-background/80 focus:bg-background"
      />
    </div>
  );
}; 