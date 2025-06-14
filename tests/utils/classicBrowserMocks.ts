import { vi } from 'vitest';
import type { IAppAPI } from '../../shared/types';
import type { ClassicBrowserPayload, TabState } from '../../shared/types';
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
    activeTabId: finalActiveTabId
  };
}

/**
 * Creates a mock window.api object for frontend tests
 */
export function createMockWindowApi(): IAppAPI {
  return {
    // ClassicBrowser methods
    classicBrowserCreate: vi.fn().mockResolvedValue(undefined),
    classicBrowserCreateTab: vi.fn().mockResolvedValue('new-tab-id'),
    classicBrowserSwitchTab: vi.fn().mockResolvedValue({ success: true }),
    classicBrowserCloseTab: vi.fn().mockResolvedValue({ success: true }),
    classicBrowserLoadUrl: vi.fn().mockResolvedValue(undefined),
    classicBrowserNavigate: vi.fn().mockResolvedValue(undefined),
    classicBrowserGetState: vi.fn().mockResolvedValue(null),
    classicBrowserSetBounds: vi.fn().mockResolvedValue(undefined),
    classicBrowserSetVisibility: vi.fn().mockResolvedValue(undefined),
    classicBrowserSetBackgroundColor: vi.fn().mockResolvedValue(undefined),
    classicBrowserCaptureAndHide: vi.fn().mockResolvedValue(null),
    classicBrowserShowAndFocus: vi.fn().mockResolvedValue(undefined),
    classicBrowserDestroy: vi.fn().mockResolvedValue(undefined),
    
    // Store methods
    storeGet: vi.fn().mockResolvedValue(null),
    storeSet: vi.fn().mockResolvedValue(undefined),
    storeDelete: vi.fn().mockResolvedValue(undefined),
    
    // Event listeners
    on: vi.fn(),
    off: vi.fn(),
    
    // Other methods (stubbed)
    chatSend: vi.fn(),
    chatStream: vi.fn(),
    chatGetHistory: vi.fn(),
    chatGetSessions: vi.fn(),
    chatCreateSession: vi.fn(),
    chatSwitchSession: vi.fn(),
    chatUpdateSession: vi.fn(),
    chatDeleteSession: vi.fn(),
    chatDeleteMessage: vi.fn(),
    chatDeleteMessages: vi.fn(),
    searchObjects: vi.fn(),
    getObject: vi.fn(),
    createObject: vi.fn(),
    deleteObject: vi.fn(),
    updateObject: vi.fn(),
    searchSlices: vi.fn(),
    createNotebook: vi.fn(),
    updateNotebook: vi.fn(),
    deleteNotebook: vi.fn(),
    getNotebook: vi.fn(),
    searchNotebooks: vi.fn(),
    ingestUrl: vi.fn(),
    ingestPdf: vi.fn(),
    addBookmarks: vi.fn(),
    getUserInfo: vi.fn(),
    setUserInfo: vi.fn(),
    prefetchFavicon: vi.fn(),
    prefetchFaviconsForWindows: vi.fn(),
    showContextMenu: vi.fn(),
    clipboardWriteText: vi.fn(),
    getAppVersion: vi.fn(),
    logActivity: vi.fn(),
    openDevTools: vi.fn(),
    reloadApp: vi.fn(),
    restartApp: vi.fn(),
    quitApp: vi.fn(),
    minimizeApp: vi.fn(),
    maximizeApp: vi.fn(),
    unmaximizeApp: vi.fn(),
    isMaximizedApp: vi.fn(),
    closeWindow: vi.fn(),
    createWindow: vi.fn(),
    focusWindow: vi.fn(),
    onShowListener: vi.fn(),
    onWebLayerStateUpdate: vi.fn(),
    offWebLayerStateUpdate: vi.fn(),
    setWebLayerState: vi.fn(),
    onClassicBrowserStateUpdate: vi.fn(),
    offClassicBrowserStateUpdate: vi.fn(),
    onClassicBrowserNavigate: vi.fn(),
    offClassicBrowserNavigate: vi.fn(),
    onWindowAction: vi.fn(),
    offWindowAction: vi.fn()
  } as unknown as IAppAPI;
}

/**
 * Creates a mock WebContents object
 */
export function createMockWebContents(): Partial<WebContents> {
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
    id: 12345,
    session: {
      webRequest: {
        onBeforeRequest: vi.fn()
      }
    } as any
  };
}

/**
 * Creates a mock WebContentsView
 */
export function createMockWebContentsView(): Partial<WebContentsView> {
  const mockWebContents = createMockWebContents();
  return {
    webContents: mockWebContents as WebContents,
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    setBackgroundColor: vi.fn(),
    setBorderRadius: vi.fn(),
    destroy: vi.fn()
  };
}

/**
 * Creates a mock BrowserWindow
 */
export function createMockBrowserWindow(): Partial<BrowserWindow> {
  const mockWebContents = createMockWebContents();
  return {
    id: 1,
    webContents: mockWebContents as WebContents,
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
      children: []
    } as any,
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
  const events: Array<{ channel: string; payload: any }> = [];
  
  const spy = vi.fn((channel: string, payload: any) => {
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
  const handlers = new Map<string, Function>();
  
  return {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
    // Helper to trigger a handler for testing
    trigger: async (channel: string, event: any, ...args: any[]) => {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`No handler registered for channel: ${channel}`);
      }
      return handler(event, ...args);
    },
    handlers
  };
}