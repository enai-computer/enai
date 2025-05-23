"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

import { createNotebookWindowStore, type WindowStoreState, notebookStores } from "@/store/windowStoreFactory";
import { WindowMeta, WindowContentType, WindowPayload } from '@/../shared/types.d';
import { WindowFrame } from '@/components/ui/WindowFrame';
import { AppSidebar } from '@/components/AppSidebar';
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { ChatWindow } from '@/components/apps/chat/ChatWindow';
import { ClassicBrowserViewWrapper } from '@/components/apps/classic-browser/ClassicBrowser';
import { ClassicBrowserHeader } from '@/components/apps/classic-browser/ClassicBrowserHeader';

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

  // Effect for handling WebContentsView focus events
  useEffect(() => {
    let unsubscribeFromFocus: (() => void) | undefined;

    if (window.api && typeof window.api.onClassicBrowserViewFocused === 'function') {
      unsubscribeFromFocus = window.api.onClassicBrowserViewFocused(({ windowId }) => {
        if (activeStore) { // Ensure activeStore is available
          console.log(`[NotebookWorkspace] Received classic-browser-view-focused for windowId: ${windowId}. Calling setWindowFocus.`);
          activeStore.getState().setWindowFocus(windowId);
        }
      });
    }

    return () => {
      if (unsubscribeFromFocus) {
        unsubscribeFromFocus();
      }
    };
  }, [activeStore]); // Depend on activeStore

  // MOVED UP: Define useCallback before any conditional returns.
  const handleAddWindow = useCallback(() => {
    const currentWindows = activeStore.getState().windows;
    const newWindowType: WindowContentType = 'classic-browser';
    const newWindowPayload: WindowPayload = {
      initialUrl: 'https://duckduckgo.com',
      currentUrl: '',
      requestedUrl: 'https://duckduckgo.com',
      isLoading: true,
      canGoBack: false,
      canGoForward: false,
      error: null,
      title: 'New Browser'
    };
    const x = (currentWindows.length % 5) * 210 + 50;
    const y = Math.floor(currentWindows.length / 5) * 210 + 50;
    
    activeStore.getState().addWindow({
      type: newWindowType,
      payload: newWindowPayload,
      preferredMeta: { x, y, width: 500, height: 400 }
    });
  }, [activeStore]);

  const handleAddChatWindow = useCallback(() => {
    const currentWindows = activeStore.getState().windows;
    const newWindowType: WindowContentType = 'chat';
    // For a new chat, we'd typically get a sessionId from the backend/service
    // For now, let's generate a client-side placeholder UUID.
    // In a real scenario, this might involve an IPC call to a ChatService to create a session.
    const newSessionId = crypto.randomUUID(); 
    const newWindowPayload: WindowPayload = {
      sessionId: newSessionId,
    };
    const x = (currentWindows.length % 5) * 210 + 100; // Offset slightly from browser
    const y = Math.floor(currentWindows.length / 5) * 210 + 100; // Offset slightly
    
    activeStore.getState().addWindow({
      type: newWindowType,
      payload: newWindowPayload,
      preferredMeta: { 
        title: "New Chat", // Title should be within preferredMeta
        x, 
        y, 
        width: 400, 
        height: 600 
      }
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
    <SidebarProvider defaultOpen={false}>
      <div className="relative w-full h-screen bg-step-1 flex">
        <AppSidebar 
          onAddChat={handleAddChatWindow}
          onAddBrowser={handleAddWindow}
          onGoHome={handleGoHome}
        />
        <SidebarInset className="relative overflow-hidden">
          {/* SidebarTrigger removed but can be re-added here if needed */}
          <div className="absolute inset-0">
            {windows.map((windowMeta) => {
              let content = null;
              let header: React.ReactNode = undefined;

              switch (windowMeta.type) {
                case 'chat':
                  content = (
                    <ChatWindow
                      payload={windowMeta.payload as WindowPayload['chat']}
                      windowId={windowMeta.id}
                      notebookId={notebookId}
                    />
                  );
                  break;
                case 'classic-browser':
                  header = <ClassicBrowserHeader windowId={windowMeta.id} />;
                  content = (
                    <ClassicBrowserViewWrapper
                      windowMeta={windowMeta}
                      activeStore={activeStore}
                      contentGeometry={{ 
                        // These are illustrative. WindowFrame calculates the true contentGeometry.
                        // ClassicBrowserViewWrapper primarily uses its ref for bounds now.
                        contentX: 0, contentY: 0, contentWidth: 0, contentHeight: 0 
                      }}
                      isActuallyVisible={windowMeta.isFocused && !windowMeta.isMinimized}
                    />
                  );
                  break;
                default:
                  content = (
                    <div className="p-4">
                      <p className="text-xs text-step-10">ID: {windowMeta.id}</p>
                      <p className="text-sm">Unhandled Type: {windowMeta.type}</p>
                      <p className="text-sm">Payload: {JSON.stringify(windowMeta.payload)}</p>
                    </div>
                  );
              }

              return (
                <WindowFrame
                  key={windowMeta.id}
                  windowMeta={windowMeta}
                  activeStore={activeStore}
                  notebookId={notebookId}
                  headerContent={header}
                >
                  {content}
                </WindowFrame>
              );
            })}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
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