import { vi } from 'vitest';
import type { IAppAPI } from '../../../shared/types/api.types';

/**
 * Creates a complete mock of the window.api object with all required IAppAPI methods.
 * All methods are vi.fn() mocks that can be configured per test.
 */
export function createMockWindowApi(): IAppAPI {
  return {
    // App info methods
    getAppVersion: vi.fn().mockResolvedValue('0.0.0-test'),
    
    // Profile methods
    getProfile: vi.fn().mockResolvedValue({
      id: 'test-user',
      name: 'Test User',
      goals: [],
      expertiseAreas: [],
      preferences: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    updateProfile: vi.fn().mockImplementation((payload) => Promise.resolve({
      id: 'test-user',
      name: 'Test User',
      goals: [],
      expertiseAreas: [],
      preferences: {},
      ...payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    getWeather: vi.fn().mockResolvedValue({
      temperature: 68,
      icon: 'sunny' as const,
      description: 'sunny',
      timestamp: new Date().toISOString(),
    }),
    logActivity: vi.fn().mockResolvedValue(undefined),
    
    // File operations
    importBookmarks: vi.fn().mockResolvedValue(0),
    saveTempFile: vi.fn().mockResolvedValue('/tmp/testfile'),
    openExternalUrl: vi.fn().mockResolvedValue(true),
    onBookmarksProgress: vi.fn().mockReturnValue(() => {}),
    ingestUrl: vi.fn().mockResolvedValue({ jobId: 'test-job-id', alreadyExists: false }),
    
    // Notebook operations
    getNotebookById: vi.fn().mockResolvedValue(null),
    getAllNotebooks: vi.fn().mockResolvedValue([]),
    getRecentlyViewedNotebooks: vi.fn().mockResolvedValue([]),
    updateNotebook: vi.fn().mockResolvedValue(null),
    deleteNotebook: vi.fn().mockResolvedValue(false),
    getChunksForNotebook: vi.fn().mockResolvedValue([]),
    getOrCreateDailyNotebook: vi.fn().mockResolvedValue({
      id: 'daily-notebook',
      title: 'Daily Notebook',
      description: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    composeNotebook: vi.fn().mockResolvedValue({ notebookId: 'new-notebook-id' }),
    
    // Chat operations
    createChatInNotebook: vi.fn().mockResolvedValue({
      id: 'chat-session-id',
      notebookId: 'notebook-id',
      title: 'New Chat',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    listChatsForNotebook: vi.fn().mockResolvedValue([]),
    transferChatToNotebook: vi.fn().mockResolvedValue(false),
    startChatStream: vi.fn(),
    stopChatStream: vi.fn(),
    onChatChunk: vi.fn().mockReturnValue(() => {}),
    onChatStreamEnd: vi.fn().mockReturnValue(() => {}),
    onChatStreamError: vi.fn().mockReturnValue(() => {}),
    getMessages: vi.fn().mockResolvedValue([]),
    getSliceDetails: vi.fn().mockResolvedValue([]),
    
    // Intent handling
    setIntent: vi.fn().mockResolvedValue(undefined),
    onIntentResult: vi.fn().mockReturnValue(() => {}),
    onIntentStreamStart: vi.fn().mockReturnValue(() => {}),
    onIntentStreamChunk: vi.fn().mockReturnValue(() => {}),
    onIntentStreamEnd: vi.fn().mockReturnValue(() => {}),
    onIntentStreamError: vi.fn().mockReturnValue(() => {}),
    onSuggestedActions: vi.fn().mockReturnValue(() => {}),
    
    // Store persistence
    storeGet: vi.fn().mockResolvedValue(null),
    storeSet: vi.fn().mockResolvedValue(undefined),
    storeRemove: vi.fn().mockResolvedValue(undefined),
    onMainRequestFlush: vi.fn(),
    
    // Classic browser
    classicBrowserCreate: vi.fn().mockResolvedValue({ success: true }),
    classicBrowserLoadUrl: vi.fn().mockResolvedValue(undefined),
    classicBrowserNavigate: vi.fn().mockResolvedValue(undefined),
    classicBrowserSetBounds: vi.fn(),
    classicBrowserSetVisibility: vi.fn(),
    classicBrowserDestroy: vi.fn().mockResolvedValue(undefined),
    classicBrowserGetState: vi.fn().mockResolvedValue(null),
    onClassicBrowserState: vi.fn().mockReturnValue(() => {}),
    onClassicBrowserViewFocused: vi.fn().mockReturnValue(() => {}),
    classicBrowserRequestFocus: vi.fn(),
    onClassicBrowserUrlChange: vi.fn().mockReturnValue(() => {}),
    captureSnapshot: vi.fn().mockResolvedValue(null),
    showAndFocusView: vi.fn().mockResolvedValue(undefined),
    freezeBrowserView: vi.fn().mockResolvedValue(null),
    unfreezeBrowserView: vi.fn().mockResolvedValue(undefined),
    classicBrowserCreateTab: vi.fn().mockResolvedValue({ success: true }),
    classicBrowserSwitchTab: vi.fn().mockResolvedValue({ success: true }),
    classicBrowserCloseTab: vi.fn().mockResolvedValue({ success: true }),
    classicBrowserSetBackgroundColor: vi.fn(),
    notifySidebarHover: vi.fn().mockResolvedValue(undefined),
    
    // Browser context menu
    browserContextMenu: {
      onShow: vi.fn().mockReturnValue(() => {}),
      onHide: vi.fn().mockReturnValue(() => {}),
      sendAction: vi.fn().mockResolvedValue(undefined),
      notifyReady: vi.fn(),
      notifyClosed: vi.fn(() => {}),
    },
    
    // Window management
    onShortcutMinimizeWindow: vi.fn().mockReturnValue(() => {}),
    onCloseActiveRequested: vi.fn().mockReturnValue(() => {}),
    syncWindowStackOrder: vi.fn().mockResolvedValue({ success: true }),
    
    // Todo operations
    createToDo: vi.fn().mockResolvedValue({
      id: 'todo-id',
      userId: 'user-id',
      content: 'Test todo',
      status: 'pending',
      priority: 'medium',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    getToDos: vi.fn().mockResolvedValue([]),
    getToDoById: vi.fn().mockResolvedValue(null),
    updateToDo: vi.fn().mockResolvedValue(null),
    deleteToDo: vi.fn().mockResolvedValue(false),
    
    // PDF ingestion
    ingestPdfs: vi.fn().mockResolvedValue(undefined),
    onPdfIngestProgress: vi.fn().mockReturnValue(() => {}),
    onPdfIngestBatchComplete: vi.fn().mockReturnValue(() => {}),
    cancelPdfIngest: vi.fn(),
    
    // Object operations
    getObjectById: vi.fn().mockResolvedValue(null),
    deleteObjects: vi.fn().mockResolvedValue({ deletedCount: 0, errors: [] }),
    deleteObjectBySourceUri: vi.fn().mockResolvedValue({ deletedCount: 0, errors: [] }),
    
    // Note operations
    createNote: vi.fn().mockResolvedValue({
      id: 'note-id',
      notebookId: 'notebook-id',
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    getNotesForNotebook: vi.fn().mockResolvedValue([]),
    updateNote: vi.fn().mockResolvedValue(null),
    deleteNote: vi.fn().mockResolvedValue(false),
    
    // Audio transcription
    audio: {
      transcribe: vi.fn().mockResolvedValue('Transcribed text'),
    },
    
    // Update operations
    update: {
      checkForUpdates: vi.fn().mockResolvedValue({
        checking: false,
        updateAvailable: false,
      }),
      downloadUpdate: vi.fn().mockResolvedValue({ success: true }),
      installUpdate: vi.fn().mockResolvedValue({ success: true }),
      getStatus: vi.fn().mockResolvedValue({
        checking: false,
        updateAvailable: false,
      }),
      onChecking: vi.fn().mockReturnValue(() => {}),
      onUpdateAvailable: vi.fn().mockReturnValue(() => {}),
      onUpdateNotAvailable: vi.fn().mockReturnValue(() => {}),
      onError: vi.fn().mockReturnValue(() => {}),
      onDownloadProgress: vi.fn().mockReturnValue(() => {}),
      onUpdateDownloaded: vi.fn().mockReturnValue(() => {}),
    },
  };
}

/**
 * Creates a partial mock of window.api with only specified methods.
 * Useful when you only need to mock specific methods for a test.
 */
export function createPartialMockWindowApi(methods: Partial<IAppAPI>): IAppAPI {
  const fullMock = createMockWindowApi();
  return { ...fullMock, ...methods };
}