import { create, StateCreator, StoreApi } from "zustand";
import { persist, PersistStorage, StorageValue } from "zustand/middleware";
import { useStore } from "zustand";
import { v4 as uuidv4 } from 'uuid';
import { debounce } from 'lodash-es';
import type { WindowMeta, WindowContentType, WindowPayload, ClassicBrowserPayload } from "../../shared/types/window.types"; // Adjusted path
import { logger } from "../../utils/logger";

/**
 * WindowStoreState defines the full state and actions for the windowing system.
 */
export interface WindowStoreState {
  /** Array of window metadata objects */
  windows: WindowMeta[];
  /** Adds a new window to the store */
  addWindow: (config: {
    type: WindowContentType;
    payload?: WindowPayload;
    preferredMeta?: Partial<Pick<WindowMeta, 'x' | 'y' | 'width' | 'height' | 'title'>>;
  }) => string;
  /** Removes a window from the store by its ID */
  removeWindow: (id: string) => void;
  /** Updates specified properties of a window */
  updateWindowProps: (
    id: string,
    props: Partial<Pick<WindowMeta, "x" | "y" | "width" | "height" | "title" | "payload">>
  ) => void;
  /** Sets the focus to a specified window, bringing it to the front */
  setWindowFocus: (id: string) => Promise<void>;
  /** Minimizes a window to the sidebar */
  minimizeWindow: (id: string) => void;
  /** Restores a minimized window */
  restoreWindow: (id: string) => Promise<void>;
  /** Toggles window minimized state */
  toggleMinimize: (id: string) => Promise<void>;

  // Add these for hydration tracking
  _hasHydrated: boolean;
  _setHasHydrated: (status: boolean) => void;
}

/**
 * Defines the shape of the state that is actually persisted.
 */
// _hasHydrated and _setHasHydrated should not be persisted themselves.
// PersistedWindowState will only include 'windows'.
// type PersistedWindowState = Pick<WindowStoreState, 'windows'>;
// To explicitly exclude, we define what *is* persisted.
interface PersistedWindowState {
  windows: WindowMeta[];
  // We might add other top-level persisted things here later, outside of 'windows'
}

const PERSIST_DEBOUNCE_MS = 750;
const PERSIST_MAX_WAIT_MS = 2000;

/**
 * Asynchronous storage adapter that bridges Zustand's persist() middleware
 * to our IPC-backed storage (window.api.storeGet/Set/Remove).
 */
export const notebookStateStorageAsync: PersistStorage<PersistedWindowState> = {
  getItem: async (key: string): Promise<StorageValue<PersistedWindowState> | null> => {
    try {
      if (window.api && typeof window.api.storeGet === 'function') {
        const stringValue = await window.api.storeGet(key);
        if (stringValue) {
          return JSON.parse(stringValue) as StorageValue<PersistedWindowState>;
        }
      }
      console.warn(`[Zustand Storage] window.api.storeGet not available or no value for key: ${key}`);
      return null;
    } catch (error) {
      console.error(`[Zustand Storage] Error getting item '${key}':`, error);
      return null;
    }
  },
  setItem: debounce(async (key: string, value: StorageValue<PersistedWindowState>): Promise<void> => {
    try {
      if (window.api && typeof window.api.storeSet === 'function') {
        await window.api.storeSet(key, JSON.stringify(value));
        console.log(`[Zustand Storage] Debounced setItem for key '${key}' executed.`);
      } else {
        console.warn(`[Zustand Storage] window.api.storeSet not available for key: ${key}`);
      }
    } catch (error) {
      console.error(`[Zustand Storage] Error setting item '${key}':`, error);
    }
  }, PERSIST_DEBOUNCE_MS, { maxWait: PERSIST_MAX_WAIT_MS }),
  removeItem: async (key: string): Promise<void> => {
    try {
      if (window.api && typeof window.api.storeRemove === 'function') {
        await window.api.storeRemove(key);
      } else {
        console.warn(`[Zustand Storage] window.api.storeRemove not available for key: ${key}`);
      }
    } catch (error) {
      console.error(`[Zustand Storage] Error removing item '${key}':`, error);
    }
  },
};

