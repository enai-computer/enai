"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useHashRouter } from "@/hooks/useHashRouter";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";
import { motion } from "framer-motion";

import { createNotebookWindowStore, type WindowStoreState, notebookStores } from "@/store/windowStoreFactory";
import { WindowMeta, WindowContentType, WindowPayload, IntentResultPayload, ClassicBrowserPayload, ClassicBrowserStateUpdate } from '../../shared/types';
import { WindowFrame } from '@/components/ui/WindowFrame';
import { AppSidebar } from '@/components/AppSidebar';
import { SidebarProvider, SidebarInset, useSidebar } from "@/components/ui/sidebar";
import { IntentLine } from "@/components/ui/intent-line";
import { CornerMasks } from "@/components/ui/corner-masks";
import { HumanComputerIcon } from "@/components/HumanComputerIcon";
import { NotebookInfoPill } from "@/components/ui/notebook-info-pill";

// Component that has access to sidebar context
function NotebookContent({ 
  windows, 
  activeStore, 
  notebookId,
  notebookTitle,
  setNotebookTitle,
  onAddChat,
  onAddBrowser,
  onGoHome,
  notebookIntentText,
  setNotebookIntentText,
  handleNotebookIntentSubmit,
  isNotebookIntentProcessing,
  isReady,
  isIntentLineVisible,
  setIsIntentLineVisible
}: {
  windows: WindowMeta[];
  activeStore: StoreApi<WindowStoreState>;
  notebookId: string;
  notebookTitle: string;
  setNotebookTitle: (title: string) => void;
  onAddChat: () => void;
  onAddBrowser: () => void;
  onGoHome: () => void;
  notebookIntentText: string;
  setNotebookIntentText: (text: string) => void;
  handleNotebookIntentSubmit: () => void;
  isNotebookIntentProcessing: boolean;
  isReady: boolean;
  isIntentLineVisible: boolean;
  setIsIntentLineVisible: (visible: boolean) => void;
}) {
  const { state: sidebarState, isHovered: isSidebarHovered } = useSidebar();
  const [isPillHovered, setIsPillHovered] = useState(false);
  const [isPillClicked, setIsPillClicked] = useState(false);
  const [isNotebookDropdownOpen, setIsNotebookDropdownOpen] = useState(false);
  const intentLineRef = useRef<HTMLInputElement>(null);
  
  // Focus intent line when it becomes visible
  useEffect(() => {
    if (isIntentLineVisible && intentLineRef.current) {
      // Small delay to ensure the element is rendered
      setTimeout(() => {
        intentLineRef.current?.focus();
      }, 50);
    }
  }, [isIntentLineVisible]);
  
  // When clicked elsewhere, remove the clicked state
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.notebook-info-pill-container')) {
        setIsPillClicked(false);
      }
    };
    
    if (isPillClicked) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isPillClicked]);
  
  // Handle sidebar hover to freeze/unfreeze active browser window
  useEffect(() => {
    // Find the active (focused) browser window
    const activeWindow = windows.find(w => w.isFocused && w.type === 'classic-browser');
    
    if (activeWindow) {
      const currentPayload = activeWindow.payload as ClassicBrowserPayload;
      
      // Check if window was recently restored (within 1000ms grace period)
      const isRecentlyRestored = activeWindow.restoredAt && 
        (Date.now() - activeWindow.restoredAt) < 1000;
      
      if ((isSidebarHovered || isNotebookDropdownOpen || isIntentLineVisible) && !isRecentlyRestored) {
        // Sidebar is hovered OR notebook dropdown is open OR intent line is visible - freeze the active browser window if it's not already frozen
        // and it wasn't just restored
        if (currentPayload.freezeState?.type === 'ACTIVE') {
          const reason = isSidebarHovered ? 'Sidebar hovered' : 
                        isNotebookDropdownOpen ? 'Notebook dropdown open' : 
                        'Intent line visible';
          console.log(`[NotebookContent] ${reason}, freezing active browser window ${activeWindow.id}`);
          activeStore.getState().updateWindowProps(activeWindow.id, {
            payload: {
              ...currentPayload,
              freezeState: { type: 'CAPTURING' }
            }
          });
        }
      } else {
        // None of the triggers are active OR window was recently restored - unfreeze the active browser window if it's frozen
        if (currentPayload.freezeState?.type !== 'ACTIVE') {
          const reason = isRecentlyRestored ? 'Window recently restored' : 'All triggers inactive';
          console.log(`[NotebookContent] ${reason}, unfreezing active browser window ${activeWindow.id}`);
          activeStore.getState().updateWindowProps(activeWindow.id, {
            payload: {
              ...currentPayload,
              freezeState: { type: 'ACTIVE' }
            }
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSidebarHovered, isNotebookDropdownOpen, isIntentLineVisible, activeStore]);
  
  console.log(`[NotebookContent] Rendering with ${windows.length} windows:`, {
    notebookId,
    windowCount: windows.length,
    sidebarState,
    isSidebarHovered,
    timestamp: new Date().toISOString()
  });

  const handleNotebookTitleChange = async (newTitle: string) => {
    try {
      if (window.api?.updateNotebook) {
        await window.api.updateNotebook({ 
          id: notebookId, 
          data: { title: newTitle } 
        });
        // Update the local state to reflect the change immediately
        setNotebookTitle(newTitle);
        console.log(`[NotebookContent] Updated notebook title to: ${newTitle}`);
      }
    } catch (error) {
      console.error('[NotebookContent] Failed to update notebook title:', error);
      // Could show an error toast here
    }
  };
  
  return (
    <>
      <CornerMasks />
      <motion.div 
        className="relative w-full h-screen bg-step-1 flex"
        initial={{ opacity: 0 }}
        animate={{ opacity: isReady ? 1 : 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <SidebarInset className="relative overflow-hidden">
          {/* SidebarTrigger removed but can be re-added here if needed */}
          
          
          <div className="absolute inset-0">
            {windows.map((windowMeta) => {
              console.log(`[NotebookContent] Rendering window:`, {
                windowId: windowMeta.id,
                type: windowMeta.type,
                payload: windowMeta.payload,
                timestamp: new Date().toISOString()
              });
              let content = null;

              switch (windowMeta.type) {
                case 'chat':
                  // Content will be handled by WindowFrame directly
                  break;
                case 'classic-browser':
                  // Content will be handled by WindowFrame directly
                  break;
                case 'note_editor':
                  // Content will be handled by WindowFrame directly
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
                  sidebarState={sidebarState}
                >
                  {content}
                </WindowFrame>
              );
            })}
          </div>
        </SidebarInset>
        <AppSidebar 
          onAddChat={onAddChat}
          onAddBrowser={onAddBrowser}
          onGoHome={onGoHome}
          windows={windows}
          activeStore={activeStore}
          notebookId={notebookId}
        />
      </motion.div>
      
      {/* Notebook info pill positioned at top left */}
      {notebookTitle && (
        <motion.div 
          className="notebook-info-pill-container fixed top-1 left-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: isReady ? 1 : 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          style={{ 
            zIndex: isPillHovered || isPillClicked ? 10000 : 5,
            transition: 'z-index 0.2s ease'
          }}
          onMouseEnter={() => setIsPillHovered(true)}
          onMouseLeave={() => setIsPillHovered(false)}
          onClick={() => setIsPillClicked(true)}
        >
          <NotebookInfoPill 
            title={notebookTitle} 
            onTitleChange={handleNotebookTitleChange}
            parentZIndex={isPillHovered || isPillClicked ? 10000 : 5}
            onDropdownOpenChange={setIsNotebookDropdownOpen}
          />
        </motion.div>
      )}
      
      {/* Fixed IntentLine at the bottom left to match homepage position */}
      {/* Intent line is outside the motion div to remain visible during transition */}
      {/* Homepage uses grid-cols-[2fr_1fr] with px-16 in left column, so intent line width is 2/3 - 128px */}
      <div 
        className="fixed bottom-4 left-4 flex items-center"
        style={{ 
          zIndex: isIntentLineVisible ? 10000 : 5,
          transition: 'z-index 0.2s ease'
        }}
      >
        <HumanComputerIcon 
          onClick={() => setIsIntentLineVisible(!isIntentLineVisible)}
          isActive={isIntentLineVisible}
        />
        <div 
          className={`overflow-hidden transition-all duration-300 ease-out ${
            isIntentLineVisible ? 'w-[calc(66.666667vw-80px)] ml-3' : 'w-0 ml-0'
          }`}
        >
          <IntentLine
            ref={intentLineRef}
            type="text"
            value={notebookIntentText}
            onChange={(e) => setNotebookIntentText(e.target.value)}
            transcribeAudio={typeof window !== 'undefined' ? window.api.audio.transcribe : undefined}
            placeholder={`Ask or command within this notebook...`}
            className="w-full text-lg md:text-lg text-step-12 bg-transparent border-0 border-b-[1.5px] border-step-12/30 focus:ring-0 focus:border-step-12/50 placeholder:text-step-12"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleNotebookIntentSubmit();
              }
              if (e.key === 'Escape') {
                setIsIntentLineVisible(false);
              }
            }}
            disabled={isNotebookIntentProcessing}
            autoFocus={isIntentLineVisible}
          />
        </div>
      </div>
    </>
  );
}

// Child Component: Renders the actual workspace once its store is initialized
function NotebookWorkspace({ notebookId }: { notebookId: string }) {
  // Initialize the store synchronously and once using useState initializer
  const [activeStore] = useState(() => {
    console.log(`[NotebookWorkspace] Creating store for notebook ${notebookId}`);
    return createNotebookWindowStore(notebookId);
  });
  const router = useHashRouter();

  // Hooks are called unconditionally here, and activeStore is guaranteed to be valid.
  const windows = useStore(activeStore, (state) => state.windows);
  const isHydrated = useStore(activeStore, (state) => state._hasHydrated);
  
  console.log(`[NotebookWorkspace] Notebook ${notebookId} state:`, {
    isHydrated,
    windowCount: windows.length,
    windows: windows.map(w => ({ id: w.id, type: w.type })),
    timestamp: new Date().toISOString()
  });
  
  // State for notebook intent line
  const [notebookIntentText, setNotebookIntentText] = useState('');
  const [isNotebookIntentProcessing, setIsNotebookIntentProcessing] = useState(false);
  const [isIntentLineVisible, setIsIntentLineVisible] = useState(false);
  
  // State for transition animation with smart timing
  const [isReady, setIsReady] = useState(false);
  const [loadStartTime] = useState(Date.now());
  
  // State for notebook data
  const [notebookTitle, setNotebookTitle] = useState<string>("");
  
  // Track previous window order to detect changes
  const prevWindowOrderRef = useRef<Array<{ id: string; isFrozen: boolean; isMinimized: boolean }>>([]);
  // Track if we've already synced window order to avoid duplicate calls
  const hasSyncedWindowOrderRef = useRef(false);
  
  // Fetch notebook details to trigger activity logging
  useEffect(() => {
    const fetchNotebook = async () => {
      try {
        if (window.api?.getNotebookById) {
          console.log(`[NotebookWorkspace] Fetching notebook details for ID: ${notebookId}`);
          const notebook = await window.api.getNotebookById(notebookId);
          if (notebook) {
            console.log(`[NotebookWorkspace] Successfully fetched notebook: ${notebook.title}`);
            setNotebookTitle(notebook.title);
          } else {
            console.warn(`[NotebookWorkspace] Notebook not found for ID: ${notebookId}`);
          }
        } else {
          console.warn("[NotebookWorkspace] window.api.getNotebookById is not available.");
        }
      } catch (error) {
        console.error(`[NotebookWorkspace] Failed to fetch notebook details:`, error);
      }
    };
    
    fetchNotebook();
  }, [notebookId]);

  // Hotkey handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // CMD+T: Open new tab in existing browser or create new browser
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        console.log('[Hotkey] CMD+T: Handling new tab/browser request');
        
        // Check for existing classic-browser windows
        const existingBrowser = windows.find(w => w.type === 'classic-browser' && !w.isMinimized);
        
        if (existingBrowser) {
          // Open a new tab in the existing browser
          console.log('[Hotkey] CMD+T: Opening new tab in existing browser', existingBrowser.id);
          if (window.api?.classicBrowserCreateTab) {
            window.api.classicBrowserCreateTab(existingBrowser.id, 'https://www.are.na')
              .then(result => {
                if (!result.success) {
                  console.error('[Hotkey] Failed to create new tab:', result.error);
                }
              })
              .catch(err => {
                console.error('[Hotkey] Error creating new tab:', err);
              });
          }
        } else {
          // No existing browser, create a new one
          console.log('[Hotkey] CMD+T: No existing browser, creating new browser window');
          
          const newWindowPayload: ClassicBrowserPayload = {
            initialUrl: 'https://www.are.na',
            tabs: [], // Start with empty tabs - backend will create the initial tab
            activeTabId: '',
            freezeState: { type: 'ACTIVE' } // Start in active state
          };
          
          // Calculate bounds
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          const sidebarWidth = 48;
          
          activeStore.getState().addWindow({
            type: 'classic-browser',
            payload: newWindowPayload,
            preferredMeta: { 
              x: 18, 
              y: 18,
              width: viewportWidth - sidebarWidth - 18 - 18, 
              height: viewportHeight - 18 - 60,
              title: "Browser"
            }
          });
        }
      }
      
      // CMD+/: Toggle intent line
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        console.log('[Hotkey] CMD+/: Toggling intent line');
        setIsIntentLineVisible(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [windows, activeStore, setIsIntentLineVisible]);
  
  // Create a stable key representing the window order and states
  const windowOrderKey = useMemo(() => {
    return windows
      .slice() // Don't mutate original
      .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
      .map(w => {
        // Determine freeze state for classic-browser windows
        let freezeState = 'ACTIVE';
        if (w.type === 'classic-browser') {
          const payload = w.payload as ClassicBrowserPayload;
          freezeState = payload.freezeState?.type || 'ACTIVE';
        }
        return `${w.id}:${w.zIndex || 0}:${freezeState}:${!!w.isMinimized}`;
      })
      .join('|');
  }, [windows]);
  
  // Synchronize window stacking order with native WebContentsViews
  useEffect(() => {
    if (!window.api?.syncWindowStackOrder) return;
    
    // Get fresh windows data from store without depending on it
    const currentWindows = activeStore.getState().windows;
    if (currentWindows.length === 0) return;
    
    // Sort windows by z-index to get the correct stacking order
    const sortedWindows = [...currentWindows]
      .sort((a, b) => a.zIndex - b.zIndex)
      .map(w => {
        // Derive isFrozen from the state machine for classic-browser windows
        let isFrozen = false;
        if (w.type === 'classic-browser') {
          const payload = w.payload as ClassicBrowserPayload;
          if (payload.freezeState) {
            // Window should be frozen (hidden) when not in ACTIVE state
            isFrozen = payload.freezeState.type !== 'ACTIVE';
          }
        }
        
        return {
          id: w.id,
          isFrozen,
          isMinimized: w.isMinimized || false
        };
      });
    
    console.log('[NotebookWorkspace] Window order changed, syncing with native views:', sortedWindows);
    
    // For initial load, sync immediately; for subsequent changes, debounce
    const isInitialLoad = prevWindowOrderRef.current.length === 0 && sortedWindows.length > 0;
    const syncDelay = isInitialLoad ? 0 : 100;
    
    const timeoutId = setTimeout(() => {
      window.api.syncWindowStackOrder(sortedWindows)
        .then(() => {
          console.log('[NotebookWorkspace] Successfully synced window stack order');
          prevWindowOrderRef.current = sortedWindows;
          hasSyncedWindowOrderRef.current = true;
        })
        .catch((error) => {
          console.error('[NotebookWorkspace] Failed to sync window stack order:', error);
        });
    }, syncDelay);
    
    return () => clearTimeout(timeoutId);
  }, [windowOrderKey, activeStore]); // Only depend on windowOrderKey and activeStore - we get fresh windows via getState()

  // Global shortcut handler for minimizing window
  useEffect(() => {
    if (window.api?.onShortcutMinimizeWindow) {
      const unsubscribe = window.api.onShortcutMinimizeWindow(() => {
        console.log('[Shortcut] Received minimize window command.');
        const focusedWindow = activeStore.getState().windows.find(w => w.isFocused);
        if (focusedWindow) {
          console.log(`[Shortcut] Toggling minimize for focused window ${focusedWindow.id}`);
          activeStore.getState().toggleMinimize(focusedWindow.id);
        }
      });
      return () => unsubscribe();
    }
  }, [activeStore]);

  // Global shortcut handler for closing active window/tab
  useEffect(() => {
    if (window.api?.onCloseActiveRequested) {
      const unsubscribe = window.api.onCloseActiveRequested(() => {
        console.log('[Shortcut] Received close active window/tab command.');
        const { windows, removeWindow } = activeStore.getState();
        const focusedWindow = windows.find(w => w.isFocused);
        
        if (!focusedWindow) {
          console.log('[Shortcut] No focused window found.');
          return;
        }
        
        console.log(`[Shortcut] Processing close for window ${focusedWindow.id} of type ${focusedWindow.type}`);
        
        if (focusedWindow.type === 'classic-browser') {
          // For browser windows, close the active tab
          const payload = focusedWindow.payload as ClassicBrowserPayload;
          
          if (payload.tabs.length > 1) {
            // Close the active tab
            console.log(`[Shortcut] Closing active tab ${payload.activeTabId} in browser window ${focusedWindow.id}`);
            if (window.api?.classicBrowserCloseTab) {
              window.api.classicBrowserCloseTab(focusedWindow.id, payload.activeTabId)
                .then(result => {
                  if (!result.success) {
                    console.error('[Shortcut] Failed to close tab:', result.error);
                  }
                })
                .catch(err => {
                  console.error('[Shortcut] Error closing tab:', err);
                });
            }
          } else {
            // Last tab, close the window
            console.log(`[Shortcut] Closing browser window ${focusedWindow.id} (last tab)`);
            removeWindow(focusedWindow.id);
          }
        } else {
          // For non-browser windows, close the window directly
          console.log(`[Shortcut] Closing window ${focusedWindow.id}`);
          removeWindow(focusedWindow.id);
        }
      });
      return () => unsubscribe();
    }
  }, [activeStore]);


  // Effect for smart transition timing
  useEffect(() => {
    console.log(`[NotebookWorkspace] Mounted notebook ${notebookId} with ${windows.length} windows`);
    
    if (isHydrated) {
      // Calculate how long hydration took
      const hydrationTime = Date.now() - loadStartTime;
      const minimumAnimationTime = 600; // Reduced from 800ms for faster but still smooth transition
      
      console.log(`[NotebookWorkspace] Hydration completed in ${hydrationTime}ms`);
      
      // If hydration was fast, wait for remaining animation time
      // If hydration was slow, proceed immediately
      const remainingTime = Math.max(0, minimumAnimationTime - hydrationTime);
      
      console.log(`[NotebookWorkspace] Waiting ${remainingTime}ms before showing content`);
      
      const readyTimer = setTimeout(() => {
        setIsReady(true);
        console.log(`[NotebookWorkspace] Transition ready, starting fade-in`);
        
        // Force a sync of window stack order after hydration completes
        // This ensures WebContentsViews are properly ordered on initial load
        if (windows.length > 0 && window.api?.syncWindowStackOrder) {
          const sortedWindows = [...windows]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map(w => {
              let isFrozen = false;
              if (w.type === 'classic-browser') {
                const payload = w.payload as ClassicBrowserPayload;
                if (payload.freezeState) {
                  // Window should be frozen (hidden) when not in ACTIVE state
                  isFrozen = payload.freezeState.type !== 'ACTIVE';
                }
              }
              return {
                id: w.id,
                isFrozen,
                isMinimized: w.isMinimized || false
              };
            });
          
          // Only sync if we haven't already synced in the main effect
          if (!hasSyncedWindowOrderRef.current) {
            console.log('[NotebookWorkspace] Post-hydration sync of window stack order');
            window.api.syncWindowStackOrder(sortedWindows).catch((error) => {
              console.error('[NotebookWorkspace] Failed to sync window stack order after hydration:', error);
            });
          } else {
            console.log('[NotebookWorkspace] Skipping post-hydration sync - already synced in main effect');
          }
        }
      }, remainingTime);
      
      return () => {
        clearTimeout(readyTimer);
        console.log(`[NotebookWorkspace] Unmounting notebook ${notebookId}. Windows will be persisted.`);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId, isHydrated, loadStartTime, windows.length]);

  // Effect for handling window close/unload and main process flush requests
  useEffect(() => {
    // Handler for flushing all stores
    const flushAllStores = async () => {
      console.log('[NotebookWorkspace] Flushing all notebook stores...');
      const flushPromises: Promise<void>[] = [];
      notebookStores.forEach(store => {
        const persistApi = (store as StoreApi<WindowStoreState> & { persist?: { flush?: () => Promise<void> } }).persist;
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

  // NOTE: Removed onClassicBrowserViewFocused listener to prevent focus feedback loop.
  // With the new controller pattern, all focus changes originate from the frontend.

  // Centralized effect to subscribe to state updates from all classic browser windows
  useEffect(() => {
    if (window.api && typeof window.api.onClassicBrowserState === 'function') {
      const unsubscribe = window.api.onClassicBrowserState((update: ClassicBrowserStateUpdate) => {
        console.log(`[NotebookWorkspace] Received state update for window ${update.windowId}:`, update.update);
        const { updateWindowProps, windows } = activeStore.getState();
        const currentWindow = windows.find(w => w.id === update.windowId);
        if (currentWindow && currentWindow.type === 'classic-browser') {
          // Complete state replacement - use the tabs and activeTabId from the update
          const newPayload: ClassicBrowserPayload = {
            ...currentWindow.payload as ClassicBrowserPayload,
            tabs: update.update.tabs || [],
            activeTabId: update.update.activeTabId || '',
            tabGroupTitle: update.update.tabGroupTitle !== undefined ? update.update.tabGroupTitle : (currentWindow.payload as ClassicBrowserPayload).tabGroupTitle
          };

          // Get the window title - prefer tab group title, fallback to active tab title
          const activeTab = newPayload.tabs.find(t => t.id === newPayload.activeTabId);
          const newWindowTitle = newPayload.tabGroupTitle || activeTab?.title || currentWindow.title;

          console.log(`[NotebookWorkspace] Updating window ${update.windowId} with ${newPayload.tabs.length} tabs, active: ${newPayload.activeTabId}`);
          updateWindowProps(update.windowId, { title: newWindowTitle, payload: newPayload });
        }
      });

      return () => {
        console.log(`[NotebookWorkspace] Unsubscribing from onClassicBrowserState.`);
        unsubscribe();
      };
    } else {
      console.warn(`[NotebookWorkspace] window.api.onClassicBrowserState is not available.`);
    }
  }, [activeStore]);

  // Handler for notebook intent submission
  const handleNotebookIntentSubmit = useCallback(async () => {
    if (!notebookIntentText.trim() || !notebookId) return;
    const currentIntent = notebookIntentText;
    setNotebookIntentText('');
    setIsNotebookIntentProcessing(true);

    console.log(`[NotebookWorkspace] Submitting intent: "${currentIntent}" for notebook: ${notebookId}`);
    try {
      if (window.api?.setIntent) {
        await window.api.setIntent({
          intentText: currentIntent,
          context: 'notebook',
          notebookId: notebookId,
        });
      } else {
        console.warn("[NotebookWorkspace] window.api.setIntent is not available.");
      }
    } catch (error) {
      console.error("[NotebookWorkspace] Failed to set intent:", error);
    } finally {
      setIsNotebookIntentProcessing(false);
    }
  }, [notebookIntentText, notebookId]);

  // Effect for handling intent results
  useEffect(() => {
    if (!window.api?.onIntentResult) {
      console.warn("[NotebookWorkspace] window.api.onIntentResult is not available.");
      return;
    }

    const unsubscribe = window.api.onIntentResult((result: IntentResultPayload) => {
      console.log(`[NotebookWorkspace] Received intent result:`, result);
      
      if (result.type === 'open_notebook') {
        // Handle switching to a different notebook
        if (result.notebookId !== notebookId) {
          console.log(`[NotebookWorkspace] Switching to notebook: ${result.notebookId} (${result.title})`);
          router.push(`/notebook/${result.notebookId}`);
        } else {
          console.log(`[NotebookWorkspace] Already in notebook: ${result.notebookId}`);
        }
      } else if (result.type === 'open_in_classic_browser') {
        if (result.notebookId === notebookId) {
          console.log(`[NotebookWorkspace] Received open_in_classic_browser for URL: ${result.url}`);
          if (result.message) {
            console.log(`[NotebookWorkspace] Message from intent: ${result.message}`);
          }

          // Minimize any existing classic-browser windows
          const currentWindows = activeStore.getState().windows;
          currentWindows.forEach(window => {
            if (window.type === 'classic-browser' && !window.isMinimized) {
              activeStore.getState().minimizeWindow(window.id);
            }
          });

          const classicBrowserPayload: ClassicBrowserPayload = {
            initialUrl: result.url,
            tabs: [], // Start with empty tabs - backend will create the initial tab
            activeTabId: '',
            freezeState: { type: 'ACTIVE' } // Start in active state
          };
          
          // Calculate bounds with proper padding
          // Assuming viewport dimensions (we'll use window.innerWidth/Height)
          // Left padding: 18px, Top padding: 18px, Right padding: 18px (before sidebar), Bottom padding: 60px
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          const sidebarWidth = 48; // Default sidebar width when collapsed (sidebar is on the right)
          
          activeStore.getState().addWindow({
            type: 'classic-browser',
            payload: classicBrowserPayload,
            preferredMeta: { 
              x: 18, 
              y: 18,
              width: viewportWidth - sidebarWidth - 18 - 18, 
              height: viewportHeight - 18 - 60,
              title: "Browser"
            }
          });
        } else {
          console.warn(`[NotebookWorkspace] Received open_in_classic_browser for a different notebook: ${result.notebookId}`);
        }
      }
      // Handle other result types if needed
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]); // Remove activeStore and router from deps - they're stable refs

  // MOVED UP: Define useCallback before any conditional returns.
  const handleAddWindow = useCallback(() => {
    // Minimize any existing classic-browser windows
    const currentWindows = activeStore.getState().windows;
    currentWindows.forEach(window => {
      if (window.type === 'classic-browser' && !window.isMinimized) {
        activeStore.getState().minimizeWindow(window.id);
      }
    });

    const newWindowType: WindowContentType = 'classic-browser';
    const newWindowPayload: ClassicBrowserPayload = {
      initialUrl: 'https://www.are.na',
      tabs: [], // Start with empty tabs - backend will create the initial tab
      activeTabId: '',
      freezeState: { type: 'ACTIVE' } // Start in active state
    };
    
    // Calculate bounds with proper padding
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const sidebarWidth = 48; // Default sidebar width when collapsed (sidebar is on the right)
    
    activeStore.getState().addWindow({
      type: newWindowType,
      payload: newWindowPayload,
      preferredMeta: { 
        x: 18, 
        y: 18,
        width: viewportWidth - sidebarWidth - 18 - 18, 
        height: viewportHeight - 18 - 60
      }
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
    console.log(`[NotebookWorkspace] Not hydrated yet for notebook ${notebookId}`);
    return (
      <div className="h-screen bg-step-1" />
    );
  }
  
  console.log(`[NotebookWorkspace] Rendering notebook ${notebookId} with ${windows.length} windows:`, {
    notebookId,
    windowCount: windows.length,
    windows: windows.map(w => ({
      id: w.id,
      type: w.type,
      title: w.title,
      payload: w.payload
    })),
    timestamp: new Date().toISOString()
  });

  return (
    <SidebarProvider defaultOpen={false}>
      <NotebookContent 
        windows={windows}
        activeStore={activeStore}
        notebookId={notebookId}
        notebookTitle={notebookTitle}
        setNotebookTitle={setNotebookTitle}
        onAddChat={handleAddChatWindow}
        onAddBrowser={handleAddWindow}
        onGoHome={handleGoHome}
        notebookIntentText={notebookIntentText}
        setNotebookIntentText={setNotebookIntentText}
        handleNotebookIntentSubmit={handleNotebookIntentSubmit}
        isNotebookIntentProcessing={isNotebookIntentProcessing}
        isReady={isReady}
        isIntentLineVisible={isIntentLineVisible}
        setIsIntentLineVisible={setIsIntentLineVisible}
      />
    </SidebarProvider>
  );
}

interface NotebookViewProps {
  notebookId: string;
}

export default function NotebookView({ notebookId }: NotebookViewProps) {
  const [resolvedNotebookId, setResolvedNotebookId] = useState<string | null>(null);

  useEffect(() => {
    if (notebookId) {
      console.log(`[NotebookView] Resolved notebookId: ${notebookId}`);
      setResolvedNotebookId(notebookId);
    } else {
      console.warn('[NotebookView] notebookId is missing or invalid');
      setResolvedNotebookId(null);
    }
  }, [notebookId]);

  if (!resolvedNotebookId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-xl">Resolving notebook...</p>
      </div>
    );
  }

  return <NotebookWorkspace key={resolvedNotebookId} notebookId={resolvedNotebookId} />;
}