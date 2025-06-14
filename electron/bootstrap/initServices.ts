import Database from 'better-sqlite3';
import { BrowserWindow } from 'electron';
import { logger } from '../../utils/logger';

// Import models
import { ObjectModel } from '../../models/ObjectModel';
import { ChunkSqlModel } from '../../models/ChunkModel';
import { ChromaVectorModel } from '../../models/ChromaVectorModel';
import { ChatModel } from '../../models/ChatModel';
import { NotebookModel } from '../../models/NotebookModel';
import { NoteModel } from '../../models/NoteModel';
import { EmbeddingSqlModel } from '../../models/EmbeddingModel';
import { IngestionJobModel } from '../../models/IngestionJobModel';

// Import services
import { ChunkingService, createChunkingService } from '../../services/ingestion/ChunkingService';
import { LangchainAgent } from '../../services/agents/LangchainAgent';
import { ChatService } from '../../services/ChatService';
import { SliceService } from '../../services/SliceService';
import { NotebookService } from '../../services/NotebookService';
import { NoteService } from '../../services/NoteService';
import { NotebookCompositionService } from '../../services/NotebookCompositionService';
import { AgentService } from '../../services/AgentService';
import { IntentService } from '../../services/IntentService';
import { ActionSuggestionService } from '../../services/ActionSuggestionService';
import { ExaService } from '../../services/ExaService';
import { HybridSearchService } from '../../services/HybridSearchService';
import { ProfileService } from '../../services/ProfileService';
import { ProfileAgent } from '../../services/agents/ProfileAgent';
import { PdfIngestionService } from '../../services/ingestion/PdfIngestionService';
import { IngestionQueueService } from '../../services/ingestion/IngestionQueueService';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';

export interface Models {
  objectModel: ObjectModel;
  chunkSqlModel: ChunkSqlModel;
  chromaVectorModel: ChromaVectorModel;
  chatModel: ChatModel;
  notebookModel: NotebookModel;
  noteModel: NoteModel;
  embeddingSqlModel: EmbeddingSqlModel;
  ingestionJobModel: IngestionJobModel;
}

export interface Services {
  chunkingService: ChunkingService | null;
  langchainAgent: LangchainAgent;
  chatService: ChatService;
  sliceService: SliceService;
  notebookService: NotebookService;
  noteService: NoteService;
  notebookCompositionService: NotebookCompositionService | null;
  agentService: AgentService;
  intentService: IntentService;
  actionSuggestionService: ActionSuggestionService;
  exaService: ExaService;
  hybridSearchService: HybridSearchService;
  profileService: ProfileService;
  profileAgent: ProfileAgent;
  pdfIngestionService: PdfIngestionService;
  ingestionQueueService: IngestionQueueService;
  classicBrowserService: ClassicBrowserService | null;
}

export async function initModels(db: Database.Database): Promise<Models> {
  logger.info('[Bootstrap] Initializing models...');
  
  const objectModel = new ObjectModel(db);
  logger.info('[Bootstrap] ObjectModel instantiated.');
  
  const chunkSqlModel = new ChunkSqlModel(db);
  logger.info('[Bootstrap] ChunkSqlModel instantiated.');
  
  const notebookModel = new NotebookModel(db);
  logger.info('[Bootstrap] NotebookModel instantiated.');
  
  const noteModel = new NoteModel(db);
  logger.info('[Bootstrap] NoteModel instantiated.');
  
  const embeddingSqlModel = new EmbeddingSqlModel(db);
  logger.info('[Bootstrap] EmbeddingSqlModel instantiated.');
  
  const chromaVectorModel = new ChromaVectorModel();
  logger.info('[Bootstrap] ChromaVectorModel instantiated.');
  
  // Initialize ChromaVectorModel connection
  try {
    logger.info('[Bootstrap] Initializing ChromaVectorModel connection...');
    await chromaVectorModel.initialize();
    logger.info('[Bootstrap] ChromaVectorModel connection initialized successfully.');
  } catch (chromaInitError) {
    logger.error('[Bootstrap] CRITICAL: ChromaVectorModel initialization failed. Chat/Embedding features may not work.', chromaInitError);
    // Continue but features will likely fail
  }
  
  const chatModel = new ChatModel(db);
  logger.info('[Bootstrap] ChatModel instantiated.');
  
  const ingestionJobModel = new IngestionJobModel(db);
  logger.info('[Bootstrap] IngestionJobModel instantiated.');
  
  return {
    objectModel,
    chunkSqlModel,
    chromaVectorModel,
    chatModel,
    notebookModel,
    noteModel,
    embeddingSqlModel,
    ingestionJobModel
  };
}

