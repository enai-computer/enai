"use client";

import React, { useState, useCallback, useEffect, useRef } from 'react';
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
  const [addressBarUrl, setAddressBarUrl] = useState<string>(classicPayload.requestedUrl || classicPayload.currentUrl || classicPayload.initialUrl || 'https://');
  
  const { isFocused: isWindowFocused } = windowMeta; // Renamed to avoid conflict
  const [inputWidthClass, setInputWidthClass] = useState('flex-1');
  const parentRef = useRef<HTMLDivElement>(null);

  const [isInputHovered, setIsInputHovered] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Derived state from classicPayload for UI binding
  const {
    currentUrl = '',
    requestedUrl = '',
    isLoading = false,
    canGoBack = false,
    canGoForward = false,
    title: pageTitle = '', // Added pageTitle from classicPayload
  } = classicPayload;

  // Effect to sync addressBarUrl with payload changes from main process
  // This should happen when the input is NOT focused, to avoid overriding user typing.
  useEffect(() => {
    if (!isInputFocused) {
      const newUrlToShow = isLoading ? requestedUrl : currentUrl;
      if (newUrlToShow && newUrlToShow !== addressBarUrl) {
        setAddressBarUrl(newUrlToShow);
      } else if (!newUrlToShow && classicPayload.initialUrl && classicPayload.initialUrl !== addressBarUrl) {
        // Fallback to initialUrl if current/requested are empty (e.g. new tab)
        setAddressBarUrl(classicPayload.initialUrl);
      }
    }
  }, [currentUrl, requestedUrl, isLoading, classicPayload.initialUrl, isInputFocused]);

  // Effect to observe parent width and set input class
  useEffect(() => {
    const parentElement = parentRef.current;
    if (!parentElement) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
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
    <div 
      ref={parentRef} // Assign ref to the parent div
      className={cn(
      "flex flex-1 items-center gap-1 h-full",
      // The background will come from the WindowFrame's title bar area.
      // Specific backgrounds for elements like Input are handled below.
    )}>
      <Button variant="ghost" size="icon" onClick={() => handleNavigateCallback('back')} disabled={!canGoBack || isLoading} className={cn("h-7 w-7", "no-drag")}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => handleNavigateCallback('forward')} disabled={!canGoForward || isLoading} className={cn("h-7 w-7", "no-drag")}>
        <ArrowRight className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => handleNavigateCallback(isLoading ? 'stop' : 'reload')}
        className={cn("h-7 w-7", "no-drag")}
        aria-label={isLoading ? "Stop loading" : "Reload page"}
      >
        {isLoading ? <XCircle className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />}
      </Button>
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
            handleLoadUrlCallback();
            // Optional: Blur input after enter to show title again if not hovered
            // e.currentTarget.blur(); 
          }
        }}
        onFocus={() => setIsInputFocused(true)}
        onBlur={() => {
          setIsInputFocused(false);
          // If not hovering when blurred, revert to title display
          if (!isInputHovered) setAddressBarUrl(currentUrl || requestedUrl || 'https://');
        }}
        onMouseEnter={() => setIsInputHovered(true)}
        onMouseLeave={() => setIsInputHovered(false)}
        onMouseDownCapture={e => {
          e.stopPropagation();
        }}
        placeholder={isInputHovered || isInputFocused ? "Enter URL and press Enter" : (pageTitle || "Enter URL and press Enter")}
        className={cn(
          "h-7 rounded-sm text-sm px-2 bg-step-1/80 focus:bg-step-1",
          inputWidthClass,
          // Conditionally apply border styles
          (isInputHovered || isInputFocused) ? 
            "border border-step-6 focus-visible:border-step-8 focus-visible:ring-step-8/50 focus-visible:ring-[3px]" : 
            "border-none shadow-none"
        )}
        title={addressBarUrl} // Tooltip always shows the actual URL
      />
    </div>
  );
}; 