/** Cache for per-notebook store instances to ensure singleton per notebookId */
const notebookStores = new Map<string, StoreApi<WindowStoreState>>();

/**
 * Exporting notebookStores map to allow access for flushing on quit/unload.
 */
export { notebookStores };

/**
 * Factory function to create or retrieve a unique Zustand store instance for a given notebookId.
 * This store manages the state of windows within that notebook.
 *
 * @param notebookId The unique identifier of the notebook.
 * @returns A Zustand store API for the specified notebook's window state.
 */
export function createNotebookWindowStore(notebookId: string): StoreApi<WindowStoreState> {
  if (notebookStores.has(notebookId)) {
    return notebookStores.get(notebookId)!;
  }

  const highestZ = (wins: WindowMeta[]): number =>
    wins.reduce((max, w) => (w.zIndex > max ? w.zIndex : max), 99);

  const windowStoreSlice: StateCreator<WindowStoreState, [], [], WindowStoreState> = (
    set,
    get
  ) => ({
    windows: [],
    _hasHydrated: false, // Initial state for the hydration flag

    _setHasHydrated: (status) => {
      set({ _hasHydrated: status });
    },

    addWindow: (config) => {
      const { type, payload, preferredMeta = {} } = config;
      const currentWindows = get().windows;
      const newId = uuidv4();

      const defaultTitle = `New ${type.charAt(0).toUpperCase() + type.slice(1)} Window`;
      const defaultWidth = 500;
      const defaultHeight = 400;
      const defaultX = 50 + (currentWindows.length % 5) * 30; // Basic cascade for x
      const defaultY = 50 + (currentWindows.length % 5) * 30; // Basic cascade for y

      // Ensure valid payload for window types that require specific structure
      let validatedPayload: WindowPayload = payload || {};
      
      // Special handling for classic-browser windows
      if (type === 'classic-browser') {
        const classicPayload = payload as ClassicBrowserPayload | undefined;
        
        // Create a minimal placeholder payload
        // This will be immediately overwritten by the backend's authoritative state
        validatedPayload = {
          initialUrl: classicPayload?.initialUrl || 'about:blank',
          tabs: [], // Empty tabs array - backend will populate
          activeTabId: '', // Empty activeTabId - backend will populate
          freezeState: { type: 'ACTIVE' } // Start in active state
        } as ClassicBrowserPayload;
      }

      const newWindow: WindowMeta = {
        id: newId,
        type,
        payload: validatedPayload,
        title: preferredMeta.title ?? defaultTitle,
        x: preferredMeta.x ?? defaultX,
        y: preferredMeta.y ?? defaultY,
        width: preferredMeta.width ?? defaultWidth,
        height: preferredMeta.height ?? defaultHeight,
        zIndex: highestZ(currentWindows) + 1,
        isFocused: true,
      };

      set((state) => ({
        windows: [
          ...state.windows.map(w => w.isFocused ? { ...w, isFocused: false } : w),
          newWindow,
        ],
      }));
      return newId;
    },

    removeWindow: (id) => {
      set((state) => ({
        windows: state.windows.filter((w) => w.id !== id),
      }));
    },

    updateWindowProps: (id, propsToUpdate) => {
      set((state) => ({
        windows: state.windows.map((w) => {
          if (w.id !== id) return w;
          
          return { ...w, ...propsToUpdate };
        }),
      }));
    },

    setWindowFocus: async (id) => {
      const { windows } = get();
      const targetWindow = windows.find(w => w.id === id);
      const previouslyFocusedWindow = windows.find(w => w.isFocused && w.id !== id);

      if (!targetWindow) {
        logger.warn(`[WindowStore] setWindowFocus: Window ID ${id} not found. Aborting.`);
        return;
      }

      if (targetWindow.isFocused) {
        logger.debug(`[WindowStore] setWindowFocus: Window ${id} is already focused. No action needed.`);
        return;
      }

      logger.info(`[WindowStore] setWindowFocus: Switching focus from ${previouslyFocusedWindow?.id || 'none'} to ${id}`);

      // Perform atomic state update for all window properties
      // The controller hook will handle freeze/unfreeze logic based on focus changes
      const currentHighestZ = highestZ(windows);
      set((state) => ({
        windows: state.windows.map((w) => {
          if (w.id === id) {
            // Target window: set focused and update z-index
            return {
              ...w,
              isFocused: true,
              zIndex: currentHighestZ + 1
            };
          } else if (w.isFocused) {
            // Only create new object if this window was previously focused
            return {
              ...w,
              isFocused: false
            };
          } else {
            // Window wasn't focused before, return the same reference
            return w;
          }
        }),
      }));

      logger.info(`[WindowStore] Focus switched to window ${id}`);
    },

    minimizeWindow: (id) => {
      set((state) => ({
        windows: state.windows.map((w) =>
          w.id === id ? { ...w, isMinimized: true, isFocused: false, restoredAt: undefined } : w
        ),
      }));
      console.log(`[WindowStore] Window ${id} minimized`);
    },

    restoreWindow: async (id) => {
      const targetWindow = get().windows.find(w => w.id === id);
      
      if (!targetWindow) {
        logger.warn(`[WindowStore] restoreWindow: Window ID ${id} not found. Aborting.`);
        return;
      }
      
      // First, unminimize the window and set restoration timestamp
      set((state) => ({
        windows: state.windows.map((w) =>
          w.id === id ? { ...w, isMinimized: false, restoredAt: Date.now() } : w
        ),
      }));
      
      logger.info(`[WindowStore] Window ${id} restored from minimized state`);
      
      // Then, use setWindowFocus to handle focus and freeze/unfreeze logic
      await get().setWindowFocus(id);
    },

    toggleMinimize: async (id) => {
      const window = get().windows.find(w => w.id === id);
      if (!window) {
        console.warn(`[WindowStore toggleMinimize] Window ID ${id} not found.`);
        return;
      }
      
      if (window.isMinimized) {
        await get().restoreWindow(id);
      } else {
        get().minimizeWindow(id);
      }
    },
  });

  const store = create<WindowStoreState>()(
    persist<WindowStoreState, [], [], PersistedWindowState>(
      windowStoreSlice,
      {
        name: `notebook-layout-${notebookId}`,
        storage: notebookStateStorageAsync,
        partialize: (state: WindowStoreState): PersistedWindowState => ({
          windows: state.windows.map(win => {
            // Ensure payload is at least an empty object if undefined/null
            const windowCopy = { ...win, payload: win.payload || {} };
            
            // Don't persist freeze state for browser windows
            if (windowCopy.type === 'classic-browser' && windowCopy.payload.freezeState) {
              const { freezeState, ...payloadWithoutFreeze } = windowCopy.payload;
              windowCopy.payload = payloadWithoutFreeze;
            }
            
            return windowCopy;
          })
        }),
        onRehydrateStorage: () => {
          return (state, error) => {
            if (error) {
              console.error(`[Zustand Storage] Failed to rehydrate for ${notebookId}:`, error);
            }
            // Even on error, or if state is undefined (no persisted data), consider hydration attempt finished.
            console.log(`[Zustand Storage] Rehydration attempt finished for ${notebookId}. Persisted state found: ${!!state}`, {
              hasState: !!state,
              windowCount: state?.windows?.length || 0,
              windows: state?.windows?.map((w) => ({ id: w.id, type: w.type })) || []
            });
            const storeInstance = notebookStores.get(notebookId);
            if (storeInstance) {
              storeInstance.getState()._setHasHydrated(true);
            } else {
              // Fallback, though ideally storeInstance should be in the map.
              console.warn(`[Zustand Storage] Store for ${notebookId} not in cache during onRehydrateStorage, using local instance.`);
              store.getState()._setHasHydrated(true);
            }
          };
        }
      }
    )
  );

  notebookStores.set(notebookId, store);
  return store;
}

// Hook for easier consumption in React components
export const useWindowStore = (notebookId: string) => {
  const store = createNotebookWindowStore(notebookId);
  return useStore(store);
}; 