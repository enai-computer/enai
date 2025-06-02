import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { UrlIngestionWorker } from '../UrlIngestionWorker';
import { IngestionJobModel } from '../../../models/IngestionJobModel';
import { ObjectModel } from '../../../models/ObjectModel';
import { ChunkSqlModel } from '../../../models/ChunkModel';
import { IngestionQueueService } from '../IngestionQueueService';
import { ChunkingService } from '../ChunkingService';
import { LLMService } from '../../../services/LLMService';
import { OpenAIGPT41NanoProvider, OpenAITextEmbedding3SmallProvider } from '../../../services/llm_providers/openai';
import { ChromaVectorModel } from '../../../models/ChromaVectorModel';
import runMigrations from '../../../models/runMigrations';
import { logger } from '../../../utils/logger';

// Test URLs - comprehensive mix of content types and sizes
const TEST_URLS = [
  'https://en.wikipedia.org/wiki/Donald_Judd',
  'https://en.wikipedia.org/wiki/Robert_Irwin_(artist)', 
  'https://en.wikipedia.org/wiki/Robinson_Jeffers',
  'https://roselyddon.substack.com/p/how-martyrs-became-men?utm_source=%2Finbox%2Fpaid&utm_medium=reader2',
  'https://www.anthropic.com',
  'https://www.poetryfoundation.org/articles/1686146/this-be-the-place-a-countercultural-ritual-in-japan',
  'https://plato.stanford.edu/entries/attention/',
  'https://stripe.com/blog',
  'https://news.ycombinator.com/best',
  'https://docs.anthropic.com/en/docs/claude-code',
  'https://github.com/anthropics/claude-code',
  'https://www.newyorker.com/about/faq',
  'https://www.theatlantic.com/technology/archive/2023/12/anthropic-ai-safety-constitution/676461/',
  'https://arxiv.org/abs/2312.00752',
  'https://www.nature.com/articles/s41586-023-06924-6',
  'https://en.wikipedia.org/wiki/Large_language_model',
  'https://huggingface.co/docs/transformers/index',
  'https://www.bbc.com/news/technology-66472938',
  'https://www.theverge.com/23610427/chatgpt-api-chatbot-history-future',
  'https://www.wired.com/story/what-is-artificial-general-intelligence-agi-explained/'
];

