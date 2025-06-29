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

/**
 * Service registry to manage all application services
 */
export interface ServiceRegistry {
  
  // Core services
  activityLog?: ActivityLogService;
  agent?: AgentService;
  chat?: ChatService;
  classicBrowser?: ClassicBrowserService;
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
    logger.info('[ServiceBootstrap] Creating ActivityLogService...');
    const activityLogService = new ActivityLogService({
      db: deps.db,
      activityLogModel,
      objectModel,
      lanceVectorModel: vectorModel
    });
    await activityLogService.initialize();
    registry.activityLog = activityLogService;
    logger.info('[ServiceBootstrap] ActivityLogService initialized');
    
    // Initialize ProfileService (no dependencies on other services)
    logger.info('[ServiceBootstrap] Creating ProfileService...');
    const profileService = new ProfileService({
      db: deps.db,
      userProfileModel
    });
    await profileService.initialize();
    registry.profile = profileService;
    logger.info('[ServiceBootstrap] ProfileService initialized');
    
    // Initialize ToDoService (depends on ActivityLogService)
    logger.info('[ServiceBootstrap] Creating ToDoService...');
    const toDoService = new ToDoService({
      db: deps.db,
      toDoModel,
      activityLogService
    });
    await toDoService.initialize();
    registry.todo = toDoService;
    logger.info('[ServiceBootstrap] ToDoService initialized');
    
    // Initialize WeatherService (no dependencies)
    logger.info('[ServiceBootstrap] Creating WeatherService...');
    const weatherService = new WeatherService();
    await weatherService.initialize();
    registry.weather = weatherService;
    logger.info('[ServiceBootstrap] WeatherService initialized');
    
    // Initialize AudioTranscriptionService (no dependencies on other services)
    logger.info('[ServiceBootstrap] Creating AudioTranscriptionService...');
    const audioTranscriptionService = new AudioTranscriptionService({
      db: deps.db
    });
    await audioTranscriptionService.initialize();
    registry.audioTranscription = audioTranscriptionService;
    logger.info('[ServiceBootstrap] AudioTranscriptionService initialized');
    
    // Phase 4: Initialize specialized services
    logger.info('[ServiceBootstrap] Initializing Phase 4 services...');
    
    // Initialize SchedulerService (no dependencies)
    logger.info('[ServiceBootstrap] Creating SchedulerService...');
    const schedulerService = new SchedulerService();
    await schedulerService.initialize();
    registry.scheduler = schedulerService;
    logger.info('[ServiceBootstrap] SchedulerService initialized');
    
    // Initialize ExaService (no dependencies, no initialization needed)
    logger.info('[ServiceBootstrap] Creating ExaService...');
    const exaService = new ExaService();
    registry.exa = exaService;
    logger.info('[ServiceBootstrap] ExaService created');
    
    // Initialize HybridSearchService (depends on ExaService and vector model)
    logger.info('[ServiceBootstrap] Creating HybridSearchService...');
    const hybridSearchService = new HybridSearchService({
      exaService,
      vectorModel: vectorModel
    });
    await hybridSearchService.initialize();
    registry.hybridSearch = hybridSearchService;
    logger.info('[ServiceBootstrap] HybridSearchService initialized');
    
    // Initialize ClassicBrowserService (will be updated with WOM services later)
    let classicBrowserService: ClassicBrowserService | undefined;
    if (deps.mainWindow) {
      logger.info('[ServiceBootstrap] Creating ClassicBrowserService (initial)...');
      classicBrowserService = new ClassicBrowserService({
        mainWindow: deps.mainWindow,
        objectModel: models.objectModel,
        activityLogService
      } as any); // Temporarily cast to any, will be updated with WOM services
      await classicBrowserService.initialize();
      registry.classicBrowser = classicBrowserService;
      logger.info('[ServiceBootstrap] ClassicBrowserService initialized (initial)');
    } else {
      logger.warn('[ServiceBootstrap] Skipping ClassicBrowserService - no mainWindow provided');
    }
    
    // Phase 3: Initialize complex services
    logger.info('[ServiceBootstrap] Initializing Phase 3 services...');
    
    // Get additional models needed for Phase 3 services
    const { chatModel, notebookModel, noteModel, chunkSqlModel } = models;
    
    // Initialize LangchainAgent (depends on vector model, ChatModel, and ProfileService)
    logger.info('[ServiceBootstrap] Creating LangchainAgent...');
    const langchainAgent = new LangchainAgent({
      db: deps.db,
      vectorModel: vectorModel,
      chatModel,
      profileService
    });
    await langchainAgent.initialize();
    
