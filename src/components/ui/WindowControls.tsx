"use client";

import React, { useCallback } from 'react';
import type { StoreApi } from 'zustand';
import { Button } from './button';
import type { WindowStoreState } from '../../store/windowStoreFactory';
import { cn } from '@/lib/utils';

interface WindowControlsProps {
  id: string;
  // type: WindowContentType; // Will be used with useWindowControls hook later
  activeStore: StoreApi<WindowStoreState>;
  isFocused?: boolean;
}

export const WindowControls: React.FC<WindowControlsProps> = ({ id, activeStore, isFocused = true }) => {
  const { removeWindow, minimizeWindow } = activeStore.getState();

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent focus logic if clicking close
    
    const windowMeta = activeStore.getState().windows.find(w => w.id === id);

    removeWindow(id);
    
    if (windowMeta && windowMeta.type === 'classic-browser') {
      if (window.api && typeof window.api.classicBrowserDestroy === 'function') {
        window.api.classicBrowserDestroy(id)
          .catch(err => console.error(`[WindowControls ${id}] Error on classicBrowserDestroy:`, err));
      }
    }
  }, [removeWindow, id, activeStore]);

  const handleMinimize = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent focus logic if clicking minimize
    minimizeWindow(id);
  }, [minimizeWindow, id]);

  return (
    <div className="flex items-center gap-1 no-drag">
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-6 w-6", isFocused ? "text-step-11" : "text-step-9")}
        onClick={handleMinimize}
        aria-label="Minimize window"
      >
        <svg width="24" height="24" viewBox="3 3 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18.1257 10.9677L12.4266 10.9677L12.4266 5.26862L13.9172 5.26336V8.38151L17.2988 5L18.3943 6.09557L15.0128 9.47708L18.131 9.47708L18.1257 10.9677Z" fill="currentColor"/>
          <path d="M10.9677 18.1278L9.4771 18.133L9.47709 15.0149L6.09557 18.3964L5 17.3008L8.38152 13.9193L5.26335 13.9193L5.26862 12.4287L10.9677 12.4287L10.9677 18.1278Z" fill="currentColor"/>
        </svg>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-6 w-6", isFocused ? "text-step-11" : "text-step-9")}
        onClick={handleClose}
        aria-label="Close window"
      >
        <svg width="24" height="24" viewBox="3 3 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <mask id="path-1-outside-1_1540_239" maskUnits="userSpaceOnUse" x="5" y="5" width="13" height="13" fill="black">
            <rect fill="white" x="5" y="5" width="13" height="13"/>
            <path d="M16.575 17.6357L6 7.06066L7.06066 6L17.6357 16.575L16.575 17.6357ZM7.07646 17.6515L6.0158 16.5908L16.5908 6.0158L17.6515 7.07646L7.07646 17.6515Z"/>
          </mask>
          <path d="M16.575 17.6357L6 7.06066L7.06066 6L17.6357 16.575L16.575 17.6357ZM7.07646 17.6515L6.0158 16.5908L16.5908 6.0158L17.6515 7.07646L7.07646 17.6515Z" fill="currentColor"/>
          <path d="M16.575 17.6357L16.4689 17.7417L16.575 17.8478L16.6811 17.7417L16.575 17.6357ZM6 7.06066L5.89393 6.9546L5.78787 7.06066L5.89393 7.16673L6 7.06066ZM7.06066 6L7.16673 5.89393L7.06066 5.78787L6.9546 5.89393L7.06066 6ZM17.6357 16.575L17.7417 16.6811L17.8478 16.575L17.7417 16.4689L17.6357 16.575ZM7.07646 17.6515L6.97039 17.7575L7.07646 17.8636L7.18252 17.7575L7.07646 17.6515ZM6.0158 16.5908L5.90973 16.4847L5.80367 16.5908L5.90973 16.6969L6.0158 16.5908ZM16.5908 6.0158L16.6969 5.90974L16.5908 5.80367L16.4847 5.90974L16.5908 6.0158ZM17.6515 7.07646L17.7575 7.18253L17.8636 7.07646L17.7575 6.9704L17.6515 7.07646ZM16.6811 17.5296L6.10607 6.9546L5.89393 7.16673L16.4689 17.7417L16.6811 17.5296ZM6.10607 7.16673L7.16673 6.10607L6.9546 5.89393L5.89393 6.9546L6.10607 7.16673ZM6.9546 6.10607L17.5296 16.6811L17.7417 16.4689L7.16673 5.89393L6.9546 6.10607ZM17.5296 16.4689L16.4689 17.5296L16.6811 17.7417L17.7417 16.6811L17.5296 16.4689ZM7.18252 17.5454L6.12187 16.4847L5.90973 16.6969L6.97039 17.7575L7.18252 17.5454ZM6.12187 16.6969L16.6969 6.12187L16.4847 5.90974L5.90973 16.4847L6.12187 16.6969ZM16.4847 6.12187L17.5454 7.18253L17.7575 6.9704L16.6969 5.90974L16.4847 6.12187ZM17.5454 6.9704L6.97039 17.5454L7.18252 17.7575L17.7575 7.18253L17.5454 6.9704Z" fill="currentColor" mask="url(#path-1-outside-1_1540_239)"/>
        </svg>
      </Button>
    </div>
  );
}; 