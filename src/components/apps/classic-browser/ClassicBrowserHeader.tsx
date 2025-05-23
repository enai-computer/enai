"use client";

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ArrowRight, RotateCw, XCircle } from 'lucide-react';

// Placeholder for the actual hook - replace with real implementation later
const useClassicBrowserIpc = (windowId: string) => {
  console.log(`[ClassicBrowserHeader] useClassicBrowserIpc called for ${windowId}`);
  return {
    back: () => console.log(`[IPC ${windowId}] Back requested`),
    forward: () => console.log(`[IPC ${windowId}] Forward requested`),
    reload: () => console.log(`[IPC ${windowId}] Reload requested`),
    stop: () => console.log(`[IPC ${windowId}] Stop requested`),
    loadUrl: (url: string) => console.log(`[IPC ${windowId}] Load URL requested: ${url}`),
    // Placeholder for isLoading state, assuming it would come from the hook
    isLoading: false, 
  };
};

interface ClassicBrowserHeaderProps {
  windowId: string;
}

export const ClassicBrowserHeader: React.FC<ClassicBrowserHeaderProps> = ({ windowId }) => {
  const { back, forward, reload, stop, loadUrl, isLoading } = useClassicBrowserIpc(windowId);
  const [addressBarUrl, setAddressBarUrl] = useState('https://'); // Renamed from 'url' to 'addressBarUrl' for clarity

  const handleLoadUrl = useCallback(() => {
    let urlToLoad = addressBarUrl.trim();
    if (!urlToLoad) return;
    if (!urlToLoad.startsWith('http://') && !urlToLoad.startsWith('https://')) {
      urlToLoad = 'https://' + urlToLoad;
    }
    setAddressBarUrl(urlToLoad); // Update UI immediately
    loadUrl(urlToLoad);
  }, [addressBarUrl, loadUrl]);

  return (
    <>
      <Button variant="ghost" size="icon" onClick={back} className="h-7 w-7">
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={forward} className="h-7 w-7">
        <ArrowRight className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={isLoading ? stop : reload}
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
            handleLoadUrl();
          }
        }}
        placeholder="Enter URL and press Enter"
        className="flex-1 h-7 rounded-sm text-sm px-2" // Match styling from old toolbar
      />
    </>
  );
}; 