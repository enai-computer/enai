"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

import { createNotebookWindowStore, type WindowStoreState } from "@/store/windowStoreFactory";
import { WindowMeta, WindowContentType, WindowPayload } from '@/../shared/types.d';
import { WindowFrame } from '@/components/ui/WindowFrame'; // Import the actual WindowFrame component

// Remove the inline WindowFrame definition
// interface WindowFrameProps { ... }
// const WindowFrame = (...) => { ... };
// End Placeholder WindowFrame

export default function NotebookWorkspacePage() {
  const params = useParams();
  const notebookIdFromParams = params.notebookId;

  const [activeStore, setActiveStore] = useState<StoreApi<WindowStoreState> | null>(null);
  const [notebookId, setNotebookId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof notebookIdFromParams === 'string' && notebookIdFromParams) {
      setNotebookId(notebookIdFromParams);
    } else if (Array.isArray(notebookIdFromParams) && notebookIdFromParams.length > 0 && notebookIdFromParams[0]) {
      setNotebookId(notebookIdFromParams[0]);
    } else {
      setNotebookId(null); // Explicitly set to null if no valid ID
    }
  }, [notebookIdFromParams]);

  useEffect(() => {
    if (notebookId) {
      console.log(`[NotebookWorkspacePage] Creating/getting store for notebookId: ${notebookId}`);
      const store = createNotebookWindowStore(notebookId);
      setActiveStore(store);
    } else {
      setActiveStore(null);
    }
  }, [notebookId]);

  // Use useStore for reactive updates to windows
  const windows: WindowMeta[] = useStore(
    activeStore!,
    (state) => state?.windows ?? [], // Default to empty array if state is not yet available or store is null
    // The third argument for useStore is an equalityFn, not a conditional execution guard.
    // We will ensure activeStore is defined before this component part renders.
  );

  // Hydration guard
  const isHydrated: boolean = useStore(
    activeStore!,
    (state) => (state as any)?.persist?.hasHydrated?.() ?? false, // Default to false if not hydrated or store is null
  );

  const handleAddWindow = useCallback(() => {
    if (activeStore) {
      const currentWindows = activeStore.getState().windows; // Get current windows directly for positioning logic
      const newWindowType: WindowContentType = 'placeholder';
      const newWindowPayload: WindowPayload = { message: "I am a new placeholder window" };
      const x = (currentWindows.length % 5) * 210 + 50;
      const y = Math.floor(currentWindows.length / 5) * 210 + 50;
      
      // Call addWindow with the new single-object configuration
      activeStore.getState().addWindow({
        type: newWindowType,
        payload: newWindowPayload,
        preferredMeta: {
          x: x,
          y: y,
          // title, width, height can be added here to override store defaults
          // e.g., title: "My Custom Placeholder"
        }
      });
    }
  }, [activeStore]); // Removed windows from dependency array as it's now derived via useStore

  if (!notebookId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-xl">Resolving notebook...</p>
      </div>
    );
  }
  
  if (!activeStore || !isHydrated) { // Add isHydrated to the loading condition
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-xl">Loading Notebook Workspace for {notebookId} (Hydrating: {isHydrated ? 'Yes' : 'No'})...</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-gray-100 overflow-hidden">
      {/* Desktop Area */}
      <div className="absolute inset-0">
        {windows.map((windowMeta) => (
          <WindowFrame
            key={windowMeta.id}
            windowMeta={windowMeta}
            activeStore={activeStore}
          />
        ))}
      </div>

      {/* Floating Add Window Button for testing */}
      <button
        onClick={handleAddWindow}
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          zIndex: 10001, // Above most windows
          padding: '10px 15px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
          boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
        }}
      >
        Add Placeholder Window
      </button>
      
      {/* Old UI (like BookmarkUploadDialog) can be added back as windows later if needed */}
      {/* <BookmarkUploadDialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen} /> */}
    </div>
  );
} 