import { create, StateCreator, StoreApi } from "zustand";
import { persist, StateStorage, PersistStorage, StorageValue } from "zustand/middleware";
import { v4 as uuidv4 } from 'uuid';
import type { WindowMeta, WindowContentType, WindowPayload } from "../../shared/types"; // Adjusted path

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
  setWindowFocus: (id: string) => void;

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
}

/**
 * Asynchronous storage adapter that bridges Zustand's persist() middleware
 * to our IPC-backed storage (window.api.storeGet/Set/Remove).
 */
const notebookStateStorageAsync: PersistStorage<PersistedWindowState> = {
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
  setItem: async (key: string, value: StorageValue<PersistedWindowState>): Promise<void> => {
    try {
      if (window.api && typeof window.api.storeSet === 'function') {
        await window.api.storeSet(key, JSON.stringify(value));
      } else {
        console.warn(`[Zustand Storage] window.api.storeSet not available for key: ${key}`);
      }
    } catch (error) {
      console.error(`[Zustand Storage] Error setting item '${key}':`, error);
    }
  },
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
    wins.reduce((max, w) => (w.zIndex > max ? w.zIndex : max), 0);

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

      const newWindow: WindowMeta = {
        id: newId,
        type,
        payload: payload || {},
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
          ...state.windows.map(w => ({ ...w, isFocused: false })),
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
        windows: state.windows.map((w) =>
          w.id === id ? { ...w, ...propsToUpdate } : w
        ),
      }));
    },

    setWindowFocus: (id) => {
      const currentWindows = get().windows;
      const targetWindow = currentWindows.find(w => w.id === id);
      
      if (!targetWindow) return;

      const currentHighestZ = highestZ(currentWindows);
      let newZIndex = targetWindow.zIndex;

      const isTopFocused = targetWindow.isFocused && targetWindow.zIndex === currentHighestZ;
      if(!isTopFocused) { 
          newZIndex = currentHighestZ + 1;
      }
      
      set((state) => ({
        windows: state.windows.map((w) => {
          if (w.id === id) {
            return { ...w, isFocused: true, zIndex: newZIndex };
          }
          return { ...w, isFocused: false }; 
        }),
      }));
    },
  });

  const store = create<WindowStoreState>()(
    persist<WindowStoreState, [], [], PersistedWindowState>(
      windowStoreSlice,
      {
        name: `notebook-layout-${notebookId}`,
        storage: notebookStateStorageAsync,
        partialize: (state: WindowStoreState): PersistedWindowState => ({
          // Only persist the 'windows' array. _hasHydrated and _setHasHydrated are transient.
          windows: state.windows.map(win => {
            return win; 
          })
        }),
        version: 1,
        onRehydrateStorage: () => {
          return (state, error) => {
            if (error) {
              console.error(`[Zustand Storage] Failed to rehydrate for ${notebookId}:`, error);
            }
            // Even on error, or if state is undefined (no persisted data), consider hydration attempt finished.
            console.log(`[Zustand Storage] Rehydration attempt finished for ${notebookId}. Persisted state found: ${!!state}`);
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

// Optional: A hook for easier consumption in React components
// import { useStore } from "zustand";
// export const useNotebookWindowStore = (notebookId: string) => {
//   const store = createNotebookWindowStore(notebookId);
//   return useStore(store);
// }; 