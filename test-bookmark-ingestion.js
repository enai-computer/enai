const Database = require('better-sqlite3');
const path = require('path');
const { ObjectModel } = require('./dist/electron/models/ObjectModel');
const { IngestionJobModel } = require('./dist/electron/models/IngestionJobModel');
const { IngestionQueueService } = require('./dist/electron/services/IngestionQueueService');
const { UrlIngestionWorker } = require('./dist/electron/services/ingestion/UrlIngestionWorker');
const { LLMService } = require('./dist/electron/services/LLMService');
const { OpenAIGPT4oMiniProvider, OpenAITextEmbedding3SmallProvider } = require('./dist/electron/services/llm_providers/openai');
const { logger } = require('./dist/electron/utils/logger');

// Test URL
const TEST_URL = 'https://en.wikipedia.org/wiki/Robert_Irwin_(artist)';

async function testBookmarkIngestion() {
    logger.info('=== Starting Bookmark Ingestion Test ===');
    
    // Initialize database
    const dbPath = path.join(process.env.HOME, 'Library/Application Support/src/jeffers.db');
    const db = new Database(dbPath);
    logger.info(`Connected to database at: ${dbPath}`);
    
    // Initialize models
    const objectModel = new ObjectModel(db);
    const ingestionJobModel = new IngestionJobModel(db);
    
    // Initialize LLM providers
    const completionProvider = new OpenAIGPT4oMiniProvider();
    const embeddingProvider = new OpenAITextEmbedding3SmallProvider();
    
    // Create LLM provider maps
    const completionProviders = new Map();
    completionProviders.set('OpenAI-GPT-4o-Mini', completionProvider);
    
    const embeddingProviders = new Map();
    embeddingProviders.set('OpenAI-text-embedding-3-small', embeddingProvider);
    
    // Initialize LLMService
    const llmService = new LLMService({
        completionProviders,
        embeddingProviders,
        defaultCompletionProvider: 'OpenAI-GPT-4o-Mini',
        defaultEmbeddingProvider: 'OpenAI-text-embedding-3-small'
    });
    logger.info('LLMService initialized');
    
    // Initialize services
    const ingestionQueueService = new IngestionQueueService(ingestionJobModel, {
        concurrency: 1,
        pollInterval: 1000,
        maxRetries: 3
    });
    
    // Initialize worker with dependencies
    const urlWorker = new UrlIngestionWorker(objectModel, ingestionJobModel, llmService);
    
    // Register the URL processor (bind execute method)
    ingestionQueueService.registerProcessor('url', urlWorker.execute.bind(urlWorker));
    
    // Listen to queue events
    ingestionQueueService.on('job:created', (job) => {
        logger.info(`[Test] Job created: ${job.id} for ${job.sourceIdentifier}`);
    });
    
    ingestionQueueService.on('job:started', (job) => {
        logger.info(`[Test] Job started: ${job.id}`);
    });
    
    ingestionQueueService.on('job:completed', (job) => {
        logger.info(`[Test] Job completed: ${job.id}`);
    });
    
    ingestionQueueService.on('job:failed', (job, error) => {
        logger.error(`[Test] Job failed: ${job.id}`, error);
    });
    
    ingestionQueueService.on('job:retry', (job, error) => {
        logger.warn(`[Test] Job will retry: ${job.id}`, error);
    });
    
    try {
        // Check if object already exists
        logger.info(`\n1. Checking if object exists for URL: ${TEST_URL}`);
        let existingObject = await objectModel.getBySourceUri(TEST_URL);
        
        if (existingObject) {
            logger.info(`Found existing object:`, {
                id: existingObject.id,
                status: existingObject.status,
                title: existingObject.title,
                tagsJson: existingObject.tagsJson
            });
        } else {
            logger.info('No existing object found, creating new one...');
            
            // Create new object
            existingObject = await objectModel.create({
                objectType: 'bookmark',
                sourceUri: TEST_URL,
                title: null,
                status: 'new',
                rawContentRef: null,
                parsedContentJson: null,
                errorInfo: null,
            });
            
            logger.info(`Created new object with ID: ${existingObject.id}`);
        }
        
        // Check queue stats before starting
        logger.info('\n2. Queue statistics before processing:');
        const statsBefore = ingestionQueueService.getStats();
        logger.info(statsBefore);
        
        // Add job to queue if object is new or has error
        if (existingObject.status === 'new' || existingObject.status === 'error') {
            logger.info(`\n3. Adding job to queue for object ${existingObject.id}...`);
            
            const job = await ingestionQueueService.addJob('url', TEST_URL, {
                priority: 0,
                jobSpecificData: {
                    relatedObjectId: existingObject.id
                }
            });
            
            logger.info(`Job created with ID: ${job.id}`);
            
            // Start the queue
            logger.info('\n4. Starting queue processing...');
            ingestionQueueService.start();
            
            // Wait for processing to complete (with timeout)
            logger.info('Waiting for job to complete...');
            const startTime = Date.now();
            const timeout = 60000; // 60 seconds timeout
            
            while (true) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // Check every 2 seconds
                
                const activeJobs = ingestionQueueService.getActiveJobCount();
                const stats = ingestionQueueService.getStats();
                
                logger.info(`Active jobs: ${activeJobs}, Queue stats:`, stats);
                
                // Check if job is complete
                const updatedJob = ingestionJobModel.getById(job.id);
                if (updatedJob && (updatedJob.status === 'completed' || updatedJob.status === 'failed')) {
                    logger.info(`\nJob finished with status: ${updatedJob.status}`);
                    if (updatedJob.errorInfo) {
                        logger.error('Job error info:', updatedJob.errorInfo);
                    }
                    break;
                }
                
                // Check timeout
                if (Date.now() - startTime > timeout) {
                    logger.error('Timeout waiting for job to complete');
                    break;
                }
            }
            
            // Stop the queue
            logger.info('\n5. Stopping queue...');
            await ingestionQueueService.stop();
            
        } else {
            logger.info(`Object already processed with status: ${existingObject.status}`);
        }
        
        // Check final object state
        logger.info('\n6. Checking final object state...');
        const finalObject = await objectModel.getBySourceUri(TEST_URL);
        if (finalObject) {
            logger.info('Final object state:', {
                id: finalObject.id,
                status: finalObject.status,
                title: finalObject.title,
                tagsJson: finalObject.tagsJson,
                parsedContentJson: finalObject.parsedContentJson ? 'Present' : 'None',
                embeddingId: finalObject.embeddingId || 'None'
            });
            
            // If we have tags, display them
            if (finalObject.tagsJson) {
                try {
                    const tags = JSON.parse(finalObject.tagsJson);
                    logger.info('Tags:', tags);
                } catch (e) {
                    logger.error('Failed to parse tags JSON:', e);
                }
            }
        }
        
        // Get final queue stats
        logger.info('\n7. Final queue statistics:');
        const statsAfter = ingestionQueueService.getStats();
        logger.info(statsAfter);
        
    } catch (error) {
        logger.error('Test failed:', error);
    } finally {
        // Close database connection
        db.close();
        logger.info('\n=== Bookmark Ingestion Test Complete ===');
    }
}

// Run the test
testBookmarkIngestion().catch(error => {
    logger.error('Unhandled error:', error);
    process.exit(1);
});