export function initServices(
  db: Database.Database, 
  models: Models,
  mainWindow: BrowserWindow | null
): Services {
  logger.info('[Bootstrap] Initializing services...');
  
  const {
    objectModel,
    chunkSqlModel,
    chromaVectorModel,
    chatModel,
    notebookModel,
    noteModel,
    embeddingSqlModel,
    ingestionJobModel
  } = models;
  
  // Initialize ChunkingService
  let chunkingService: ChunkingService | null = null;
  if (!chromaVectorModel?.isReady()) {
    logger.error("[Bootstrap] Cannot instantiate ChunkingService: ChromaVectorModel not ready.");
  } else if (!embeddingSqlModel) {
    logger.error("[Bootstrap] Cannot instantiate ChunkingService: EmbeddingSqlModel not ready.");
  } else {
    chunkingService = createChunkingService(
      db, 
      chromaVectorModel, 
      embeddingSqlModel,
      undefined, // ingestionJobModel - will be created
      5000, // 5 second polling instead of 30 seconds
      60 // 60 concurrent operations for Tier 2 limits
    );
    logger.info('[Bootstrap] ChunkingService instantiated with 5s polling and 60 concurrent operations.');
  }
  
  // Initialize LangchainAgent
  if (!chromaVectorModel?.isReady() || !chatModel) {
    throw new Error("Cannot instantiate LangchainAgent: Required models (Chroma/Chat) not initialized or ready.");
  }
  const langchainAgent = new LangchainAgent(chromaVectorModel, chatModel);
  logger.info('[Bootstrap] LangchainAgent instantiated.');
  
  // Initialize ChatService
  if (!langchainAgent || !chatModel) {
    throw new Error("Cannot instantiate ChatService: LangchainAgent or ChatModel not initialized.");
  }
  const chatService = new ChatService(langchainAgent, chatModel);
  logger.info('[Bootstrap] ChatService instantiated.');
  
  // Initialize SliceService
  if (!chunkSqlModel || !objectModel) {
    throw new Error("Cannot instantiate SliceService: Required models (ChunkSql/Object) not initialized.");
  }
  const sliceService = new SliceService(chunkSqlModel, objectModel);
  logger.info('[Bootstrap] SliceService instantiated.');
  
  // Initialize NotebookService
  if (!notebookModel || !objectModel || !chunkSqlModel || !chatModel || !db) {
    throw new Error("Cannot instantiate NotebookService: Required models or DB instance not initialized.");
  }
  const notebookService = new NotebookService(notebookModel, objectModel, chunkSqlModel, chatModel, db);
  logger.info('[Bootstrap] NotebookService instantiated.');
  
  // Initialize NoteService
  if (!noteModel || !db) {
    throw new Error("Cannot instantiate NoteService: Required models or DB instance not initialized.");
  }
  const noteService = new NoteService(noteModel, db);
  logger.info('[Bootstrap] NoteService instantiated.');
  
  // Initialize ExaService
  const exaService = new ExaService();
  logger.info('[Bootstrap] ExaService instantiated.');
  
  // Initialize HybridSearchService
  if (!chromaVectorModel || !exaService) {
    throw new Error("Cannot instantiate HybridSearchService: Required dependencies (ChromaVectorModel, ExaService) not initialized.");
  }
  const hybridSearchService = new HybridSearchService(exaService, chromaVectorModel);
  logger.info('[Bootstrap] HybridSearchService instantiated.');
  
  // Initialize AgentService
  if (!notebookService || !hybridSearchService || !exaService || !chatModel || !sliceService) {
    throw new Error("Cannot instantiate AgentService: Required services not initialized.");
  }
  const agentService = new AgentService(notebookService, hybridSearchService, exaService, chatModel, sliceService);
  logger.info('[Bootstrap] AgentService instantiated.');
  
  // Initialize IntentService
  if (!notebookService || !agentService) {
    throw new Error("Cannot instantiate IntentService: Required services (NotebookService, AgentService) not initialized.");
  }
  const intentService = new IntentService(notebookService, agentService);
  logger.info('[Bootstrap] IntentService instantiated.');
  
  // Initialize ProfileService
  const profileService = new ProfileService();
  logger.info('[Bootstrap] ProfileService instantiated.');
  
  // Initialize ActionSuggestionService
  if (!profileService || !notebookService) {
    throw new Error("Cannot instantiate ActionSuggestionService: Required services not initialized.");
  }
  const actionSuggestionService = new ActionSuggestionService(profileService, notebookService);
  logger.info('[Bootstrap] ActionSuggestionService instantiated.');
  
  // Wire ActionSuggestionService to IntentService
  intentService.setActionSuggestionService(actionSuggestionService);
  logger.info('[Bootstrap] ActionSuggestionService wired to IntentService.');
  
  // Initialize ProfileAgent
  const profileAgent = new ProfileAgent(db);
  logger.info('[Bootstrap] ProfileAgent instantiated.');
  
  // Initialize PdfIngestionService
  const pdfIngestionService = new PdfIngestionService();
  logger.info('[Bootstrap] PdfIngestionService instantiated.');
  
  // Initialize IngestionQueueService
  const ingestionQueueService = new IngestionQueueService(ingestionJobModel, objectModel, {
    concurrency: 12, // Optimized for Tier 2 rate limits (5000 RPM)
    pollInterval: 1000, // Poll every second
    maxRetries: 3,
    retryDelay: 5000 // 5 seconds initial retry delay
  });
  logger.info('[Bootstrap] IngestionQueueService instantiated.');
  
  // Initialize ClassicBrowserService (requires mainWindow)
  let classicBrowserService: ClassicBrowserService | null = null;
  if (mainWindow) {
    classicBrowserService = new ClassicBrowserService(mainWindow, objectModel);
    logger.info('[Bootstrap] ClassicBrowserService instantiated.');
  } else {
    logger.warn('[Bootstrap] MainWindow not available, ClassicBrowserService not instantiated.');
  }
  
  // Initialize NotebookCompositionService (requires ClassicBrowserService)
  let notebookCompositionService: NotebookCompositionService | null = null;
  if (classicBrowserService && notebookService && objectModel) {
    notebookCompositionService = new NotebookCompositionService(notebookService, objectModel, classicBrowserService);
    logger.info('[Bootstrap] NotebookCompositionService instantiated.');
  } else {
    logger.warn('[Bootstrap] Dependencies not available, NotebookCompositionService not instantiated.');
  }
  
  return {
    chunkingService,
    langchainAgent,
    chatService,
    sliceService,
    notebookService,
    noteService,
    notebookCompositionService,
    agentService,
    intentService,
    actionSuggestionService,
    exaService,
    hybridSearchService,
    profileService,
    profileAgent,
    pdfIngestionService,
    ingestionQueueService,
    classicBrowserService
  };
}