"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { BrowserContextMenu } from "@/components/ui/browser-context-menu";
import { useBrowserContextMenuOverlay } from "@/hooks/useBrowserContextMenuOverlay";

export default function OverlayPage() {
  const params = useParams();
  const windowId = params.windowId as string;
  const { contextMenuData, hideMenu } = useBrowserContextMenuOverlay(windowId);

  useEffect(() => {
    // Set transparent background and make click-through by default
    document.body.style.backgroundColor = "transparent";
    document.body.style.pointerEvents = "none";
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.inset = "0";

    // Notify main process that overlay is ready
    window.api?.browserContextMenu?.notifyReady();

    return () => {
      // Cleanup
      document.body.style.backgroundColor = "";
      document.body.style.pointerEvents = "";
    };
  }, []);

  if (!contextMenuData) {
    return null;
  }

  return (
    <BrowserContextMenu
      contextData={contextMenuData}
      onClose={hideMenu}
    />
  );
}