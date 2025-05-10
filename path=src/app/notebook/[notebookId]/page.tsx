import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

import { createNotebookWindowStore, type WindowStoreState } from "@/store/windowStoreFactory";
import { WindowMeta, WindowContentType, WindowPayload } from '@/../shared/types.d';
import { WindowFrame } from '@/components/ui/WindowFrame';

// Child Component: Renders the actual workspace once store is ready
function NotebookWorkspace({ 
  notebookId, 
  activeStore 
}: { 
  notebookId: string, 
  activeStore: StoreApi<WindowStoreState> 
}) {
  // Hooks are called unconditionally here, and activeStore is guaranteed to be valid.
  const windows = useStore(activeStore, (state) => state.windows);
  const isHydrated = useStore(activeStore, (state) => 
    (state as any).persist?.hasHydrated?.() ?? false // Assuming persist middleware
  );

  // Guard: Ensure store is hydrated.
  if (!isHydrated) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-xl">Loading Notebook Workspace for {notebookId} (Hydrating...)</p>
      </div>
    );
  }

  // --- Main component logic using store values ---
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

// Parent Component (Page): Handles loading notebookId and store creation
export default function NotebookWorkspacePageLoader() {
  const params = useParams();
  const notebookIdFromParams = params.notebookId;

  const [notebookId, setNotebookId] = useState<string | null>(null);
  const [activeStore, setActiveStore] = useState<StoreApi<WindowStoreState> | null>(null);

  useEffect(() => {
    let id: string | null = null;
    if (typeof notebookIdFromParams === 'string' && notebookIdFromParams) {
      id = notebookIdFromParams;
    } else if (Array.isArray(notebookIdFromParams) && notebookIdFromParams.length > 0 && notebookIdFromParams[0]) {
      id = notebookIdFromParams[0];
    }
    setNotebookId(id);
  }, [notebookIdFromParams]);

  useEffect(() => {
    if (notebookId) {
      console.log(`[NotebookWorkspacePageLoader] Creating/getting store for notebookId: ${notebookId}`);
      const store = createNotebookWindowStore(notebookId);
      setActiveStore(store);
    } else {
      setActiveStore(null); 
    }
  }, [notebookId]);

  if (!notebookId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-xl">Resolving notebook...</p>
      </div>
    );
  }

  if (!activeStore) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-xl">Initializing workspace for {notebookId}...</p>
      </div>
    );
  }

  // Render the child component once notebookId and activeStore are ready
  return <NotebookWorkspace notebookId={notebookId} activeStore={activeStore} />;
} 