    // Initialize StreamManager (no dependencies, singleton)
    logger.info('[ServiceBootstrap] Creating StreamManager...');
    const streamManager = StreamManager.getInstance();
    registry.streamManager = streamManager;
    logger.info('[ServiceBootstrap] StreamManager initialized');
    
    // Initialize ChatService (depends on ChatModel, LangchainAgent, ActivityLogService, StreamManager)
    logger.info('[ServiceBootstrap] Creating ChatService...');
    const chatService = new ChatService({
      chatModel,
      langchainAgent,
      activityLogService,
      streamManager
    });
    await chatService.initialize();
    registry.chat = chatService;
    logger.info('[ServiceBootstrap] ChatService initialized');
    
    // Initialize NotebookService (depends on multiple models and ActivityLogService)
    logger.info('[ServiceBootstrap] Creating NotebookService...');
    const notebookService = new NotebookService({
      db: deps.db,
      notebookModel,
      objectModel,
      chunkSqlModel,
      chatModel,
      activityLogService,
      activityLogModel
    });
    await notebookService.initialize();
    registry.notebook = notebookService;
    logger.info('[ServiceBootstrap] NotebookService initialized');
    
    // Initialize SliceService (depends on ChunkSqlModel and ObjectModel)
    logger.info('[ServiceBootstrap] Creating SliceService...');
    const sliceService = new SliceService({
      db: deps.db,
      chunkSqlModel,
      objectModel
    });
    await sliceService.initialize();
    registry.slice = sliceService;
    logger.info('[ServiceBootstrap] SliceService initialized');
    
    // Initialize SearchResultFormatter (no dependencies)
    logger.info('[ServiceBootstrap] Creating SearchResultFormatter...');
    const searchResultFormatter = new SearchResultFormatter();
    await searchResultFormatter.initialize();
    registry.searchResultFormatter = searchResultFormatter;
    logger.info('[ServiceBootstrap] SearchResultFormatter initialized');
    
    // Initialize NoteService (depends on NoteModel)
    logger.info('[ServiceBootstrap] Creating NoteService...');
    const noteService = new NoteService({
      db: deps.db,
      noteModel
    });
    await noteService.initialize();
    registry.note = noteService;
    logger.info('[ServiceBootstrap] NoteService initialized');
    
    // Get embeddingSqlModel from models (needed by ObjectService and later by ChunkingService)
    const { embeddingSqlModel } = models;
    
    // Initialize ObjectService (depends on models and vector model)
    logger.info('[ServiceBootstrap] Creating ObjectService...');
    const objectService = new ObjectService({
      db: deps.db,
      objectModel,
      chunkModel: chunkSqlModel,
      embeddingModel: embeddingSqlModel,
      vectorModel: vectorModel
    });
    await objectService.initialize();
    registry.object = objectService;
    logger.info('[ServiceBootstrap] ObjectService initialized');
    
    // Initialize AgentService (depends on many services)
    logger.info('[ServiceBootstrap] Creating AgentService...');
    const agentService = new AgentService({
      notebookService,
      hybridSearchService,
      exaService,
      chatModel,
      sliceService,
      profileService,
      searchResultFormatter,
      db: deps.db,
      streamManager
    });
    await agentService.initialize();
    registry.agent = agentService;
    logger.info('[ServiceBootstrap] AgentService initialized');
    
    // Initialize ActionSuggestionService (depends on ProfileService and NotebookService)
    logger.info('[ServiceBootstrap] Creating ActionSuggestionService...');
    const actionSuggestionService = new ActionSuggestionService({
      db: deps.db,
      profileService,
      notebookService
    });
    await actionSuggestionService.initialize();
    logger.info('[ServiceBootstrap] ActionSuggestionService initialized');
    
    // Initialize IntentService (depends on many services)
    logger.info('[ServiceBootstrap] Creating IntentService...');
    const intentService = new IntentService({
      db: deps.db,
      notebookService,
      agentService,
      activityLogService,
      streamManager,
      actionSuggestionService
    });
    await intentService.initialize();
    registry.intent = intentService;
    logger.info('[ServiceBootstrap] IntentService initialized');
    
