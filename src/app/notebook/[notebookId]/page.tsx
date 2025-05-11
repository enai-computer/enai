"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

import { createNotebookWindowStore, type WindowStoreState, notebookStores } from "@/store/windowStoreFactory";
import { WindowMeta, WindowContentType, WindowPayload } from '@/../shared/types.d';
import { WindowFrame } from '@/components/ui/WindowFrame';
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";

// Child Component: Renders the actual workspace once its store is initialized
function NotebookWorkspace({ notebookId }: { notebookId: string }) {
  // Initialize the store synchronously and once using useState initializer
  const [activeStore] = useState(() => createNotebookWindowStore(notebookId));
  const router = useRouter();

  // Hooks are called unconditionally here, and activeStore is guaranteed to be valid.
  const windows = useStore(activeStore, (state) => state.windows);
  const isHydrated = useStore(activeStore, (state) => state._hasHydrated);

  // Effect for handling window close/unload and main process flush requests
  useEffect(() => {
    // Handler for flushing all stores
    const flushAllStores = async () => {
      console.log('[NotebookWorkspace] Flushing all notebook stores...');
      const flushPromises: Promise<void>[] = [];
      notebookStores.forEach(store => {
        const persistApi = (store as any).persist; // Type assertion to access middleware API
        if (persistApi && typeof persistApi.flush === 'function') {
          flushPromises.push(persistApi.flush());
        } else {
          console.warn('[NotebookWorkspace] Store instance does not have a persist.flush method or persist API.', store);
        }
      });
      try {
        await Promise.all(flushPromises);
        console.log('[NotebookWorkspace] All notebook stores flushed successfully.');
      } catch (error) {
        console.error('[NotebookWorkspace] Error flushing notebook stores:', error);
      }
    };

    // Listener for 'beforeunload' event (browser tab/window close)
    const handleBeforeUnload = () => {
      console.log('[NotebookWorkspace] beforeunload event triggered. Flushing stores.');
      // Fire and forget for beforeunload, as it doesn't reliably await promises
      flushAllStores();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Listener for main process flush request
    if (window.api && typeof window.api.onMainRequestFlush === 'function') {
      window.api.onMainRequestFlush(async () => {
        console.log('[NotebookWorkspace] Received flush request from main process.');
        await flushAllStores(); // Await here as preload script handles sending completion
      });
      console.log('[NotebookWorkspace] Registered listener for main process flush requests.');
    } else {
      console.warn('[NotebookWorkspace] window.api.onMainRequestFlush is not available.');
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // No specific cleanup needed for onMainRequestFlush as it doesn't return a remover
      // and is intended as a global, app-lifecycle listener.
      console.log('[NotebookWorkspace] Cleanup: beforeunload listener removed. Main flush listener was global.');
    };
  }, []); // Empty dependency array: runs once on mount, cleans up on unmount

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

  const handleGoHome = useCallback(() => {
    router.push('/');
  }, [router]);

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
      <Button
        onClick={handleGoHome}
        variant="outline"
        size="icon"
        className="absolute bottom-5 right-5 rounded-full bg-stone-200 hover:bg-stone-300 dark:bg-stone-700 dark:hover:bg-stone-600 shadow-md"
        aria-label="Go to home page"
      >
        <Home className="h-5 w-5" />
      </Button>
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