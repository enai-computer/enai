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
    notifySidebarHover: vi.fn().mockResolvedValue(undefined),
    
    // Browser context menu
    browserContextMenu: {
      onShow: vi.fn().mockReturnValue(() => {}),
      onHide: vi.fn().mockReturnValue(() => {}),
      sendAction: vi.fn().mockResolvedValue(undefined),
      notifyReady: vi.fn(),
      notifyClosed: vi.fn(),
    },
    
    // Store methods
    storeGet: vi.fn().mockResolvedValue(null),
    storeSet: vi.fn().mockResolvedValue(undefined),
    storeRemove: vi.fn().mockResolvedValue(undefined),
    
    // Classic Browser event listeners  
    onClassicBrowserState: vi.fn().mockReturnValue(() => {}),
    onClassicBrowserViewFocused: vi.fn().mockReturnValue(() => {}),
    onClassicBrowserUrlChange: vi.fn().mockReturnValue(() => {}),
    classicBrowserRequestFocus: vi.fn().mockResolvedValue(undefined),
    
    // Chat methods
    createChatInNotebook: vi.fn().mockResolvedValue({ id: 'chat-1', notebookId: 'nb-1', title: 'Test Chat', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    listChatsForNotebook: vi.fn().mockResolvedValue([]),
    transferChatToNotebook: vi.fn().mockResolvedValue(true),
    startChatStream: vi.fn(),
    stopChatStream: vi.fn(),
    onChatChunk: vi.fn().mockReturnValue(() => {}),
    onChatStreamEnd: vi.fn().mockReturnValue(() => {}),
    onChatStreamError: vi.fn().mockReturnValue(() => {}),
    getMessages: vi.fn().mockResolvedValue([]),
    getSliceDetails: vi.fn().mockResolvedValue([]),
    
    // Object methods
    getObjectById: vi.fn().mockResolvedValue(null),
    deleteObjects: vi.fn().mockResolvedValue({ deletedCount: 0, chunkCount: 0 }),
    deleteObjectBySourceUri: vi.fn().mockResolvedValue({ deletedCount: 0, chunkCount: 0 }),
    // Notebook methods
    getNotebookById: vi.fn().mockResolvedValue(null),
    getAllNotebooks: vi.fn().mockResolvedValue([]),
    getRecentlyViewedNotebooks: vi.fn().mockResolvedValue([]),
    updateNotebook: vi.fn().mockResolvedValue(null),
    deleteNotebook: vi.fn().mockResolvedValue(false),
    getChunksForNotebook: vi.fn().mockResolvedValue([]),
    getOrCreateDailyNotebook: vi.fn().mockResolvedValue({ id: 'daily-1', title: 'Daily Note', description: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    composeNotebook: vi.fn().mockResolvedValue({ notebookId: 'nb-1' }),
    
    // Note methods
    createNote: vi.fn().mockResolvedValue({ id: 'note-1', notebookId: 'nb-1', content: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    getNotesForNotebook: vi.fn().mockResolvedValue([]),
    updateNote: vi.fn().mockResolvedValue(null),
    deleteNote: vi.fn().mockResolvedValue(false),
    
    // Intent methods
    setIntent: vi.fn().mockResolvedValue(undefined),
    onIntentResult: vi.fn().mockReturnValue(() => {}),
    onIntentStreamStart: vi.fn().mockReturnValue(() => {}),
    onIntentStreamChunk: vi.fn().mockReturnValue(() => {}),
    onIntentStreamEnd: vi.fn().mockReturnValue(() => {}),
    onIntentStreamError: vi.fn().mockReturnValue(() => {}),
    onSuggestedActions: vi.fn().mockReturnValue(() => {}),
    
    ingestUrl: vi.fn().mockResolvedValue({ jobId: 'job-1', alreadyExists: false }),
    ingestPdfs: vi.fn().mockResolvedValue(undefined),
    onPdfIngestProgress: vi.fn().mockReturnValue(() => {}),
    onPdfIngestBatchComplete: vi.fn().mockReturnValue(() => {}),
    cancelPdfIngest: vi.fn(),
    
    // Profile/Weather/Activity
    getProfile: vi.fn().mockResolvedValue({ id: 'user-1', name: '', goals: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    updateProfile: vi.fn().mockResolvedValue({ id: 'user-1', name: '', goals: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    getWeather: vi.fn().mockResolvedValue({ temperature: 20, condition: 'clear' }),
    logActivity: vi.fn().mockResolvedValue(undefined),
    
    // Bookmarks
    importBookmarks: vi.fn().mockResolvedValue(0),
    onBookmarksProgress: vi.fn().mockReturnValue(() => {}),
    
    // System
    getAppVersion: vi.fn().mockResolvedValue('1.0.0'),
    saveTempFile: vi.fn().mockResolvedValue('/tmp/file.pdf'),
    openExternalUrl: vi.fn().mockResolvedValue(true),
    onMainRequestFlush: vi.fn(),
    
    // Shortcuts
    onShortcutMinimizeWindow: vi.fn().mockReturnValue(() => {}),
    onCloseActiveRequested: vi.fn().mockReturnValue(() => {}),
    syncWindowStackOrder: vi.fn().mockResolvedValue({ success: true }),
    
    // To-Do
    createToDo: vi.fn().mockResolvedValue({ id: 'todo-1', title: '', description: null, is_completed: false, user_id: 'user-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    getToDos: vi.fn().mockResolvedValue([]),
    getToDoById: vi.fn().mockResolvedValue(null),
    updateToDo: vi.fn().mockResolvedValue(null),
    deleteToDo: vi.fn().mockResolvedValue(false),
    
    // Audio
    audio: {
      transcribe: vi.fn().mockResolvedValue('')
    },
    
    // Update
    update: {
      checkForUpdates: vi.fn().mockResolvedValue({ checking: false, updateAvailable: false }),
      downloadUpdate: vi.fn().mockResolvedValue({ success: true }),
      installUpdate: vi.fn().mockResolvedValue({ success: true }),
      getStatus: vi.fn().mockResolvedValue({ checking: false, updateAvailable: false }),
      onChecking: vi.fn().mockReturnValue(() => {}),
      onUpdateAvailable: vi.fn().mockReturnValue(() => {}),
      onUpdateNotAvailable: vi.fn().mockReturnValue(() => {}),
      onError: vi.fn().mockReturnValue(() => {}),
      onDownloadProgress: vi.fn().mockReturnValue(() => {}),
      onUpdateDownloaded: vi.fn().mockReturnValue(() => {})
    }
  };
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
 * Helper to wait for async operations in tests (alias for backward compatibility)
 */
export { flushPromises as default };

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