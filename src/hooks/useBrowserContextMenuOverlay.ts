"use client";

import { useState, useEffect, useCallback } from 'react';
import { BrowserContextMenuData } from '@shared/types';

export function useBrowserContextMenuOverlay(windowId: string) {
  const [contextMenuData, setContextMenuData] = useState<BrowserContextMenuData | null>(null);

  useEffect(() => {
    const handleShowMenu = (data: BrowserContextMenuData) => {
      if (data.windowId === windowId) {
        setContextMenuData(data);
      }
    };

    const handleHideMenu = (data: { windowId: string }) => {
      if (data.windowId === windowId) {
        setContextMenuData(null);
      }
    };

    // Subscribe to IPC events
    const unsubscribeShow = window.api?.browserContextMenu?.onShow(handleShowMenu);
    const unsubscribeHide = window.api?.browserContextMenu?.onHide(handleHideMenu);

    // Cleanup
    return () => {
      unsubscribeShow?.();
      unsubscribeHide?.();
    };
  }, [windowId]);

  const hideMenu = useCallback(() => {
    setContextMenuData(null);
    window.api?.browserContextMenu?.notifyClosed();
  }, []);

  return {
    contextMenuData,
    hideMenu
  };
}