import { vi, type Mock } from 'vitest';
import type { IAppAPI } from '../../../../../shared/types';
import type { ClassicBrowserPayload, TabState } from '../../../../../shared/types/window.types';
import type { BrowserWindow, WebContentsView, WebContents } from 'electron';

/**
 * Creates a mock TabState with sensible defaults
 */
export function createMockTabState(overrides: Partial<TabState> = {}): TabState {
  return {
    id: `tab-${Math.random().toString(36).substr(2, 9)}`,
    url: 'https://www.are.na',
    title: 'New Tab',
    faviconUrl: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    ...overrides
  };
}

/**
 * Creates a mock ClassicBrowserPayload
 */
export function createMockBrowserPayload(
  tabs: TabState[] = [createMockTabState()],
  activeTabId?: string
): ClassicBrowserPayload {
  const finalActiveTabId = activeTabId || tabs[0]?.id || '';
  return {
    tabs,
    activeTabId: finalActiveTabId,
    freezeState: { type: 'ACTIVE' }
  };
}

/**
 * Creates a mock window.api object for frontend tests
 */
export function createMockWindowApi(): IAppAPI {
  return {
    // ClassicBrowser methods
    classicBrowserCreate: vi.fn().mockResolvedValue({ success: true }),
    classicBrowserCreateTab: vi.fn().mockResolvedValue({ success: true, tabId: 'new-tab-id' }),
    classicBrowserSwitchTab: vi.fn().mockResolvedValue({ success: true }),
    classicBrowserCloseTab: vi.fn().mockResolvedValue({ success: true }),
    classicBrowserLoadUrl: vi.fn().mockResolvedValue(undefined),
    classicBrowserNavigate: vi.fn().mockResolvedValue(undefined),
    classicBrowserGetState: vi.fn().mockResolvedValue(null),
    classicBrowserSetBounds: vi.fn().mockResolvedValue(undefined),
    classicBrowserSetVisibility: vi.fn().mockResolvedValue(undefined),
    classicBrowserSetBackgroundColor: vi.fn().mockResolvedValue(undefined),
    captureSnapshot: vi.fn().mockResolvedValue(null),
    showAndFocusView: vi.fn().mockResolvedValue(undefined),
    freezeBrowserView: vi.fn().mockResolvedValue(null),
    unfreezeBrowserView: vi.fn().mockResolvedValue(undefined),
    classicBrowserDestroy: vi.fn().mockResolvedValue(undefined),
    
    // Store methods
    storeGet: vi.fn().mockResolvedValue(null),
    storeSet: vi.fn().mockResolvedValue(undefined),
    storeRemove: vi.fn().mockResolvedValue(undefined),
    
    // Classic Browser event listeners  
    onClassicBrowserState: vi.fn(),
    onClassicBrowserStateUpdate: vi.fn(),
    offClassicBrowserStateUpdate: vi.fn(),
    onClassicBrowserNavigate: vi.fn(),
    offClassicBrowserNavigate: vi.fn(),
    onClassicBrowserViewFocused: vi.fn(),
    onClassicBrowserUrlChange: vi.fn(),
    classicBrowserRequestFocus: vi.fn(),
    onWindowAction: vi.fn(),
    offWindowAction: vi.fn(),
    
    // Chat methods
    createChatInNotebook: vi.fn(),
    listChatsForNotebook: vi.fn(),
    transferChatToNotebook: vi.fn(),
    startChatStream: vi.fn(),
    stopChatStream: vi.fn(),
    onChatChunk: vi.fn(),
    onChatStreamEnd: vi.fn(),
    onChatStreamError: vi.fn(),
    getMessages: vi.fn(),
    getSliceDetails: vi.fn(),
    
    // Object methods
    getObjectById: vi.fn(),
    deleteObjects: vi.fn(),
    deleteObjectBySourceUri: vi.fn(),
    // Notebook methods
    getNotebookById: vi.fn(),
    getAllNotebooks: vi.fn(),
    getRecentlyViewedNotebooks: vi.fn().mockResolvedValue([]),
    updateNotebook: vi.fn(),
    deleteNotebook: vi.fn(),
    getChunksForNotebook: vi.fn(),
    getOrCreateDailyNotebook: vi.fn(),
    composeNotebook: vi.fn().mockResolvedValue({ notebookId: 'nb-1' }),
    
    // Note methods
    createNote: vi.fn(),
    getNotesForNotebook: vi.fn().mockResolvedValue([]),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    
    // Intent methods
    setIntent: vi.fn().mockResolvedValue(undefined),
    onIntentResult: vi.fn(),
    onIntentStreamStart: vi.fn(),
    onIntentStreamChunk: vi.fn(),
    onIntentStreamEnd: vi.fn(),
    onIntentStreamError: vi.fn(),
    onSuggestedActions: vi.fn(),
    
    ingestUrl: vi.fn(),
    ingestPdfs: vi.fn(),
    onPdfIngestProgress: vi.fn(),
    onPdfIngestBatchComplete: vi.fn(),
    cancelPdfIngest: vi.fn(),
    
    // Profile/Weather/Activity
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    getWeather: vi.fn(),
    logActivity: vi.fn(),
    
    // Bookmarks
    importBookmarks: vi.fn(),
    onBookmarksProgress: vi.fn(),
    
    // System
    getAppVersion: vi.fn(),
    saveTempFile: vi.fn(),
    openExternalUrl: vi.fn(),
    onMainRequestFlush: vi.fn(),
    
    // Shortcuts
    onShortcutMinimizeWindow: vi.fn(),
    onCloseActiveRequested: vi.fn(),
    syncWindowStackOrder: vi.fn(),
    
    // To-Do
    createToDo: vi.fn(),
    getToDos: vi.fn(),
    getToDoById: vi.fn(),
    updateToDo: vi.fn(),
    deleteToDo: vi.fn(),
    
    // Audio
    audio: {
      transcribe: vi.fn()
    },
    
    // WOM
    wom: {
      ingestWebpage: vi.fn(),
      updateAccess: vi.fn(),
      createTabGroup: vi.fn(),
      updateTabGroup: vi.fn(),
      enrichComposite: vi.fn(),
      onIngestionStarted: vi.fn(),
      onIngestionComplete: vi.fn()
    },
    
    // Update
    update: {
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(),
      getStatus: vi.fn(),
      onChecking: vi.fn(),
      onUpdateAvailable: vi.fn(),
      onUpdateNotAvailable: vi.fn(),
      onError: vi.fn(),
      onDownloadProgress: vi.fn(),
      onUpdateDownloaded: vi.fn()
    }
  } as unknown as IAppAPI;
}

