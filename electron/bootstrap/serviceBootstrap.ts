import { logger } from '../../utils/logger';
import { 
  IService, 
  ServiceConfig,
  ServiceHealthResult
} from '../../services/interfaces';
import Database from 'better-sqlite3';
import initModels from './modelBootstrap';

// Services
import { ProfileService } from '../../services/ProfileService';
import { ToDoService } from '../../services/ToDoService';
import { ActivityLogService } from '../../services/ActivityLogService';
import { HybridSearchService } from '../../services/HybridSearchService';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { ClassicBrowserStateService } from '../../services/browser/ClassicBrowserStateService';
import { ClassicBrowserNavigationService } from '../../services/browser/ClassicBrowserNavigationService';
import { ClassicBrowserTabService } from '../../services/browser/ClassicBrowserTabService';
import { ClassicBrowserWOMService } from '../../services/browser/ClassicBrowserWOMService';
import { ClassicBrowserSnapshotService } from '../../services/browser/ClassicBrowserSnapshotService';
import { ClassicBrowserViewManager } from '../../services/browser/ClassicBrowserViewManager';
import { SchedulerService } from '../../services/SchedulerService';
import { ExaService } from '../../services/ExaService';
import { ChatService } from '../../services/ChatService';
import { NotebookService } from '../../services/NotebookService';
import { AgentService } from '../../services/AgentService';
import { SliceService } from '../../services/SliceService';
import { IntentService } from '../../services/IntentService';
import { ActionSuggestionService } from '../../services/ActionSuggestionService';
import { LangchainAgent } from '../../services/agents/LangchainAgent';
import { ProfileAgent } from '../../services/agents/ProfileAgent';
import { IngestionAiService } from '../../services/ingestion/IngestionAIService';
import { PdfIngestionService } from '../../services/ingestion/PdfIngestionService';
import { ChunkingService } from '../../services/ingestion/ChunkingService';
import { IngestionQueueService } from '../../services/ingestion/IngestionQueueService';
import { SearchResultFormatter } from '../../services/SearchResultFormatter';
import { NoteService } from '../../services/NoteService';
import { ObjectService } from '../../services/ObjectService';
import { NotebookCompositionService } from '../../services/NotebookCompositionService';
import { StreamManager } from '../../services/StreamManager';
import { WeatherService } from '../../services/WeatherService';
import { AudioTranscriptionService } from '../../services/AudioTranscriptionService';
import { WOMIngestionService } from '../../services/WOMIngestionService';
import { CompositeObjectEnrichmentService } from '../../services/CompositeObjectEnrichmentService';

import { BrowserWindow } from 'electron';
import { EventEmitter } from 'events';

/**
 * Service registry to manage all application services
 */
export interface ServiceRegistry {
  
  // Core services
  activityLog?: ActivityLogService;
  agent?: AgentService;
  chat?: ChatService;
  classicBrowser?: ClassicBrowserService;
  
  // Browser sub-services
  classicBrowserState?: ClassicBrowserStateService;
  classicBrowserNavigation?: ClassicBrowserNavigationService;
  classicBrowserTab?: ClassicBrowserTabService;
  classicBrowserWOM?: ClassicBrowserWOMService;
  classicBrowserSnapshot?: ClassicBrowserSnapshotService;
  classicBrowserViewManager?: ClassicBrowserViewManager;
  
  exa?: ExaService;
  hybridSearch?: HybridSearchService;
  intent?: IntentService;
  notebook?: NotebookService;
  notebookComposition?: NotebookCompositionService;
  note?: NoteService;
  object?: ObjectService;
  profile?: ProfileService;
  profileAgent?: ProfileAgent;
  scheduler?: SchedulerService;
  searchResultFormatter?: SearchResultFormatter;
  slice?: SliceService;
  streamManager?: StreamManager;
  todo?: ToDoService;
  weather?: WeatherService;
  audioTranscription?: AudioTranscriptionService;
  
  // Ingestion services
  ingestionQueue?: IngestionQueueService;
  ingestionAI?: IngestionAiService;
  chunking?: ChunkingService;
  pdfIngestion?: PdfIngestionService;
  