describe('URL Ingestion Pipeline - Concurrent Processing', () => {
  let db: Database.Database;
  let objectModel: ObjectModel;
  let ingestionJobModel: IngestionJobModel;
  let chunkModel: ChunkSqlModel;
  let ingestionQueueService: IngestionQueueService;
  let chunkingService: ChunkingService;
  let llmService: LLMService;
  let urlWorker: UrlIngestionWorker;
  let vectorStore: ChromaVectorModel;

  beforeAll(() => {
    // Skip if no API key
    if (!process.env.OPENAI_API_KEY) {
      console.log('⚠️  Skipping URL ingestion tests - OPENAI_API_KEY not set');
      return;
    }
  });

  beforeEach(async () => {
    if (!process.env.OPENAI_API_KEY) return;

    // Setup in-memory database
    db = new Database(':memory:');
    await runMigrations(db);
    
    // Initialize models
    objectModel = new ObjectModel(db);
    ingestionJobModel = new IngestionJobModel(db);
    chunkModel = new ChunkSqlModel(db);
    
    // Initialize LLM providers
    const completionProvider = new OpenAIGPT41NanoProvider();
    const embeddingProvider = new OpenAITextEmbedding3SmallProvider();
    
    const completionProviders = new Map();
    completionProviders.set('OpenAI-GPT-4.1-Nano', completionProvider);
    
    const embeddingProviders = new Map();
    embeddingProviders.set('OpenAI-text-embedding-3-small', embeddingProvider);
    
    // Initialize services
    llmService = new LLMService({
      completionProviders,
      embeddingProviders,
      defaultCompletionModel: 'OpenAI-GPT-4o-Mini',
      defaultEmbeddingModel: 'OpenAI-text-embedding-3-small',
      defaultVectorPrepModel: 'OpenAI-GPT-4.1-Nano'
    });

    // Initialize vector store (mock for tests)
    vectorStore = {
      addDocuments: async (docs) => {
        // Generate unique UUIDs for each document
        const { v4: uuidv4 } = await import('uuid');
        return docs.map(() => uuidv4());
      }
    } as any;

    // Initialize ingestion queue with higher concurrency
    ingestionQueueService = new IngestionQueueService(ingestionJobModel, {
      concurrency: 20, // Process up to 20 URLs simultaneously
      pollInterval: 100, // Fast polling for tests
      maxRetries: 1 // Minimize retries for tests
    });

    // Initialize workers
    urlWorker = new UrlIngestionWorker(objectModel, ingestionJobModel, llmService);
    ingestionQueueService.registerProcessor('url', urlWorker.execute.bind(urlWorker));

    // Initialize chunking service with higher concurrency
    chunkingService = new ChunkingService(
      db,
      vectorStore,
      100, // Fast polling interval
      undefined, // agent
      objectModel,
      chunkModel,
      undefined, // embeddingSqlModel
      ingestionJobModel,
      llmService,
      20 // Match ingestion queue concurrency
    );
  });

  afterEach(async () => {
    if (!process.env.OPENAI_API_KEY) return;
    
    // Stop services
    await ingestionQueueService.stop();
    chunkingService.stop();
    
    // Close database
    db.close();
  });

  it('should process 20 URLs concurrently through the complete pipeline', async () => {
    if (!process.env.OPENAI_API_KEY) {
      return;
    }

    logger.info('=== Starting Concurrent URL Ingestion Test ===');

    // Track job and processing states
    const jobStates = new Map<string, {
      url: string;
      jobId?: string;
      objectId?: string;
      startTime?: number;
      endTime?: number;
      status?: string;
      error?: string;
    }>();

    // Initialize tracking for each URL
    TEST_URLS.forEach(url => {
      jobStates.set(url, { url });
    });

    // Listen to queue events
    ingestionQueueService.on('job:created', (job) => {
      const state = jobStates.get(job.sourceIdentifier);
      if (state) {
        state.jobId = job.id;
        logger.info(`[Test] Job created for ${job.sourceIdentifier.substring(0, 50)}...`);
      }
    });

    ingestionQueueService.on('job:started', (job) => {
      const state = jobStates.get(job.sourceIdentifier);
      if (state) {
        state.startTime = Date.now();
        logger.info(`[Test] Job started: ${job.sourceIdentifier.substring(0, 50)}...`);
      }
    });

    ingestionQueueService.on('job:completed', (job) => {
      const state = jobStates.get(job.sourceIdentifier);
      if (state) {
        state.endTime = Date.now();
        state.status = 'completed';
        logger.info(`[Test] Job completed: ${job.sourceIdentifier.substring(0, 50)}...`);
      }
    });

    ingestionQueueService.on('job:failed', (job, error) => {
      const state = jobStates.get(job.sourceIdentifier);
      if (state) {
        state.endTime = Date.now();
        state.status = 'failed';
        state.error = error.message;
        logger.error(`[Test] Job failed: ${job.sourceIdentifier.substring(0, 50)}...`, error);
      }
    });

    // === PHASE 1: Create objects and jobs ===
    logger.info('\n--- Phase 1: Creating objects and jobs ---');
    
    const jobs = await Promise.all(TEST_URLS.map(async (url) => {
      // Create object first
      const object = await objectModel.create({
        objectType: 'web_page',
        sourceUri: url,
        title: null,
        status: 'new',
        rawContentRef: null,
        parsedContentJson: null,
        errorInfo: null,
      });

      const state = jobStates.get(url)!;
      state.objectId = object.id;

      // Add job to queue
      const job = await ingestionQueueService.addJob('url', url, {
        priority: 0,
        jobSpecificData: {
          relatedObjectId: object.id
        }
      });

      return job;
    }));

    // Verify all jobs created
    expect(jobs).toHaveLength(TEST_URLS.length);
    jobs.forEach(job => {
      expect(job.status).toBe('queued');
    });

    // === PHASE 2: Start queue processing ===
    logger.info('\n--- Phase 2: Starting concurrent processing ---');
    
    const processingStartTime = Date.now();
    ingestionQueueService.start();

    // Wait for all jobs to move to vectorizing status
    logger.info('Waiting for URL processing to complete...');
    
    await new Promise<void>((resolve) => {
      let lastLogTime = Date.now();
      const checkInterval = setInterval(async () => {
        const stats = ingestionQueueService.getStats();
        const activeCount = ingestionQueueService.getActiveJobCount();
        
        // Check job statuses
        const jobStatuses = await Promise.all(jobs.map(j => ingestionJobModel.getById(j.id)));
        const vectorizingCount = jobStatuses.filter(j => j?.status === 'vectorizing').length;
        const failedCount = jobStatuses.filter(j => j?.status === 'failed').length;
        
        // Only log every 30 seconds
        if (Date.now() - lastLogTime > 30000) {
          logger.info(`Active: ${activeCount}, Vectorizing: ${vectorizingCount}, Failed: ${failedCount}`);
          lastLogTime = Date.now();
        }

        // All jobs should either be vectorizing or failed
        if (vectorizingCount + failedCount === TEST_URLS.length) {
          clearInterval(checkInterval);
          resolve();
        }

        // Timeout check
        if (Date.now() - processingStartTime > 60000) {
          clearInterval(checkInterval);
          logger.error('Timeout waiting for URL processing');
          resolve();
        }
      }, 1000);
    });

    // Stop the queue
    await ingestionQueueService.stop();

    // === PHASE 3: Verify URL processing results ===
    logger.info('\n--- Phase 3: Verifying URL processing results ---');

    for (const [url, state] of jobStates) {
      const object = await objectModel.getById(state.objectId!);
      const job = await ingestionJobModel.getById(state.jobId!);
      
      logger.info(`\n📄 ${url.substring(0, 60)}...`);
      logger.info(`  Job Status: ${job?.status}`);
      logger.info(`  Object Status: ${object?.status}`);
      
      if (object?.status === 'parsed') {
        // Verify object has required fields
        expect(object.cleanedText).toBeTruthy();
        expect(object.parsedContentJson).toBeTruthy();
        expect(object.summary).toBeTruthy();
        expect(object.tagsJson).toBeTruthy();
        expect(object.propositionsJson).toBeTruthy();
        
        // Log summary for manual verification
        logger.info(`  Title: ${object.title}`);
        logger.info(`  Summary: ${object.summary?.substring(0, 100)}...`);
        logger.info(`  Text Length: ${object.cleanedText?.length}`);
        
        try {
          const tags = JSON.parse(object.tagsJson || '[]');
          logger.info(`  Tags: ${tags.join(', ')}`);
        } catch (e) {
          logger.error('  Failed to parse tags');
        }
      }
    }

    // === PHASE 4: Start chunking service ===
    logger.info('\n--- Phase 4: Starting chunking service ---');
    
    chunkingService.start();
    
    // Wait for chunking to complete
    const chunkingStartTime = Date.now();
    await new Promise<void>((resolve) => {
      let lastLogTime = Date.now();
      const checkInterval = setInterval(async () => {
        // Check how many objects are embedded
        const objects = await Promise.all(
          Array.from(jobStates.values()).map(s => objectModel.getById(s.objectId!))
        );
        
        const embeddedCount = objects.filter(o => o?.status === 'embedded').length;
        const failedCount = objects.filter(o => o?.status === 'embedding_failed').length;
        
        // Only log every 30 seconds
        if (Date.now() - lastLogTime > 30000) {
          logger.info(`Embedded: ${embeddedCount}, Failed: ${failedCount}`);
          lastLogTime = Date.now();
        }

        // Wait for ALL documents to either embed or fail
        if (embeddedCount + failedCount === TEST_URLS.length) {
          clearInterval(checkInterval);
          resolve();
        }

        // Timeout check - increased to 10 minutes for chunking all documents
        if (Date.now() - chunkingStartTime > 600000) {
          clearInterval(checkInterval);
          logger.error('Timeout waiting for chunking');
          resolve();
        }
      }, 1000);
    });

    chunkingService.stop();

    // === PHASE 5: Verify final results ===
    logger.info('\n--- Phase 5: Final verification ---');

    const results = {
      total: TEST_URLS.length,
      parsed: 0,
      embedded: 0,
      failed: 0,
      totalChunks: 0,
      processingTimes: [] as number[]
    };

    for (const [url, state] of jobStates) {
      const object = await objectModel.getById(state.objectId!);
      const chunks = await chunkModel.listByObjectId(state.objectId!);
      
      logger.info(`\n✅ ${url.substring(0, 60)}...`);
      logger.info(`  Final Status: ${object?.status}`);
      logger.info(`  Chunks Created: ${chunks.length}`);
      
      if (object?.status === 'embedded') {
        results.embedded++;
        results.totalChunks += chunks.length;
        
        // Verify chunks have required fields
        chunks.forEach((chunk, idx) => {
          expect(chunk.content).toBeTruthy();
          expect(chunk.summary).toBeTruthy();
          expect(chunk.propositionsJson).toBeTruthy();
          expect(chunk.tagsJson).toBeTruthy();
          
          if (idx === 0 && chunk.summary) {
            logger.info(`  First chunk summary: ${chunk.summary.substring(0, 80)}...`);
          }
        });
      } else if (object?.status === 'parsed') {
        results.parsed++;
      } else {
        results.failed++;
      }

      // Calculate processing time
      if (state.startTime && state.endTime) {
        const processingTime = (state.endTime - state.startTime) / 1000;
        results.processingTimes.push(processingTime);
        logger.info(`  Processing Time: ${processingTime.toFixed(2)}s`);
      }
    }

    // === Summary ===
    logger.info('\n=== Test Summary ===');
    logger.info(`Total URLs: ${results.total}`);
    logger.info(`Successfully Embedded: ${results.embedded}`);
    logger.info(`Parsed Only: ${results.parsed}`);
    logger.info(`Failed: ${results.failed}`);
    logger.info(`Total Chunks: ${results.totalChunks}`);
    
    if (results.processingTimes.length > 0) {
      const avgTime = results.processingTimes.reduce((a, b) => a + b, 0) / results.processingTimes.length;
      logger.info(`Average Processing Time: ${avgTime.toFixed(2)}s`);
    }

    // Basic assertions
    expect(results.embedded).toBeGreaterThan(0); // At least some should succeed
    expect(results.totalChunks).toBeGreaterThan(0); // Should create chunks
    
    // Verify concurrent processing happened
    const concurrentJobs = Array.from(jobStates.values()).filter(s => 
      s.startTime && s.startTime < processingStartTime + 5000 // Started within 5 seconds
    );
    expect(concurrentJobs.length).toBeGreaterThanOrEqual(15); // At least 15 started concurrently
  }, 900000); // 15 minute timeout to allow all documents to chunk

  it('should maintain data integrity through status transitions', async () => {
    if (!process.env.OPENAI_API_KEY) {
      return;
    }

    // Test with just one URL for focused status verification
    const testUrl = TEST_URLS[0];
    
    // Track all status transitions
    const statusTransitions: Array<{time: Date, objectId: string, status: string}> = [];
    
    // Create object
    const object = await objectModel.create({
      objectType: 'web_page',
      sourceUri: testUrl,
      title: null,
      status: 'new',
      rawContentRef: null,
      parsedContentJson: null,
      errorInfo: null,
    });

    // Create job
    const job = await ingestionQueueService.addJob('url', testUrl, {
      jobSpecificData: { relatedObjectId: object.id }
    });

    // Start processing
    ingestionQueueService.start();

    // Poll for status changes
    const startTime = Date.now();
    const seenStatuses = new Set<string>();
    
    while (Date.now() - startTime < 20000) { // 20 second timeout
      const currentObject = await objectModel.getById(object.id);
      const currentJob = await ingestionJobModel.getById(job.id);
      
      if (currentObject && !seenStatuses.has(currentObject.status)) {
        seenStatuses.add(currentObject.status);
        statusTransitions.push({
          time: new Date(),
          objectId: object.id,
          status: currentObject.status
        });
        logger.info(`Object transitioned to: ${currentObject.status}`);
      }

      if (currentJob?.status === 'vectorizing') {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    await ingestionQueueService.stop();

    // Verify expected transitions
    const statuses = statusTransitions.map(t => t.status);
    expect(statuses).toContain('new');
    expect(statuses).toContain('parsed');
    
    // Verify no invalid transitions
    for (let i = 1; i < statuses.length; i++) {
      const prev = statuses[i-1];
      const curr = statuses[i];
      
      // Define valid transitions
      const validTransitions: Record<string, string[]> = {
        'new': ['parsed', 'error'],
        'parsed': ['embedding', 'error'],
        'embedding': ['embedded', 'embedding_failed'],
      };
      
      if (validTransitions[prev] && !validTransitions[prev].includes(curr)) {
        throw new Error(`Invalid transition: ${prev} -> ${curr}`);
      }
    }

    logger.info('Status transitions verified:', statuses.join(' → '));
  }, 30000); // 30 second timeout
});