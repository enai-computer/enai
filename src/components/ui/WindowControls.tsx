"use client";

import React, { useCallback } from 'react';
import type { StoreApi } from 'zustand';
import { XIcon, MinusIcon } from 'lucide-react';
import { Button } from './button';
import type { WindowStoreState } from '../../store/windowStoreFactory';

interface WindowControlsProps {
  id: string;
  // type: WindowContentType; // Will be used with useWindowControls hook later
  activeStore: StoreApi<WindowStoreState>;
}

export const WindowControls: React.FC<WindowControlsProps> = ({ id, activeStore }) => {
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
        className="h-6 w-6"
        onClick={handleMinimize}
        aria-label="Minimize window"
      >
        <MinusIcon className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={handleClose}
        aria-label="Close window"
      >
        <XIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}; 