import { ipcMain, app, BrowserWindow } from 'electron';
import { logger } from '../../utils/logger';
import { GET_APP_VERSION } from '../../shared/ipcChannels';
import { getActivityLogService } from '../../services/ActivityLogService';
import type { Services, Models } from './initServices';

// Import IPC handler registration functions
import { registerProfileHandlers } from '../ipc/profile';
import { registerImportBookmarksHandler } from '../ipc/bookmarks';
import { registerSaveTempFileHandler } from '../ipc/saveTempFile';
import { registerGetChatMessagesHandler } from '../ipc/getChatMessages';
import { registerChatStreamStartHandler, registerChatStreamStopHandler } from '../ipc/chatStreamHandler';
import { registerGetSliceDetailsHandler } from '../ipc/getSliceDetails';
import { registerSetIntentHandler } from '../ipc/setIntentHandler';
import { registerDebugHandlers } from '../ipc/debugHandlers';
import { registerNotebookIpcHandlers } from '../ipc/notebookHandlers';
import { registerChatSessionIpcHandlers } from '../ipc/chatSessionHandlers';
import { registerStorageHandlers } from '../ipc/storageHandlers';
import { registerActivityLogHandler } from '../ipc/activityLogHandlers';
import { registerToDoHandlers } from '../ipc/toDoHandlers';
import { registerPdfIngestionHandler } from '../ipc/pdfIngestionHandler';
import { registerComposeNotebookHandler } from '../ipc/composeNotebookHandler';
import { registerOpenExternalUrlHandler } from '../ipc/openExternalUrl';
import { registerCreateNoteHandler } from '../ipc/createNote';
import { registerGetNotesForNotebookHandler } from '../ipc/getNotesForNotebook';
import { registerUpdateNoteHandler } from '../ipc/updateNote';
import { registerDeleteNoteHandler } from '../ipc/deleteNote';
import { registerObjectHandlers } from '../ipc/objectHandlers';
import { registerClassicBrowserCreateHandler } from '../ipc/classicBrowserInitView';
import { registerClassicBrowserNavigateHandler } from '../ipc/classicBrowserNavigate';
import { registerClassicBrowserLoadUrlHandler } from '../ipc/classicBrowserLoadUrl';
import { registerClassicBrowserSetBoundsHandler } from '../ipc/classicBrowserSetBounds';
import { registerClassicBrowserSetVisibilityHandler } from '../ipc/classicBrowserSetVisibility';
import { registerClassicBrowserDestroyHandler } from '../ipc/classicBrowserDestroy';
import { registerClassicBrowserRequestFocusHandler } from '../ipc/classicBrowserRequestFocus';
import { registerClassicBrowserGetStateHandler } from '../ipc/classicBrowserGetState';
import { registerFreezeBrowserViewHandler } from '../ipc/freezeBrowserView';
import { registerUnfreezeBrowserViewHandler } from '../ipc/unfreezeBrowserView';

export function registerAllIpcHandlers(
  services: Services,
  models: Models,
  mainWindow: BrowserWindow | null
) {
  logger.info('[IPC] Registering IPC Handlers...');

  const {
    chatService,
    sliceService,
    intentService,
    notebookService,
    noteService,
    notebookCompositionService,
    classicBrowserService,
    profileService,
    profileAgent,
    pdfIngestionService,
    ingestionQueueService
  } = services;

  const { objectModel } = models;

  // Handle the get-app-version request
  ipcMain.handle(GET_APP_VERSION, () => {
    const version = app.getVersion();
    logger.debug(`[IPC] Returning app version: ${version}`);
    return version;
  });

  // Register other specific handlers
  registerProfileHandlers(ipcMain);
  registerActivityLogHandler(ipcMain);
  
  // Pass objectModel and ingestionQueueService to the bookmark handler
  if (ingestionQueueService) {
    registerImportBookmarksHandler(objectModel, ingestionQueueService);
  } else {
    logger.warn('[IPC] IngestionQueueService not available, bookmark import will not support queuing.');
  }
  
  registerSaveTempFileHandler();
  
  // Pass chatService to the chat handlers
  registerGetChatMessagesHandler(chatService);
  registerChatStreamStartHandler(chatService);
  registerChatStreamStopHandler(chatService);
  registerGetSliceDetailsHandler(sliceService);
  
  // Register the new intent handler
  registerSetIntentHandler(intentService);
  
  // Register Notebook and ChatSession specific handlers
  registerNotebookIpcHandlers(notebookService);
  registerChatSessionIpcHandlers(notebookService);
  
  // Register Notebook Composition Handler
  if (notebookCompositionService) {
    registerComposeNotebookHandler(ipcMain, notebookCompositionService);
  } else {
    logger.warn('[IPC] NotebookCompositionService not available, notebook composition will not be available.');
  }
  
  // Register Storage Handlers
  registerStorageHandlers();
  
  // Register To-Do Handlers
  registerToDoHandlers(ipcMain);
  
  // Register Note Handlers
  if (noteService) {
    registerCreateNoteHandler(ipcMain, noteService);
    registerGetNotesForNotebookHandler(ipcMain, noteService);
    registerUpdateNoteHandler(ipcMain, noteService);
    registerDeleteNoteHandler(ipcMain, noteService);
    logger.info('[IPC] Note IPC handlers registered.');
  } else {
    logger.warn('[IPC] NoteService instance not available, skipping its IPC handler registration.');
  }
  
  // Register Object Handlers
  registerObjectHandlers(ipcMain, objectModel);
  
  // Register Open External URL Handler
  registerOpenExternalUrlHandler();
  
  // Register PDF Ingestion Handlers
  if (pdfIngestionService && mainWindow) {
    if (ingestionQueueService) {
      registerPdfIngestionHandler(ipcMain, pdfIngestionService, mainWindow, ingestionQueueService);
    } else {
      logger.warn('[IPC] IngestionQueueService not available, PDF ingestion handler not registered.');
    }
    logger.info('[IPC] PDF ingestion IPC handlers registered.');
  } else {
    logger.warn('[IPC] PdfIngestionService or mainWindow instance not available, skipping its IPC handler registration.');
  }
  
  // Register debug handlers (only in development)
  if (process.env.NODE_ENV !== 'production' && profileAgent) {
    const activityLogService = getActivityLogService();
    registerDebugHandlers(ipcMain, profileService, activityLogService, profileAgent);
  }
  
  // Register ClassicBrowser Handlers
  if (classicBrowserService) {
    registerClassicBrowserCreateHandler(classicBrowserService);
    registerClassicBrowserLoadUrlHandler(classicBrowserService);
    registerClassicBrowserNavigateHandler(classicBrowserService);
    registerClassicBrowserSetBoundsHandler(classicBrowserService);
    registerClassicBrowserSetVisibilityHandler(classicBrowserService);
    registerClassicBrowserDestroyHandler(classicBrowserService);
    registerClassicBrowserRequestFocusHandler(classicBrowserService);
    registerClassicBrowserGetStateHandler(classicBrowserService);
    registerFreezeBrowserViewHandler(ipcMain, classicBrowserService);
    registerUnfreezeBrowserViewHandler(ipcMain, classicBrowserService);
    logger.info('[IPC] ClassicBrowser IPC handlers registered.');
  } else {
    logger.warn('[IPC] ClassicBrowserService instance not available, skipping its IPC handler registration.');
  }
  
  logger.info('[IPC] All IPC Handlers registered.');
}