    // Initialize ProfileAgent (depends on services and models)
    logger.info('[ServiceBootstrap] Creating ProfileAgent...');
    const profileAgent = new ProfileAgent({
      db: deps.db,
      activityLogService,
      toDoService,
      profileService,
      objectModel,
      chunkSqlModel
    });
    await profileAgent.initialize();
    registry.profileAgent = profileAgent;
    logger.info('[ServiceBootstrap] ProfileAgent initialized');
    
    // Phase 5: Initialize ingestion services
    logger.info('[ServiceBootstrap] Initializing Phase 5 ingestion services...');
    
    // Get additional models for ingestion
    const { ingestionJobModel } = models;
    
    // Initialize IngestionAiService (no dependencies)
    logger.info('[ServiceBootstrap] Creating IngestionAiService...');
    const ingestionAiService = new IngestionAiService();
    await ingestionAiService.initialize();
    registry.ingestionAI = ingestionAiService;
    logger.info('[ServiceBootstrap] IngestionAiService initialized');
    
    // Initialize PdfIngestionService (depends on IngestionAiService)
    logger.info('[ServiceBootstrap] Creating PdfIngestionService...');
    const pdfIngestionService = new PdfIngestionService({
      ingestionAiService
    });
    await pdfIngestionService.initialize();
    registry.pdfIngestion = pdfIngestionService;
    logger.info('[ServiceBootstrap] PdfIngestionService initialized');
    
    // Initialize ChunkingService (depends on many services and models)
    logger.info('[ServiceBootstrap] Creating ChunkingService...');
    const chunkingService = new ChunkingService({
      db: deps.db,
      vectorStore: vectorModel,
      ingestionAiService,
      objectModel,
      chunkSqlModel,
      embeddingSqlModel,
      ingestionJobModel
    });
    await chunkingService.initialize();
    registry.chunking = chunkingService;
    logger.info('[ServiceBootstrap] ChunkingService initialized');
    
    // Initialize IngestionQueueService (depends on models and ingestion services)
    logger.info('[ServiceBootstrap] Creating IngestionQueueService...');
    const ingestionQueueService = new IngestionQueueService({
      db: deps.db,
      ingestionJobModel,
      objectModel: objectModel!,
      chunkSqlModel,
      embeddingSqlModel,
      vectorModel,
      ingestionAiService,
      pdfIngestionService,
      mainWindow: deps.mainWindow
    });
    await ingestionQueueService.initialize();
    registry.ingestionQueue = ingestionQueueService;
    logger.info('[ServiceBootstrap] IngestionQueueService initialized');
    
    // Initialize WOMIngestionService
    logger.info('[ServiceBootstrap] Creating WOMIngestionService...');
    const womIngestionService = new WOMIngestionService({
      db: deps.db,
      objectModel,
      lanceVectorModel: vectorModel,
      ingestionAiService
    });
    await womIngestionService.initialize();
    registry.womIngestion = womIngestionService;
    logger.info('[ServiceBootstrap] WOMIngestionService initialized');
    
    // Initialize CompositeObjectEnrichmentService
    logger.info('[ServiceBootstrap] Creating CompositeObjectEnrichmentService...');
    const compositeEnrichmentService = new CompositeObjectEnrichmentService({
      db: deps.db,
      objectModel,
      lanceVectorModel: vectorModel,
      llm: ingestionAiService.llm // Use the same LLM instance
    });
    await compositeEnrichmentService.initialize();
    registry.compositeEnrichment = compositeEnrichmentService;
    logger.info('[ServiceBootstrap] CompositeObjectEnrichmentService initialized');
    
    // Update ClassicBrowserService with WOM dependencies
    if (classicBrowserService) {
      logger.info('[ServiceBootstrap] Updating ClassicBrowserService with WOM dependencies...');
      (classicBrowserService as any).deps.womIngestionService = womIngestionService;
      (classicBrowserService as any).deps.compositeEnrichmentService = compositeEnrichmentService;
      logger.info('[ServiceBootstrap] ClassicBrowserService updated with WOM dependencies');
    }
    
    // Initialize NotebookCompositionService (depends on NotebookService, ObjectModel, ClassicBrowserService)
    if (registry.classicBrowser) {
      logger.info('[ServiceBootstrap] Creating NotebookCompositionService...');
      const notebookCompositionService = new NotebookCompositionService({
        notebookService,
        objectModel,
        classicBrowserService: registry.classicBrowser
      });
      await notebookCompositionService.initialize();
      registry.notebookComposition = notebookCompositionService;
      logger.info('[ServiceBootstrap] NotebookCompositionService initialized');
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