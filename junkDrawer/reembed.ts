#!/usr/bin/env node

import path from 'path';
import os from 'os';

/**
 * Re-embedding script for migrating from ChromaDB to LanceDB
 * 
 * This script will:
 * 1. Clear all existing embeddings (if not already done)
 * 2. Re-embed all chunks using the new LanceDB vector store
 * 
 * Usage:
 *   npx ts-node junkDrawer/reembed.ts
 * 
 * Prerequisites:
 *   - Run `npm run cli:reset-embeddings` first to clear old embeddings
 *   - Ensure OPENAI_API_KEY is set in environment
 *   - Ensure ENAI_DB_PATH points to your SQLite database
 */

import * as dotenv from 'dotenv';
import Database from 'better-sqlite3';
import { IngestionAiService } from '../services/ingestion/IngestionAIService';
import { ChunkingService } from '../services/ingestion/ChunkingService';
import initModels from '../electron/bootstrap/modelBootstrap';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

async function main() {
  logger.info('[Reembed] Starting LanceDB re-embedding process...');
  
  // Check required environment variables
  if (!process.env.OPENAI_API_KEY) {
    logger.error('[Reembed] OPENAI_API_KEY not set. Please set it in your environment.');
    process.exit(1);
  }
  
  // Determine database path
  const dbPath = process.env.ENAI_DB_PATH || 
    path.join(os.homedir(), 'Library', 'Application Support', 'enai', 'enai.db');
  
  logger.info(`[Reembed] Using database at: ${dbPath}`);
  
  let db: Database.Database | null = null;
  
  try {
    // Open database connection
    db = new Database(dbPath);
    logger.info('[Reembed] Database connection established.');
    
    // Initialize all models (including LanceVectorModel) with explicit userDataPath for CLI
    logger.info('[Reembed] Initializing models...');
    const userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'enai');
    const models = await initModels(db, userDataPath);
    logger.info('[Reembed] Models initialized successfully.');
    
    // Create IngestionAiService
    logger.info('[Reembed] Creating IngestionAiService...');
    const ingestionAiService = new IngestionAiService();
    await ingestionAiService.initialize();
    logger.info('[Reembed] IngestionAiService initialized.');
    
    // Create ChunkingService with dependencies
    logger.info('[Reembed] Creating ChunkingService...');
    const chunkingService = new ChunkingService({
      db,
      vectorStore: models.vectorModel, // This is now LanceVectorModel
      ingestionAiService,
      objectModel: models.objectModel,
      chunkModel: models.chunkModel,
      embeddingModel: models.embeddingModel,
      ingestionJobModel: models.ingestionJobModel
    });
    
    logger.info('[Reembed] ChunkingService created. Starting re-embedding process...');
    
    // Execute re-embedding
    const startTime = Date.now();
    const totalEmbedded = await chunkingService.embedAllUnembeddedChunks();
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000; // in seconds
    
    logger.info(`[Reembed] ======================================`);
    logger.info(`[Reembed] Re-embedding complete!`);
    logger.info(`[Reembed] Total chunks embedded: ${totalEmbedded}`);
    logger.info(`[Reembed] Time taken: ${duration.toFixed(2)} seconds`);
    if (totalEmbedded > 0) {
      logger.info(`[Reembed] Average time per chunk: ${(duration / totalEmbedded).toFixed(3)} seconds`);
    }
    logger.info(`[Reembed] ======================================`);
    
    // Cleanup
    logger.info('[Reembed] Cleaning up...');
    await chunkingService.cleanup();
    await ingestionAiService.cleanup();
    
    // Note: LanceVectorModel doesn't need explicit cleanup as it's file-based
    
  } catch (error) {
    logger.error('[Reembed] Fatal error during re-embedding:', error);
    process.exit(1);
  } finally {
    // Always close database connection
    if (db) {
      logger.info('[Reembed] Closing database connection...');
      db.close();
    }
  }
  
  logger.info('[Reembed] Script completed successfully.');
  process.exit(0);
}

// Run the script
main().catch(error => {
  logger.error('[Reembed] Unhandled error:', error);
  process.exit(1);
});