/**
 * Creates a mock WebContents object
 */
export function createMockWebContents(): Partial<WebContents> & { destroy?: Mock } {
  return {
    send: vi.fn(),
    loadURL: vi.fn().mockResolvedValue(undefined),
    canGoBack: vi.fn().mockReturnValue(false),
    canGoForward: vi.fn().mockReturnValue(false),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    getURL: vi.fn().mockReturnValue('https://www.are.na'),
    getTitle: vi.fn().mockReturnValue('New Tab'),
    executeJavaScript: vi.fn().mockResolvedValue(0),
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    isLoading: vi.fn().mockReturnValue(false),
    isCrashed: vi.fn().mockReturnValue(false),
    destroy: vi.fn(),
    id: 12345,
    session: {
      webRequest: {
        onBeforeRequest: vi.fn()
      }
    } as unknown as WebContents['session']
  };
}

/**
 * Creates a mock WebContentsView
 */
export function createMockWebContentsView(): Partial<WebContentsView> {
  const mockWebContents = createMockWebContents();
  return {
    webContents: mockWebContents as unknown as WebContents,
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    setBackgroundColor: vi.fn(),
    setBorderRadius: vi.fn()
  };
}

/**
 * Creates a mock BrowserWindow
 */
export function createMockBrowserWindow(): Partial<BrowserWindow> {
  const mockWebContents = createMockWebContents();
  return {
    id: 1,
    webContents: mockWebContents as unknown as WebContents,
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
      children: []
    } as unknown as BrowserWindow['contentView'],
    getBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 1024, height: 768 }),
    isDestroyed: vi.fn().mockReturnValue(false),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn()
  };
}

/**
 * Creates a spy that tracks IPC event emissions
 */
export function createIpcEventSpy() {
  const events: Array<{ channel: string; payload: unknown }> = [];
  
  const spy = vi.fn((channel: string, payload: unknown) => {
    events.push({ channel, payload });
  });
  
  return {
    spy,
    events,
    getLastEvent: () => events[events.length - 1],
    getEventCount: () => events.length,
    getEventsByChannel: (channel: string) => events.filter(e => e.channel === channel),
    clear: () => events.length = 0
  };
}

/**
 * Helper to wait for async operations in tests
 */
export async function flushPromises(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

/**
 * Creates a mock IpcMain for testing handlers
 */
export function createMockIpcMain() {
  type IpcHandler = (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>;
  const handlers = new Map<string, IpcHandler>();
  
  return {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
    // Helper to trigger a handler for testing
    trigger: async (channel: string, event: unknown, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`No handler registered for channel: ${channel}`);
      }
      return handler(event, ...args);
    },
    handlers
  };
}