import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createNotebookWindowStore, WindowStoreState } from '../windowStoreFactory';
import { debounce } from 'lodash-es';
import type { WindowMeta, PlaceholderPayload, WindowContentType } from '../../../shared/types';
import { StoreApi } from 'zustand';
import { createMockWindowApi } from '../../_tests/helpers/mockWindowApi';

// Create mock API
const mockApi = createMockWindowApi();

global.window = {
  api: mockApi,
} as Window & typeof globalThis;


describe('createNotebookWindowStore', () => {
  const notebookId = 'test-notebook'; // Default for non-persistence tests
  let store: StoreApi<WindowStoreState>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createNotebookWindowStore(notebookId);
    // Manually reset state for non-persistence tests to ensure isolation
    store.setState({ windows: [] }); 
  });

  it('should initialize with an empty windows array', () => {
    expect(store.getState().windows).toEqual([]);
  });

  it('addWindow should add a new window and set focus', () => {
    const windowConfig = {
      type: 'placeholder' as WindowContentType,
      payload: { content: 'test' } as PlaceholderPayload,
      preferredMeta: {
        title: 'Test Window 1',
        x: 10, y: 10, width: 100, height: 100,
      }
    };
    const newWindowId = store.getState().addWindow(windowConfig);
    const windows = store.getState().windows;
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      id: newWindowId, // Check against the returned ID
      type: windowConfig.type,
      payload: windowConfig.payload,
      title: windowConfig.preferredMeta.title,
      x: windowConfig.preferredMeta.x,
      y: windowConfig.preferredMeta.y,
      width: windowConfig.preferredMeta.width,
      height: windowConfig.preferredMeta.height,
      isFocused: true,
      zIndex: 100, // First window gets zIndex 100
    });
  });

  it('removeWindow should remove a window by ID', () => {
    const win1Config = {
      type: 'empty' as WindowContentType,
      preferredMeta: { title: 'W1', x:0,y:0,width:10,height:10 },
      payload: {},
    };
    const win1Id = store.getState().addWindow(win1Config);
    expect(store.getState().windows).toHaveLength(1);
    store.getState().removeWindow(win1Id);
    expect(store.getState().windows).toHaveLength(0);
  });

  it('updateWindowProps should update specified properties of a window', () => {
    const win1Config = {
      type: 'empty' as WindowContentType,
      preferredMeta: { title: 'W1', x:0,y:0,width:10,height:10 },
      payload: {},
    };
    const win1Id = store.getState().addWindow(win1Config);
    store.getState().updateWindowProps(win1Id, { x: 50, y: 50, title: 'Updated W1' });
    const updatedWindow = store.getState().windows.find(w => w.id === win1Id);
    expect(updatedWindow).toBeDefined();
    expect(updatedWindow?.x).toBe(50);
    expect(updatedWindow?.y).toBe(50);
    expect(updatedWindow?.title).toBe('Updated W1');
  });

  it('setWindowFocus should set focus and bring window to front', () => {
    const win1Config = {
      type: 'empty' as WindowContentType, 
      preferredMeta: { title: 'W1', x:0,y:0,width:10,height:10 },
      payload: {}
    };
    const win2Config = {
      type: 'empty' as WindowContentType, 
      preferredMeta: { title: 'W2', x:0,y:0,width:10,height:10 },
      payload: {}
    };
    const win1Id = store.getState().addWindow(win1Config); // zIndex: 1, focused
    const win2Id = store.getState().addWindow(win2Config); // zIndex: 2, focused (win1 unfocused)

    let windows = store.getState().windows;
    let win1 = windows.find(w=>w.id===win1Id);
    let win2 = windows.find(w=>w.id===win2Id);
    expect(win1?.isFocused).toBe(false);
    expect(win1?.zIndex).toBe(1);
    expect(win2?.isFocused).toBe(true);
    expect(win2?.zIndex).toBe(2);

    store.getState().setWindowFocus(win1Id);
    windows = store.getState().windows;
    win1 = windows.find(w=>w.id===win1Id);
    win2 = windows.find(w=>w.id===win2Id);

    expect(win1?.isFocused).toBe(true);
    expect(win1?.zIndex).toBe(3); // Brought to front
    expect(win2?.isFocused).toBe(false);
    expect(win2?.zIndex).toBe(2); // Stays the same
  });

  describe('Persistence with mocked window.api', () => {

    it('should call window.api.storeSet when state changes due to an action', async () => {
      const uniqueNotebookIdSet = 'persistence-set-action-test'; // Unique ID for this test
      const uniqueStorageKeySet = `notebook-layout-${uniqueNotebookIdSet}`;
      
      vi.useFakeTimers();

      // Mock storeGet for initial hydration attempt, assume no prior state for this new store
      (mockApi.storeGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null); 
      const persistenceStore = createNotebookWindowStore(uniqueNotebookIdSet);
      
      // Allow initial hydration and any immediate post-hydration save by persist middleware to complete
      await vi.runAllTimersAsync(); 
      
      // Cancel any pending debounced save from the hydration/initialization phase
      const { notebookStateStorageAsync } = await import('../windowStoreFactory'); // Re-import to get the instance
      if ((notebookStateStorageAsync.setItem as ReturnType<typeof debounce>).cancel) {
        (notebookStateStorageAsync.setItem as ReturnType<typeof debounce>).cancel();
      }

      // Clear any calls to storeSet that happened during store initialization/hydration (if cancel didn't prevent it or if it already fired)
      (mockApi.storeSet as ReturnType<typeof vi.fn>).mockClear(); 

      const win1Config = {
        type: 'empty' as WindowContentType,
        preferredMeta: { 
          title: 'W1-Set-Action', x:0,y:0,width:10,height:10 
        },
        payload: {},
      };
      const win1Id = persistenceStore.getState().addWindow(win1Config);

      // Advance timers to trigger persist for the addWindow action
      // Using advanceTimersByTimeAsync with a specific time greater than debounce delay
      await vi.advanceTimersByTimeAsync(1000); 
      
      expect(mockApi.storeSet).toHaveBeenCalledTimes(1); 
      const expectedWindowData = {
        id: win1Id, // Use the actual returned ID
        type: win1Config.type,
        title: win1Config.preferredMeta.title,
        x: win1Config.preferredMeta.x,
        y: win1Config.preferredMeta.y,
        width: win1Config.preferredMeta.width,
        height: win1Config.preferredMeta.height,
        payload: win1Config.payload,
        zIndex: 100,
        isFocused: true, 
      };
      const expectedStoredValue = {
        state: {
          windows: [expectedWindowData],
        },
        version: 2,
      };
      const [actualKey, actualJsonString] = (mockApi.storeSet as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(actualKey).toBe(uniqueStorageKeySet);
      expect(JSON.parse(actualJsonString)).toEqual(expectedStoredValue);
      
      vi.useRealTimers();
    });

    it('should call window.api.storeGet on initialization and rehydrate state', async () => {
      const uniqueNotebookIdGet = 'persistence-get-rehydrate-test'; // Unique ID
      const uniqueStorageKeyGet = `notebook-layout-${uniqueNotebookIdGet}`;
      const initialWindows: WindowMeta[] = [
        { id: 'hydrated-win1', type: 'placeholder', title: 'Hydrated', x: 100, y: 100, width: 200, height: 200, zIndex: 100, isFocused: true, payload: {id: 'p1'} as PlaceholderPayload },
      ];
      const storedValue = JSON.stringify({ state: { windows: initialWindows }, version: 1 });
      (mockApi.storeGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce(storedValue);

      vi.useFakeTimers(); // Use fake timers before creating the store for rehydration
      const persistenceStoreGet = createNotebookWindowStore(uniqueNotebookIdGet);
      // No manual state reset here, we want to test rehydration
      
      expect(mockApi.storeGet).toHaveBeenCalledWith(uniqueStorageKeyGet);
      
      expect(persistenceStoreGet.getState().windows).toEqual([]); 
      
      await vi.runAllTimersAsync(); // Allow async operations for persist middleware to complete

      const rehydratedWindows = persistenceStoreGet.getState().windows;
      expect(rehydratedWindows).toHaveLength(1);
      expect(rehydratedWindows[0]).toMatchObject(initialWindows[0]);
      vi.useRealTimers();
    });

    it('should handle null from storeGet (first load scenario)', async () => {
      const uniqueNotebookIdNull = 'persistence-null-load-test'; // Unique ID
      const uniqueStorageKeyNull = `notebook-layout-${uniqueNotebookIdNull}`;
      (mockApi.storeGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      
      vi.useFakeTimers();
      const persistenceStoreNull = createNotebookWindowStore(uniqueNotebookIdNull);
      // No manual state reset here

      expect(mockApi.storeGet).toHaveBeenCalledWith(uniqueStorageKeyNull);
      await vi.runAllTimersAsync(); 
      expect(persistenceStoreNull.getState().windows).toEqual([]); 
      vi.useRealTimers();
    });

  });
}); 