import { create, StateCreator, StoreApi } from "zustand";
import { persist, PersistStorage, StorageValue } from "zustand/middleware";
import { v4 as uuidv4 } from 'uuid';
import { debounce } from 'lodash-es';
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
  /** Minimizes a window to the sidebar */
  minimizeWindow: (id: string) => void;
  /** Restores a minimized window */
  restoreWindow: (id: string) => void;
  /** Toggles window minimized state */
  toggleMinimize: (id: string) => void;

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
const CURRENT_PERSIST_VERSION = 1; // Define current version for migrations

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
      
      if (!targetWindow) {
        console.warn(`[WindowStore setWindowFocus] Window ID ${id} not found. Aborting.`);
        return;
      }

      const oldZIndex = targetWindow.zIndex;
      const oldIsFocused = targetWindow.isFocused;
      const currentHighestZ = highestZ(currentWindows);
      const newZIndex = currentHighestZ + 1;

      console.log(`[WindowStore setWindowFocus] Target: ${id}, Prev isFocused: ${oldIsFocused}, Prev zIndex: ${oldZIndex}, Current highestZ: ${currentHighestZ}, New zIndex will be: ${newZIndex}`);
      
      set((state) => {
        const updatedWindows = state.windows.map((w) => {
          if (w.id === id) {
            return { ...w, isFocused: true, zIndex: newZIndex };
          }
          return { ...w, isFocused: false }; 
        });
        // Log the state of the target window *after* the map operation
        const finalTargetWindowState = updatedWindows.find(f => f.id === id);
        console.log(`[WindowStore setWindowFocus] Target: ${id}, Final isFocused: ${finalTargetWindowState?.isFocused}, Final zIndex: ${finalTargetWindowState?.zIndex}`);
        return { windows: updatedWindows };
      });
    },

    minimizeWindow: (id) => {
      set((state) => ({
        windows: state.windows.map((w) =>
          w.id === id ? { ...w, isMinimized: true, isFocused: false } : w
        ),
      }));
      console.log(`[WindowStore] Window ${id} minimized`);
    },

    restoreWindow: (id) => {
      const currentWindows = get().windows;
      const currentHighestZ = highestZ(currentWindows);
      
      set((state) => ({
        windows: state.windows.map((w) =>
          w.id === id 
            ? { ...w, isMinimized: false, isFocused: true, zIndex: currentHighestZ + 1 }
            : { ...w, isFocused: false }
        ),
      }));
      console.log(`[WindowStore] Window ${id} restored`);
    },

    toggleMinimize: (id) => {
      const window = get().windows.find(w => w.id === id);
      if (!window) {
        console.warn(`[WindowStore toggleMinimize] Window ID ${id} not found.`);
        return;
      }
      
      if (window.isMinimized) {
        get().restoreWindow(id);
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
            // This can help prevent issues if old data had missing payloads
            return { ...win, payload: win.payload || {} }; 
          })
        }),
        version: CURRENT_PERSIST_VERSION,
        migrate: (persistedState, version) => {
          console.log(`[Zustand Storage] Attempting migration for '${notebookId}'. Persisted version: ${version}, Current version: ${CURRENT_PERSIST_VERSION}`);
          let stateToMigrate = persistedState as any; // Use 'any' for easier manipulation during migration

          // If the persistedState is the raw WindowMeta[] (very old, unversioned, or from a faulty partialize)
          // This is a fallback, ideally partialize always returns { windows: [...] }
          if (Array.isArray(stateToMigrate) && version < CURRENT_PERSIST_VERSION) {
            console.warn(`[Zustand Storage] Detected raw array state for migration. Wrapping in { windows: ... }`);
            stateToMigrate = { windows: stateToMigrate };
          }

          // Ensure stateToMigrate has a windows property, if not, it's likely corrupt or unexpected.
          // Returning undefined will cause Zustand to ignore this persisted state.
          if (!stateToMigrate || typeof stateToMigrate.windows === 'undefined') {
            console.error(`[Zustand Storage] Migration error for '${notebookId}': Persisted state is missing 'windows' property or is null/undefined. Resetting to default.`);
            return { windows: [] }; // Return a default state instead of undefined
          }

          // Example Migration: v0 (or unversioned) -> v1
          // Assuming v0 might not have isMinimized/isMaximized or a guaranteed payload object
          if (version < 1) {
            console.log(`[Zustand Storage] Migrating '${notebookId}' from version < 1 to 1.`);
            stateToMigrate.windows = stateToMigrate.windows.map((w: WindowMeta) => ({
              ...w,
              isMinimized: typeof w.isMinimized === 'boolean' ? w.isMinimized : false,
              isMaximized: typeof w.isMaximized === 'boolean' ? w.isMaximized : false,
              // Ensure payload exists and is an object
              payload: w.payload && typeof w.payload === 'object' ? w.payload : {},
            }));
          }

          // Add future migration blocks here, e.g.:
          // if (version < 2) {
          //   console.log(`[Zustand Storage] Migrating '${notebookId}' from version < 2 to 2.`);
          //   // Apply changes for v2
          //   stateToMigrate.windows = stateToMigrate.windows.map((w: WindowMeta) => ({ ... })); 
          // }

          console.log(`[Zustand Storage] Migration completed for '${notebookId}'.`);
          return stateToMigrate as PersistedWindowState;
        },
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