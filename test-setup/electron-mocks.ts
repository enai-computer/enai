import { vi } from 'vitest';
import { setupClassicBrowserMocks } from '../test-utils/classic-browser-mocks';
import '@testing-library/jest-dom/vitest';

// Mock ResizeObserver which is not available in test environment
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Setup global window.api mock
const classicBrowserMocks = setupClassicBrowserMocks();

global.window = global.window || {};

// Mock window event listeners for tests
if (!global.window.addEventListener) {
  global.window.addEventListener = vi.fn();
  global.window.removeEventListener = vi.fn();
}

// Mock timer functions that radix-ui expects
if (!global.window.setTimeout) {
  global.window.setTimeout = global.setTimeout;
  global.window.clearTimeout = global.clearTimeout;
  global.window.setInterval = global.setInterval;
  global.window.clearInterval = global.clearInterval;
}

global.window.api = {
  // Classic Browser API
  classicBrowserCreate: classicBrowserMocks.classicBrowserCreate,
  classicBrowserDestroy: classicBrowserMocks.classicBrowserDestroy,
  classicBrowserGetState: classicBrowserMocks.classicBrowserGetState,
  classicBrowserSetBounds: classicBrowserMocks.classicBrowserSetBounds,
  classicBrowserLoadUrl: classicBrowserMocks.classicBrowserLoadUrl,
  classicBrowserNavigate: classicBrowserMocks.classicBrowserNavigate,
  classicBrowserSetVisibility: classicBrowserMocks.classicBrowserSetVisibility,
  classicBrowserRequestFocus: classicBrowserMocks.classicBrowserRequestFocus,
  classicBrowserCreateTab: vi.fn().mockResolvedValue({ success: true, tabId: 'new-tab-id' }),
  classicBrowserSwitchTab: vi.fn().mockResolvedValue({ success: true }),
  classicBrowserCloseTab: vi.fn().mockResolvedValue({ success: true }),
  classicBrowserSetBackgroundColor: vi.fn(),
  captureSnapshot: vi.fn().mockResolvedValue(null),
  showAndFocusView: vi.fn().mockResolvedValue(undefined),
  freezeBrowserView: vi.fn().mockResolvedValue(null),
  unfreezeBrowserView: vi.fn().mockResolvedValue(undefined),
  onClassicBrowserState: classicBrowserMocks.onClassicBrowserState,
  onClassicBrowserStateUpdate: vi.fn((windowId, callback) => {
    return () => {};
  }),
  offClassicBrowserStateUpdate: vi.fn(),
  onClassicBrowserNavigate: vi.fn((windowId, callback) => {
    return () => {};
  }),
  offClassicBrowserNavigate: vi.fn(),
  onClassicBrowserViewFocused: vi.fn(() => () => {}),
  onClassicBrowserUrlChange: vi.fn(() => () => {}),
  onWindowAction: vi.fn(() => () => {}),
  offWindowAction: vi.fn(),

  // Other commonly used APIs (add as needed)
  chat: {
    send: vi.fn().mockResolvedValue({ id: 'msg-1', content: 'response' }),
    stream: vi.fn(),
    getHistory: vi.fn().mockResolvedValue([])
  },
  objects: {
    search: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'obj-1' })
  },
  notebooks: {
    create: vi.fn().mockResolvedValue({ id: 'nb-1' }),
    update: vi.fn().mockResolvedValue({ id: 'nb-1' }),
    delete: vi.fn().mockResolvedValue(undefined)
  },
  // Notebook-related APIs
  getRecentlyViewedNotebooks: vi.fn().mockResolvedValue([]),
  composeNotebook: vi.fn().mockResolvedValue({ notebookId: 'nb-1' }),
  
  // Note-related APIs
  getNotesForNotebook: vi.fn().mockResolvedValue([]),
  createNote: vi.fn().mockResolvedValue({ id: 'note-1' }),
  updateNote: vi.fn().mockResolvedValue(undefined),
  
  // Intent APIs
  setIntent: vi.fn().mockResolvedValue(undefined),
  // Store methods
  storeGet: vi.fn().mockResolvedValue(null),
  storeSet: vi.fn().mockResolvedValue(undefined),
  storeRemove: vi.fn().mockResolvedValue(undefined),
  onMainRequestFlush: vi.fn(),
  // Profile/Activity/Weather
  getProfile: vi.fn().mockResolvedValue({ userId: 'default_user' }),
  updateProfile: vi.fn().mockResolvedValue({ userId: 'default_user' }),
  getWeather: vi.fn().mockResolvedValue({ temperature: 20 }),
  logActivity: vi.fn().mockResolvedValue(undefined),
  
  // App Info
  getAppVersion: vi.fn().mockResolvedValue('1.0.0'),
  
  // System/External
  saveTempFile: vi.fn().mockResolvedValue('/tmp/file'),
  openExternalUrl: vi.fn().mockResolvedValue(true),
  
  // Bookmarks
  importBookmarks: vi.fn().mockResolvedValue(0),
  onBookmarksProgress: vi.fn(() => () => {}),
  
  // URL Ingestion
  ingestUrl: vi.fn().mockResolvedValue({ jobId: null, alreadyExists: false }),
  
  // Other notebook/chat methods
  getNotebookById: vi.fn().mockResolvedValue(null),
  getAllNotebooks: vi.fn().mockResolvedValue([]),
  updateNotebook: vi.fn().mockResolvedValue(null),
  deleteNotebook: vi.fn().mockResolvedValue(false),
  getChunksForNotebook: vi.fn().mockResolvedValue([]),
  getOrCreateDailyNotebook: vi.fn().mockResolvedValue({ id: 'daily-1' }),
  createChatInNotebook: vi.fn().mockResolvedValue({ id: 'chat-1' }),
  listChatsForNotebook: vi.fn().mockResolvedValue([]),
  transferChatToNotebook: vi.fn().mockResolvedValue(false),
  startChatStream: vi.fn(),
  stopChatStream: vi.fn(),
  onChatChunk: vi.fn(() => () => {}),
  onChatStreamEnd: vi.fn(() => () => {}),
  onChatStreamError: vi.fn(() => () => {}),
  getMessages: vi.fn().mockResolvedValue([]),
  getSliceDetails: vi.fn().mockResolvedValue([]),
  
  // Intent methods
  onIntentResult: vi.fn(() => () => {}),
  onIntentStreamStart: vi.fn(() => () => {}),
  onIntentStreamChunk: vi.fn(() => () => {}),
  onIntentStreamEnd: vi.fn(() => () => {}),
  onIntentStreamError: vi.fn(() => () => {}),
  onSuggestedActions: vi.fn(() => () => {}),
  
  // Shortcuts
  onShortcutMinimizeWindow: vi.fn(() => () => {}),
  onCloseActiveRequested: vi.fn(() => () => {}),
  syncWindowStackOrder: vi.fn().mockResolvedValue({ success: true }),
  
  // To-Do
  createToDo: vi.fn().mockResolvedValue({ id: 'todo-1' }),
  getToDos: vi.fn().mockResolvedValue([]),
  getToDoById: vi.fn().mockResolvedValue(null),
  updateToDo: vi.fn().mockResolvedValue(null),
  deleteToDo: vi.fn().mockResolvedValue(false),
  
  // PDF Ingestion
  ingestPdfs: vi.fn().mockResolvedValue(undefined),
  onPdfIngestProgress: vi.fn(() => () => {}),
  onPdfIngestBatchComplete: vi.fn(() => () => {}),
  cancelPdfIngest: vi.fn(),
  
  // Object operations
  getObjectById: vi.fn().mockResolvedValue(null),
  deleteObjects: vi.fn().mockResolvedValue({ deletedCount: 0 }),
  deleteObjectBySourceUri: vi.fn().mockResolvedValue({ deletedCount: 0 }),
  
  // Note operations  
  deleteNote: vi.fn().mockResolvedValue(false),
  
  // Audio
  audio: {
    transcribe: vi.fn().mockResolvedValue('transcribed text')
  },
  
  // WOM
  wom: {
    ingestWebpage: vi.fn().mockResolvedValue({ success: true }),
    updateAccess: vi.fn().mockResolvedValue({ success: true }),
    createTabGroup: vi.fn().mockResolvedValue({ success: true }),
    updateTabGroup: vi.fn().mockResolvedValue({ success: true }),
    enrichComposite: vi.fn().mockResolvedValue({ scheduled: true }),
    onIngestionStarted: vi.fn(() => () => {}),
    onIngestionComplete: vi.fn(() => () => {})
  },
  
  // Update
  update: {
    checkForUpdates: vi.fn().mockResolvedValue({ checking: false, updateAvailable: false }),
    downloadUpdate: vi.fn().mockResolvedValue({ success: true }),
    installUpdate: vi.fn().mockResolvedValue({ success: true }),
    getStatus: vi.fn().mockResolvedValue({ checking: false, updateAvailable: false }),
    onChecking: vi.fn(() => () => {}),
    onUpdateAvailable: vi.fn(() => () => {}),
    onUpdateNotAvailable: vi.fn(() => () => {}),
    onError: vi.fn(() => () => {}),
    onDownloadProgress: vi.fn(() => () => {}),
    onUpdateDownloaded: vi.fn(() => () => {})
  }
} as any;

// Export mocks for test access
export { classicBrowserMocks };

// Helper to reset all mocks between tests
export const resetAllMocks = () => {
  Object.values(global.window.api).forEach(api => {
    if (typeof api === 'object') {
      Object.values(api).forEach(method => {
        if (typeof method === 'function' && 'mockClear' in method) {
          (method as any).mockClear();
        }
      });
    } else if (typeof api === 'function' && 'mockClear' in api) {
      (api as any).mockClear();
    }
  });
  
  // Reset classic browser mock callbacks
  if (classicBrowserMocks.onClassicBrowserState._callbacks) {
    classicBrowserMocks.onClassicBrowserState._callbacks = [];
  }
};