  // WOM services
  womIngestion?: any; // WOMIngestionService type
  compositeEnrichment?: any; // CompositeObjectEnrichmentService type
  
  // Add any service instance dynamically
  [key: string]: IService | undefined;
}

/**
 * Dependencies required to initialize services
 */
export interface ServiceInitDependencies {
  db: Database.Database;
  mainWindow?: BrowserWindow; // Optional for services that need it
}

/**
 * Helper function to create and initialize a service with consistent logging
 */
async function createService<T extends IService>(
  name: string,
  ServiceClass: new (...args: any[]) => T,
  deps: any[],
  options?: { skipInit?: boolean }
): Promise<T> {
  logger.info(`[ServiceBootstrap] Creating ${name}...`);
  const service = new ServiceClass(...deps);
  
  if (!options?.skipInit) {
    await service.initialize();
  }
  
  logger.info(`[ServiceBootstrap] ${name} ${options?.skipInit ? 'created' : 'initialized'}`);
  return service;
}

/**
 * Initialize all application services
 * @param deps Dependencies required by services
 * @param config Configuration for service initialization
 * @returns Initialized service registry
 */
export async function initializeServices(
  deps: ServiceInitDependencies,
  config: ServiceConfig = {}
): Promise<ServiceRegistry> {
  logger.info('[ServiceBootstrap] Starting service initialization...');
  
  const {
    // parallel = false,
    // initTimeout = 30000,
    // continueOnError = false
  } = config;

  const registry: ServiceRegistry = {};
  const startTime = Date.now();

  try {
    
    // Phase 2: Initialize simple services
    logger.info('[ServiceBootstrap] Initializing Phase 2 services...');
    
    // Initialize all models through the single composition root
    logger.info('[ServiceBootstrap] Initializing models...');
    const models = await initModels(deps.db);
    const { userProfileModel, toDoModel, activityLogModel, vectorModel, objectModel } = models;
    
    // Initialize ActivityLogService first (depends on ActivityLogModel and ObjectModel)
    const activityLogService = await createService('ActivityLogService', ActivityLogService, [{
      db: deps.db,
      activityLogModel,
      objectModel,
      lanceVectorModel: vectorModel
    }]);
    registry.activityLog = activityLogService;
    
    // Initialize ProfileService (no dependencies on other services)
    const profileService = await createService('ProfileService', ProfileService, [{
      db: deps.db,
      userProfileModel
    }]);
    registry.profile = profileService;
    
    // Initialize ToDoService (depends on ActivityLogService)
    const toDoService = await createService('ToDoService', ToDoService, [{
      db: deps.db,
      toDoModel,
      activityLogService
    }]);
    registry.todo = toDoService;
    
    // Initialize WeatherService (no dependencies)
    registry.weather = await createService('WeatherService', WeatherService, []);
    
    // Initialize AudioTranscriptionService (no dependencies on other services)
    registry.audioTranscription = await createService('AudioTranscriptionService', AudioTranscriptionService, [{
      db: deps.db
    }]);
    
    // Phase 4: Initialize specialized services
    logger.info('[ServiceBootstrap] Initializing Phase 4 services...');
    
    // Initialize SchedulerService (no dependencies)
    const schedulerService = await createService('SchedulerService', SchedulerService, []);
    registry.scheduler = schedulerService;
    
    // Initialize ExaService (no dependencies, no initialization needed)
    const exaService = await createService('ExaService', ExaService, [], { skipInit: true });
    registry.exa = exaService;
    
    // Initialize HybridSearchService (depends on ExaService and vector model)
    const hybridSearchService = await createService('HybridSearchService', HybridSearchService, [{
      exaService,
      vectorModel: vectorModel
    }]);
    registry.hybridSearch = hybridSearchService;
    
    // Initialize browser sub-services
    let classicBrowserViewManager: ClassicBrowserViewManager | undefined;
    let classicBrowserStateService: ClassicBrowserStateService | undefined;
    let classicBrowserNavigationService: ClassicBrowserNavigationService | undefined;
    let classicBrowserTabService: ClassicBrowserTabService | undefined;
    let classicBrowserWOMService: ClassicBrowserWOMService | undefined;
    let classicBrowserSnapshotService: ClassicBrowserSnapshotService | undefined;
    let classicBrowserService: ClassicBrowserService | undefined;

    if (deps.mainWindow) {
      logger.info('[ServiceBootstrap] Creating browser sub-services...');
      
      // Create a shared EventEmitter for all browser sub-services
      const browserEventEmitter = new EventEmitter();
      
      // Initialize ClassicBrowserViewManager first
      classicBrowserViewManager = new ClassicBrowserViewManager({
        mainWindow: deps.mainWindow,
        eventEmitter: browserEventEmitter
      });
      await classicBrowserViewManager.initialize();
      registry.classicBrowserViewManager = classicBrowserViewManager;
      logger.info('[ServiceBootstrap] ClassicBrowserViewManager initialized');
      
      // Initialize ClassicBrowserStateService
      classicBrowserStateService = new ClassicBrowserStateService({
        mainWindow: deps.mainWindow,
        eventEmitter: browserEventEmitter
      });
      await classicBrowserStateService.initialize();
      registry.classicBrowserState = classicBrowserStateService;
      logger.info('[ServiceBootstrap] ClassicBrowserStateService initialized');
      
      // Initialize ClassicBrowserNavigationService
      classicBrowserNavigationService = new ClassicBrowserNavigationService({
        viewManager: classicBrowserViewManager,
        stateService: classicBrowserStateService,
        eventEmitter: browserEventEmitter
      });
      await classicBrowserNavigationService.initialize();
      registry.classicBrowserNavigation = classicBrowserNavigationService;
      logger.info('[ServiceBootstrap] ClassicBrowserNavigationService initialized');
      
      // Initialize ClassicBrowserTabService (doesn't extend BaseService yet)
      classicBrowserTabService = new ClassicBrowserTabService({
        stateService: classicBrowserStateService,
        viewManager: classicBrowserViewManager,
        navigationService: classicBrowserNavigationService
      });
      await classicBrowserTabService.initialize();
      registry.classicBrowserTab = classicBrowserTabService;
      logger.info('[ServiceBootstrap] ClassicBrowserTabService initialized');
      
      // Initialize ClassicBrowserWOMService (depends on objectModel - will be updated later)
      classicBrowserWOMService = new ClassicBrowserWOMService({
        objectModel: models.objectModel,
        compositeEnrichmentService: null as any, // Will be updated later
        eventEmitter: browserEventEmitter,
        stateService: classicBrowserStateService
      });
      await classicBrowserWOMService.initialize();
      registry.classicBrowserWOM = classicBrowserWOMService;
      logger.info('[ServiceBootstrap] ClassicBrowserWOMService initialized (without WOM dependencies)');
      
      // Initialize ClassicBrowserSnapshotService
      classicBrowserSnapshotService = new ClassicBrowserSnapshotService({
        viewManager: classicBrowserViewManager,
        stateService: classicBrowserStateService,
        navigationService: classicBrowserNavigationService
      });
      await classicBrowserSnapshotService.initialize();
      registry.classicBrowserSnapshot = classicBrowserSnapshotService;
      logger.info('[ServiceBootstrap] ClassicBrowserSnapshotService initialized');
      
      // Initialize ClassicBrowserService with all sub-services
      classicBrowserService = new ClassicBrowserService({
        mainWindow: deps.mainWindow,
        objectModel: models.objectModel,
        activityLogService,
        viewManager: classicBrowserViewManager,
        stateService: classicBrowserStateService,
        navigationService: classicBrowserNavigationService,
        tabService: classicBrowserTabService,
        womService: classicBrowserWOMService,
        snapshotService: classicBrowserSnapshotService,
        eventEmitter: browserEventEmitter
      });
      await classicBrowserService.initialize();
      registry.classicBrowser = classicBrowserService;
      logger.info('[ServiceBootstrap] ClassicBrowserService initialized with all sub-services');
    } else {
      logger.warn('[ServiceBootstrap] Skipping browser services - no mainWindow provided');
    }
    
    // Phase 3: Initialize complex services
    logger.info('[ServiceBootstrap] Initializing Phase 3 services...');
    
    // Get additional models needed for Phase 3 services
    const { chatModel, notebookModel, noteModel, chunkSqlModel } = models;
    
    // Initialize LangchainAgent (depends on vector model, ChatModel, and ProfileService)
    const langchainAgent = await createService('LangchainAgent', LangchainAgent, [{
      db: deps.db,
      vectorModel: vectorModel,
      chatModel,
      profileService
    }]);
    
    // Initialize StreamManager (no dependencies, singleton)
    logger.info('[ServiceBootstrap] Creating StreamManager...');
    const streamManager = StreamManager.getInstance();
    registry.streamManager = streamManager;
    logger.info('[ServiceBootstrap] StreamManager initialized');
    
    // Initialize ChatService (depends on ChatModel, LangchainAgent, ActivityLogService, StreamManager)
    const chatService = await createService('ChatService', ChatService, [{
      chatModel,
      langchainAgent,
      activityLogService,
      streamManager
    }]);
    registry.chat = chatService;
    
    // Initialize NotebookService (depends on multiple models and ActivityLogService)
    const notebookService = await createService('NotebookService', NotebookService, [{
      db: deps.db,
      notebookModel,
      objectModel,
      chunkSqlModel,
      chatModel,
      activityLogService,
      activityLogModel
    }]);
    registry.notebook = notebookService;
    
    // Initialize SliceService (depends on ChunkSqlModel and ObjectModel)
    const sliceService = await createService('SliceService', SliceService, [{
      db: deps.db,
      chunkSqlModel,
      objectModel
    }]);
    registry.slice = sliceService;
    
    // Initialize SearchResultFormatter (no dependencies)
    const searchResultFormatter = await createService('SearchResultFormatter', SearchResultFormatter, []);
    registry.searchResultFormatter = searchResultFormatter;
    
    // Initialize NoteService (depends on NoteModel)
    registry.note = await createService('NoteService', NoteService, [{
      db: deps.db,
      noteModel
    }]);
    
    // Get embeddingSqlModel from models (needed by ObjectService and later by ChunkingService)
    const { embeddingSqlModel } = models;
    
    // Initialize ObjectService (depends on models and vector model)
    registry.object = await createService('ObjectService', ObjectService, [{
      db: deps.db,
      objectModel,
      chunkModel: chunkSqlModel,
      embeddingModel: embeddingSqlModel,
      vectorModel: vectorModel
    }]);
    
    // Initialize AgentService (depends on many services)
    registry.agent = await createService('AgentService', AgentService, [{
      notebookService,
      hybridSearchService,
      exaService,
      chatModel,
      sliceService,
      profileService,
      searchResultFormatter,
      db: deps.db,
      streamManager
    }]);
    
    // Initialize ActionSuggestionService (depends on ProfileService and NotebookService)
    const actionSuggestionService = await createService('ActionSuggestionService', ActionSuggestionService, [{
      db: deps.db,
      profileService,
      notebookService
    }]);
    
    // Initialize IntentService (depends on many services)
    registry.intent = await createService('IntentService', IntentService, [{
      db: deps.db,
      notebookService,
      agentService: registry.agent!,
      activityLogService,
      streamManager,
      actionSuggestionService
    }]);
    
    // Initialize ProfileAgent (depends on services and models)
    registry.profileAgent = await createService('ProfileAgent', ProfileAgent, [{
      db: deps.db,
      activityLogService,
      toDoService,
      profileService,
      objectModel,
      chunkSqlModel
    }]);
    
    // Phase 5: Initialize ingestion services
    logger.info('[ServiceBootstrap] Initializing Phase 5 ingestion services...');
    
    // Get additional models for ingestion
    const { ingestionJobModel } = models;
    
    // Initialize IngestionAiService (no dependencies)
    const ingestionAiService = await createService('IngestionAiService', IngestionAiService, []);
    registry.ingestionAI = ingestionAiService;
    
    // Initialize PdfIngestionService (depends on IngestionAiService)
    const pdfIngestionService = await createService('PdfIngestionService', PdfIngestionService, [{
      ingestionAiService
    }]);
    registry.pdfIngestion = pdfIngestionService;
    
    // Initialize ChunkingService (depends on many services and models)
    const chunkingService = await createService('ChunkingService', ChunkingService, [{
      db: deps.db,
      vectorStore: vectorModel,
      ingestionAiService,
      objectModel,
      chunkSqlModel,
      embeddingSqlModel,
      ingestionJobModel
    }]);
    registry.chunking = chunkingService;
    
    // Initialize IngestionQueueService (depends on models and ingestion services)
    const ingestionQueueService = await createService('IngestionQueueService', IngestionQueueService, [{
      db: deps.db,
      ingestionJobModel,
      objectModel: objectModel!,
      chunkSqlModel,
      embeddingSqlModel,
      vectorModel,
      ingestionAiService,
      pdfIngestionService,
      mainWindow: deps.mainWindow
    }]);
    registry.ingestionQueue = ingestionQueueService;
    
    // Initialize WOMIngestionService
    const womIngestionService = await createService('WOMIngestionService', WOMIngestionService, [{
      db: deps.db,
      objectModel,
      lanceVectorModel: vectorModel,
      ingestionAiService
    }]);
    registry.womIngestion = womIngestionService;
    
    // Initialize CompositeObjectEnrichmentService
    const compositeEnrichmentService = await createService('CompositeObjectEnrichmentService', CompositeObjectEnrichmentService, [{
      db: deps.db,
      objectModel,
      lanceVectorModel: vectorModel,
      llm: ingestionAiService.llm // Use the same LLM instance
    }]);
    registry.compositeEnrichment = compositeEnrichmentService;
    
    // Update ClassicBrowserWOMService with WOM dependencies
    if (classicBrowserWOMService) {
      logger.info('[ServiceBootstrap] Updating ClassicBrowserWOMService with WOM dependencies...');
      (classicBrowserWOMService as any).deps.womIngestionService = womIngestionService;
      (classicBrowserWOMService as any).deps.compositeEnrichmentService = compositeEnrichmentService;
      logger.info('[ServiceBootstrap] ClassicBrowserWOMService updated with WOM dependencies');
    }
    
    // Initialize NotebookCompositionService (depends on NotebookService, ObjectModel, ClassicBrowserService)
    if (registry.classicBrowser) {
      registry.notebookComposition = await createService('NotebookCompositionService', NotebookCompositionService, [{
        notebookService,
        objectModel,
        classicBrowserService: registry.classicBrowser
      }]);
    } else {
      logger.warn('[ServiceBootstrap] Skipping NotebookCompositionService - ClassicBrowserService not available');
    }
    
    // Schedule ingestion tasks
    logger.info('[ServiceBootstrap] Scheduling ingestion tasks...');
    
    // Schedule ingestion queue processing (every 5 seconds)
    schedulerService.scheduleTask(
      'ingestion-queue',
      5000, // 5 seconds
      async () => {
        await ingestionQueueService.processJobs();
      },
      true  // Run immediately
    );
    
    // Schedule chunking service processing (every 30 seconds)
    schedulerService.scheduleTask(
      'chunking-service',
      30000, // 30 seconds
      async () => {
        await chunkingService.tick();
      },
      true   // Run immediately
    );
    
    logger.info('[ServiceBootstrap] Ingestion tasks scheduled');
    
    // Set up event listeners between services
    if (registry.classicBrowser && registry.womIngestion && deps.mainWindow) {
      logger.info('[ServiceBootstrap] Setting up WOM event listeners...');
      
      // Import WOM channels for event notifications
      const { WOM_INGESTION_STARTED, WOM_INGESTION_COMPLETE } = await import('../../shared/ipcChannels');
      
      // Listen for webpage ingestion requests
      registry.classicBrowser.on('webpage:needs-ingestion', async (data: unknown) => {
        const { url, title, windowId, tabId } = data as { url: string; title: string; windowId: string; tabId: string };
        try {
          // Notify renderer that ingestion is starting
          if (!deps.mainWindow!.isDestroyed()) {
            deps.mainWindow!.webContents.send(WOM_INGESTION_STARTED, { url, windowId, tabId });
          }
          
          const webpage = await registry.womIngestion!.ingestWebpage(url, title);
          registry.classicBrowser!.emit('webpage:ingestion-complete', { tabId, objectId: webpage.id });
          
          // Notify renderer that ingestion is complete
          if (!deps.mainWindow!.isDestroyed()) {
            deps.mainWindow!.webContents.send(WOM_INGESTION_COMPLETE, { 
              url, 
              objectId: webpage.id, 
              windowId, 
              tabId 
            });
          }
        } catch (error) {
          logger.error('[ServiceBootstrap] Error ingesting webpage:', error);
        }
      });
      
      // Listen for webpage refresh requests
      registry.classicBrowser.on('webpage:needs-refresh', async (data: unknown) => {
        const { objectId, url } = data as { objectId: string; url: string };
        try {
          await registry.womIngestion!.scheduleRefresh(objectId, url);
        } catch (error) {
          logger.error('[ServiceBootstrap] Error scheduling refresh:', error);
        }
      });
      
      logger.info('[ServiceBootstrap] WOM event listeners configured');
    }
    
    const duration = Date.now() - startTime;
    logger.info(`[ServiceBootstrap] Service initialization completed in ${duration}ms`);
    
    return registry;
  } catch (error) {
    logger.error('[ServiceBootstrap] Failed to initialize services:', error);
    throw error;
  }
}

