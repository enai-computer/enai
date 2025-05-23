"use client";

import React, { useCallback } from 'react';
import type { StoreApi } from 'zustand';
import { XIcon } from 'lucide-react';
import { Button } from './button';
import type { WindowStoreState } from '../../store/windowStoreFactory';
import type { WindowContentType } from '../../../shared/types';

interface WindowControlsProps {
  id: string;
  // type: WindowContentType; // Will be used with useWindowControls hook later
  activeStore: StoreApi<WindowStoreState>;
}

export const WindowControls: React.FC<WindowControlsProps> = ({ id, activeStore }) => {
  const { removeWindow } = activeStore.getState();

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

  return (
    <div className="flex items-center no-drag">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6" // Consistent with existing styling in WindowFrame
        onClick={handleClose}
        aria-label="Close window"
      >
        <XIcon className="h-4 w-4" />
      </Button>
      {/* Minimize and Maximize buttons will be added later */}
    </div>
  );
}; 