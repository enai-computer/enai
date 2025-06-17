import Database from 'better-sqlite3';
import { logger } from '../../utils/logger';
import { ObjectModel } from '../../models/ObjectModel';
import { ChunkSqlModel } from '../../models/ChunkModel';
import { ChromaVectorModel } from '../../models/ChromaVectorModel';
import { ChatModel } from '../../models/ChatModel';
import { NotebookModel } from '../../models/NotebookModel';
import { NoteModel } from '../../models/NoteModel';
import { EmbeddingSqlModel } from '../../models/EmbeddingModel';
import { IngestionJobModel } from '../../models/IngestionJobModel';
import { UserProfileModel } from '../../models/UserProfileModel';
import { ToDoModel } from '../../models/ToDoModel';
import { ActivityLogModel } from '../../models/ActivityLogModel';

/**
 * Registry of all database models
 */
export interface ModelRegistry {
  // Core models
  objectModel: ObjectModel;
  chunkSqlModel: ChunkSqlModel;
  chromaVectorModel: ChromaVectorModel;
  chatModel: ChatModel;
  notebookModel: NotebookModel;
  noteModel: NoteModel;
  embeddingSqlModel: EmbeddingSqlModel;
  ingestionJobModel: IngestionJobModel;
  userProfileModel: UserProfileModel;
  toDoModel: ToDoModel;
  activityLogModel: ActivityLogModel;
}

/**
 * Initialize all database models
 * This is the single source of truth for model instantiation
 * @param db Database connection
 * @returns Registry of initialized models
 */
export default async function initModels(db: Database.Database): Promise<ModelRegistry> {
  logger.info('[ModelBootstrap] Initializing models...');
  
  // Core models
  const objectModel = new ObjectModel(db);
  logger.info('[ModelBootstrap] ObjectModel instantiated.');
  
  const chunkSqlModel = new ChunkSqlModel(db);
  logger.info('[ModelBootstrap] ChunkSqlModel instantiated.');
  
  const notebookModel = new NotebookModel(db);
  logger.info('[ModelBootstrap] NotebookModel instantiated.');
  
  const noteModel = new NoteModel(db);
  logger.info('[ModelBootstrap] NoteModel instantiated.');
  
  const embeddingSqlModel = new EmbeddingSqlModel(db);
  logger.info('[ModelBootstrap] EmbeddingSqlModel instantiated.');
  
  const chromaVectorModel = new ChromaVectorModel();
  logger.info('[ModelBootstrap] ChromaVectorModel instantiated.');
  
  // Initialize ChromaVectorModel connection
  try {
    logger.info('[ModelBootstrap] Initializing ChromaVectorModel connection...');
    await chromaVectorModel.initialize();
    logger.info('[ModelBootstrap] ChromaVectorModel connection initialized successfully.');
  } catch (chromaInitError) {
    logger.error('[ModelBootstrap] CRITICAL: ChromaVectorModel initialization failed. Chat/Embedding features may not work.', chromaInitError);
    // Continue but features will likely fail
  }
  
  const chatModel = new ChatModel(db);
  logger.info('[ModelBootstrap] ChatModel instantiated.');
  
  const ingestionJobModel = new IngestionJobModel(db);
  logger.info('[ModelBootstrap] IngestionJobModel instantiated.');
  
  // User and activity models
  const userProfileModel = new UserProfileModel(db);
  logger.info('[ModelBootstrap] UserProfileModel instantiated.');
  
  const toDoModel = new ToDoModel(db);
  logger.info('[ModelBootstrap] ToDoModel instantiated.');
  
  const activityLogModel = new ActivityLogModel(db);
  logger.info('[ModelBootstrap] ActivityLogModel instantiated.');
  
  logger.info('[ModelBootstrap] All models initialized successfully.');
  
  return {
    objectModel,
    chunkSqlModel,
    chromaVectorModel,
    chatModel,
    notebookModel,
    noteModel,
    embeddingSqlModel,
    ingestionJobModel,
    userProfileModel,
    toDoModel,
    activityLogModel
  };
}