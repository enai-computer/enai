#!/usr/bin/env node

// Test script to debug slice processing
process.env.LOG_LEVEL = 'debug';

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const { HybridSearchService } = require('./dist/electron/services/HybridSearchService');
const { SliceService } = require('./dist/electron/services/SliceService');
const { ChromaVectorModel } = require('./dist/electron/models/ChromaVectorModel');
const { ChunkSqlModel } = require('./dist/electron/models/ChunkModel');
const { ObjectModel } = require('./dist/electron/models/ObjectModel');
const { ExaService } = require('./dist/electron/services/ExaService');
const { LLMService } = require('./dist/electron/services/LLMService');

async function testSliceProcessing() {
  console.log('Starting slice processing test...\n');
  
  try {
    // Initialize DB - use the actual database path from the project
    const dbPath = path.join(__dirname, 'data', 'jeffers_default.db');
    console.log(`Using database: ${dbPath}`);
    const db = new Database(dbPath);
    
    // Initialize services - need to match the new LLM service architecture
    const { OpenAIGPT4oMiniProvider } = require('./dist/electron/services/llm_providers/openai');
    const { OpenAITextEmbedding3SmallProvider } = require('./dist/electron/services/llm_providers/openai');
    
    // Create provider instances
    const gpt4oMiniProvider = new OpenAIGPT4oMiniProvider();
    const embeddingProvider = new OpenAITextEmbedding3SmallProvider();
    
    // Create provider maps
    const completionProviders = new Map();
    completionProviders.set('OpenAI-GPT-4o-Mini', gpt4oMiniProvider);
    
    const embeddingProviders = new Map();
    embeddingProviders.set('OpenAI-text-embedding-3-small', embeddingProvider);
    
    // Create LLMService
    const llmService = new LLMService({
      completionProviders,
      embeddingProviders,
      defaultCompletionProvider: 'OpenAI-GPT-4o-Mini',
      defaultEmbeddingProvider: 'OpenAI-text-embedding-3-small'
    });
    
    const chromaModel = new ChromaVectorModel(llmService);
    await chromaModel.initialize();
    
    const exaService = new ExaService();
    const hybridSearch = new HybridSearchService(exaService, chromaModel);
    
    // Test search
    const query = 'attention';
    console.log(`\n=== Testing search for: "${query}" ===\n`);
    
    const searchResults = await hybridSearch.search(query, {
      numResults: 10,
      useExa: false
    });
    
    console.log(`\nFound ${searchResults.length} search results:`);
    searchResults.forEach((result, i) => {
      console.log(`\n[${i + 1}] ${result.title || 'Untitled'}`);
      console.log(`  Source: ${result.source}`);
      console.log(`  URL: ${result.url || 'None'}`);
      console.log(`  ChunkID: ${result.chunkId} (type: ${typeof result.chunkId})`);
      console.log(`  ObjectID: ${result.objectId || 'None'}`);
      console.log(`  Content preview: ${result.content?.substring(0, 100)}...`);
    });
    
    // Test slice service directly
    const chunkIds = searchResults
      .filter(r => r.source === 'local' && r.chunkId)
      .map(r => r.chunkId);
    
    console.log(`\n\n=== Testing SliceService with chunk IDs: [${chunkIds.join(', ')}] ===\n`);
    
    if (chunkIds.length > 0) {
      const chunkModel = new ChunkSqlModel(db);
      const objectModel = new ObjectModel(db);
      const sliceService = new SliceService(chunkModel, objectModel);
      
      const slices = await sliceService.getDetailsForSlices(chunkIds);
      console.log(`\nSliceService returned ${slices.length} slices:`);
      
      slices.forEach((slice, i) => {
        console.log(`\n[${i + 1}] Slice for chunk ${slice.chunkId}`);
        console.log(`  Title: ${slice.sourceObjectTitle || 'None'}`);
        console.log(`  URI: ${slice.sourceObjectUri || 'None'}`);
        console.log(`  ObjectID: ${slice.sourceObjectId}`);
        console.log(`  Content preview: ${slice.content?.substring(0, 100)}...`);
      });
    } else {
      console.log('\nNo chunk IDs found in search results!');
      
      // Let's check the database directly
      console.log('\n=== Checking database directly ===\n');
      const stmt = db.prepare(`
        SELECT c.id, c.object_id, c.chunk_idx, o.title, o.source_uri 
        FROM chunks c 
        JOIN objects o ON c.object_id = o.id 
        LIMIT 10
      `);
      const sampleChunks = stmt.all();
      console.log(`Found ${sampleChunks.length} chunks in database:`);
      sampleChunks.forEach(chunk => {
        console.log(`  Chunk ${chunk.id}: object_id=${chunk.object_id}, title="${chunk.title}"`);
      });
    }
    
  } catch (error) {
    console.error('Error during test:', error);
  }
  
  process.exit(0);
}

testSliceProcessing();