import Database from 'better-sqlite3';
import { logger } from '../../utils/logger';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ObjectModelCore } from '../../models/ObjectModelCore';
import { ObjectCognitiveModel } from '../../models/ObjectCognitiveModel';
import { ObjectAssociationModel } from '../../models/ObjectAssociationModel';
import { ChunkModel } from '../../models/ChunkModel';
import { LanceVectorModel } from '../../models/LanceVectorModel';
import { ChatModel } from '../../models/ChatModel';
import { NotebookModel } from '../../models/NotebookModel';
import { NoteModel } from '../../models/NoteModel';
import { EmbeddingModel } from '../../models/EmbeddingModel';
import { IngestionJobModel } from '../../models/IngestionJobModel';
import { UserProfileModel } from '../../models/UserProfileModel';
import { ToDoModel } from '../../models/ToDoModel';
import { ActivityLogModel } from '../../models/ActivityLogModel';

/**
 * Registry of all database models
 */
export interface ModelRegistry {
  // Core models
  chunkModel: ChunkModel;
  vectorModel: LanceVectorModel;
  chatModel: ChatModel;
  notebookModel: NotebookModel;
  noteModel: NoteModel;
  embeddingModel: EmbeddingModel;
  ingestionJobModel: IngestionJobModel;
  userProfileModel: UserProfileModel;
  toDoModel: ToDoModel;
  activityLogModel: ActivityLogModel;
  
  // Object models (refactored)
  objectModelCore: ObjectModelCore;
  objectCognitive: ObjectCognitiveModel;
  objectAssociation: ObjectAssociationModel;
}

/**
 * Initialize all database models
 * This is the single source of truth for model instantiation
 * @param db Database connection
 * @param userDataPath Optional user data path for CLI environments (defaults to Electron's userData)
 * @returns Registry of initialized models
 */
export default async function initModels(db: Database.Database, userDataPath?: string): Promise<ModelRegistry> {
  logger.info('[ModelBootstrap] Initializing models...');
  
  // Core models - instantiate refactored models first
  const objectModelCore = new ObjectModelCore(db);
  logger.info('[ModelBootstrap] ObjectModelCore instantiated.');
  
  const objectCognitive = new ObjectCognitiveModel(objectModelCore);
  logger.info('[ModelBootstrap] ObjectCognitiveModel instantiated.');
  
  const objectAssociation = new ObjectAssociationModel(db);
  logger.info('[ModelBootstrap] ObjectAssociationModel instantiated.');
  
  
  const chunkModel = new ChunkModel(db);
  logger.info('[ModelBootstrap] ChunkModel instantiated.');
  
  const notebookModel = new NotebookModel(db);
  logger.info('[ModelBootstrap] NotebookModel instantiated.');
  
  const noteModel = new NoteModel(db);
  logger.info('[ModelBootstrap] NoteModel instantiated.');
  
  const embeddingModel = new EmbeddingModel(db);
  logger.info('[ModelBootstrap] EmbeddingModel instantiated.');
  
  const vectorModel = new LanceVectorModel({
    userDataPath: userDataPath || app.getPath('userData')
  });
  logger.info('[ModelBootstrap] LanceVectorModel instantiated.');
  
  // Initialize LanceVectorModel connection
  try {
    logger.info('[ModelBootstrap] Initializing Lance vector store...');
    await vectorModel.initialize();
    logger.info('[ModelBootstrap] LanceVectorModel initialized successfully.');
  } catch (err) {
    logger.error('[ModelBootstrap] CRITICAL: LanceVectorModel initialization failed.', err);
    // Continue startup; vector searches will be unavailable
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
  
  // ChromaDB migration removed - users should use the reembed script if needed
  
  return {
    chunkModel,
    vectorModel,
    chatModel,
    notebookModel,
    noteModel,
    embeddingModel,
    ingestionJobModel,
    userProfileModel,
    toDoModel,
    activityLogModel,
    // Object models
    objectModelCore,
    objectCognitive,
    objectAssociation
  };
}