/**
 * Perform health checks on all services
 * @param registry The service registry
 * @returns Array of health check results
 */
export async function checkServicesHealth(
  registry: ServiceRegistry
): Promise<ServiceHealthResult[]> {
  logger.debug('[ServiceBootstrap] Running health checks...');
  
  const results: ServiceHealthResult[] = [];
  
  for (const [name, service] of Object.entries(registry)) {
    if (!service) continue;
    
    const startTime = Date.now();
    try {
      const healthy = await service.healthCheck();
      results.push({
        service: name,
        healthy,
        timestamp: new Date(),
        details: { duration: Date.now() - startTime }
      });
    } catch (error) {
      results.push({
        service: name,
        healthy: false,
        message: error instanceof Error ? error.message : 'Health check failed',
        timestamp: new Date(),
        details: { duration: Date.now() - startTime, error }
      });
    }
  }
  
  const healthyCount = results.filter(r => r.healthy).length;
  logger.info(`[ServiceBootstrap] Health check complete: ${healthyCount}/${results.length} services healthy`);
  
  return results;
}

/**
 * Cleanup all services during shutdown
 * @param registry The service registry
 */
export async function cleanupServices(
  registry: ServiceRegistry
): Promise<void> {
  logger.info('[ServiceBootstrap] Starting service cleanup...');
  
  const startTime = Date.now();
  const errors: Array<{ service: string; error: Error }> = [];
  
  // Cleanup in reverse order of initialization (if order matters)
  const services = Object.entries(registry).reverse();
  
  for (const [name, service] of services) {
    if (!service) continue;
    
    try {
      logger.debug(`[ServiceBootstrap] Cleaning up ${name}...`);
      await service.cleanup();
    } catch (error) {
      logger.error(`[ServiceBootstrap] Failed to cleanup ${name}:`, error);
      errors.push({ 
        service: name, 
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
  }
  
  const duration = Date.now() - startTime;
  
  if (errors.length > 0) {
    logger.error(`[ServiceBootstrap] Service cleanup completed with ${errors.length} errors in ${duration}ms`);
    // Don't throw here - we want to attempt cleanup of all services
  } else {
    logger.info(`[ServiceBootstrap] Service cleanup completed successfully in ${duration}ms`);
  }
}