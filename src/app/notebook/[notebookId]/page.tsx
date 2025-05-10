"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

import { createNotebookWindowStore, type WindowStoreState } from "@/store/windowStoreFactory";
import { WindowMeta, WindowContentType, WindowPayload } from '@/../shared/types.d';
import { WindowFrame } from '@/components/ui/WindowFrame';

// Child Component: Renders the actual workspace once its store is initialized
function NotebookWorkspace({ notebookId }: { notebookId: string }) {
  // Initialize the store synchronously and once using useState initializer
  const [activeStore] = useState(() => createNotebookWindowStore(notebookId));

  // Hooks are called unconditionally here, and activeStore is guaranteed to be valid.
  const windows = useStore(activeStore, (state) => state.windows);
  const isHydrated = useStore(activeStore, (state) => state._hasHydrated);

  // MOVED UP: Define useCallback before any conditional returns.
  const handleAddWindow = useCallback(() => {
    const currentWindows = activeStore.getState().windows;
    const newWindowType: WindowContentType = 'placeholder';
    const newWindowPayload: WindowPayload = { message: "I am a new placeholder window" };
    const x = (currentWindows.length % 5) * 210 + 50;
    const y = Math.floor(currentWindows.length / 5) * 210 + 50;
    
    activeStore.getState().addWindow({
      type: newWindowType,
      payload: newWindowPayload,
      preferredMeta: { x, y }
    });
  }, [activeStore]);

  // Guard: Ensure store is hydrated.
  if (!isHydrated) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-xl">Loading Notebook Workspace for {notebookId} (Hydrating...)</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-gray-100 overflow-hidden">
      <div className="absolute inset-0">
        {windows.map((windowMeta) => (
          <WindowFrame
            key={windowMeta.id}
            windowMeta={windowMeta}
            activeStore={activeStore}
          />
        ))}
      </div>
      <button
        onClick={handleAddWindow}
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          zIndex: 10001, 
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
    </div>
  );
}

// Parent Component (Page): Handles loading notebookId and then renders the workspace child
export default function NotebookWorkspacePageLoader() {
  const params = useParams();
  const notebookIdFromParams = params.notebookId;
  const [notebookId, setNotebookId] = useState<string | null>(null);

  useEffect(() => {
    let id: string | null = null;
    if (typeof notebookIdFromParams === 'string' && notebookIdFromParams) {
      id = notebookIdFromParams;
    } else if (Array.isArray(notebookIdFromParams) && notebookIdFromParams.length > 0 && notebookIdFromParams[0]) {
      id = notebookIdFromParams[0];
    }
    if (id) {
      console.log(`[NotebookWorkspacePageLoader] Resolved notebookId: ${id}`);
      setNotebookId(id);
    } else {
      console.warn('[NotebookWorkspacePageLoader] Could not resolve notebookId from params:', notebookIdFromParams);
      setNotebookId(null);
    }
  }, [notebookIdFromParams]);

  if (!notebookId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-xl">Resolving notebook...</p>
      </div>
    );
  }

  // Render the child component once notebookId is ready
  // The child will handle its own store creation and hydration state.
  return <NotebookWorkspace notebookId={notebookId} />;
} 