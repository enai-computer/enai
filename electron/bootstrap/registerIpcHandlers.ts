import { ipcMain, app, BrowserWindow } from 'electron';
import { logger } from '../../utils/logger';
import { GET_APP_VERSION } from '../../shared/ipcChannels';
import { ServiceRegistry } from './serviceBootstrap';
import { ObjectModel } from '../../models/ObjectModel';

// Import IPC handler registration functions
import { registerProfileHandlers } from '../ipc/profile';
import { registerImportBookmarksHandler } from '../ipc/bookmarks';
import { registerIngestUrlHandler } from '../ipc/ingestUrl';
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
import { registerWeatherHandlers } from '../ipc/weatherHandlers';
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
import { registerClassicBrowserCreateTab } from '../ipc/classicBrowserCreateTab';
import { registerClassicBrowserSwitchTab } from '../ipc/classicBrowserSwitchTab';
import { registerClassicBrowserCloseTab } from '../ipc/classicBrowserCloseTab';
import { registerClassicBrowserSetBackgroundColorHandler } from '../ipc/classicBrowserSetBackgroundColor';
import { registerSyncWindowStackOrderHandler } from '../ipc/syncWindowStackOrder';
import { registerAudioHandlers } from '../ipc/audioHandlers';
import { registerWOMHandlers } from '../ipc/womHandlers';

export function registerAllIpcHandlers(
  serviceRegistry: ServiceRegistry,
  objectModel: ObjectModel,
  mainWindow: BrowserWindow | null
) {
  logger.info('[IPC] Registering IPC Handlers...');

  const {
    chat: chatService,
    slice: sliceService,
    intent: intentService,
    notebook: notebookService,
    note: noteService,
    notebookComposition: notebookCompositionService,
    classicBrowser: classicBrowserService,
    profile: profileService,
    profileAgent,
    pdfIngestion: pdfIngestionService,
    ingestionQueue: ingestionQueueService
  } = serviceRegistry;

  // Handle the get-app-version request
  ipcMain.handle(GET_APP_VERSION, () => {
    const version = app.getVersion();
    logger.debug(`[IPC] Returning app version: ${version}`);
    return version;
  });

  // Register other specific handlers
  if (profileService) {
    registerProfileHandlers(ipcMain, profileService);
  } else {
    logger.warn('[IPC] ProfileService not available from registry, profile handlers not registered.');
  }
  
  if (serviceRegistry.activityLog) {
    registerActivityLogHandler(ipcMain, serviceRegistry.activityLog);
  } else {
    logger.warn('[IPC] ActivityLogService not available from registry, activity log handler not registered.');
  }
  
  // Pass objectModel and ingestionQueueService to the bookmark handler
  if (ingestionQueueService) {
    registerImportBookmarksHandler(objectModel, ingestionQueueService);
  } else {
    logger.warn('[IPC] IngestionQueueService not available, bookmark import will not support queuing.');
  }
  
  // Register URL ingestion handler
  if (ingestionQueueService) {
    registerIngestUrlHandler(ingestionQueueService, classicBrowserService);
    logger.info('[IPC] URL ingestion handler registered.');
  } else {
    logger.warn('[IPC] IngestionQueueService not available, URL ingestion will not be available.');
  }
  
  registerSaveTempFileHandler();
  
  // Pass chatService to the chat handlers
  if (chatService) {
    registerGetChatMessagesHandler(chatService);
    registerChatStreamStartHandler(chatService);
    registerChatStreamStopHandler(chatService);
  } else {
    logger.warn('[IPC] ChatService not available, chat handlers not registered.');
  }
  
  if (sliceService) {
    registerGetSliceDetailsHandler(sliceService);
  } else {
    logger.warn('[IPC] SliceService not available, slice details handler not registered.');
  }
  
  // Register the new intent handler
  if (intentService) {
    registerSetIntentHandler(intentService);
  } else {
    logger.warn('[IPC] IntentService not available, intent handler not registered.');
  }
  
  // Register Notebook and ChatSession specific handlers
  if (notebookService) {
    registerNotebookIpcHandlers(notebookService);
    registerChatSessionIpcHandlers(notebookService);
  } else {
    logger.warn('[IPC] NotebookService not available, notebook handlers not registered.');
  }
  
  // Register Notebook Composition Handler
  if (notebookCompositionService) {
    registerComposeNotebookHandler(ipcMain, notebookCompositionService);
  } else {
    logger.warn('[IPC] NotebookCompositionService not available, notebook composition will not be available.');
  }
  
  // Register Storage Handlers
  registerStorageHandlers();
  
  // Register To-Do Handlers
  if (serviceRegistry.todo) {
    registerToDoHandlers(ipcMain, serviceRegistry.todo);
  } else {
    logger.warn('[IPC] ToDoService not available from registry, to-do handlers not registered.');
  }
  
  // Register Weather Handlers
  if (serviceRegistry.weather) {
    registerWeatherHandlers(ipcMain, serviceRegistry.weather);
  } else {
    logger.warn('[IPC] WeatherService not available from registry, weather handlers not registered.');
  }
  
  // Register Audio Transcription Handlers
  if (serviceRegistry.audioTranscription) {
    registerAudioHandlers(ipcMain, serviceRegistry.audioTranscription);
    logger.info('[IPC] Audio transcription handlers registered.');
  } else {
    logger.warn('[IPC] AudioTranscriptionService not available from registry, audio handlers not registered.');
  }
  
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
  registerObjectHandlers(ipcMain, objectModel, serviceRegistry.object, classicBrowserService);
  
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
  if (process.env.NODE_ENV !== 'production' && profileAgent && profileService && serviceRegistry.activityLog) {
    registerDebugHandlers(ipcMain, profileService, serviceRegistry.activityLog, profileAgent);
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
    // Register tab management handlers
    registerClassicBrowserCreateTab(ipcMain, classicBrowserService);
    registerClassicBrowserSwitchTab(ipcMain, classicBrowserService);
    registerClassicBrowserCloseTab(ipcMain, classicBrowserService);
    registerClassicBrowserSetBackgroundColorHandler(classicBrowserService);
    // Register window stack synchronization handler
    registerSyncWindowStackOrderHandler(classicBrowserService);
    logger.info('[IPC] ClassicBrowser IPC handlers registered.');
  } else {
    logger.warn('[IPC] ClassicBrowserService instance not available, skipping its IPC handler registration.');
  }
  
  // Register WOM Handlers
  if (serviceRegistry.womIngestion && serviceRegistry.compositeEnrichment && classicBrowserService) {
    registerWOMHandlers(ipcMain, {
      womIngestionService: serviceRegistry.womIngestion,
      compositeEnrichmentService: serviceRegistry.compositeEnrichment,
      classicBrowserService: classicBrowserService,
      objectModel: objectModel
    });
    logger.info('[IPC] WOM (Working Memory) IPC handlers registered.');
  } else {
    logger.warn('[IPC] WOM services not available, skipping WOM handler registration.');
  }
  
  logger.info('[IPC] All IPC Handlers registered.');
}