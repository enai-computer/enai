import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import Database from 'better-sqlite3';
import { IngestionJobModel } from '../../../models/IngestionJobModel';
import { ObjectModelCore } from '../../../models/ObjectModelCore';
import { EmbeddingModel } from '../../../models/EmbeddingModel';
import { ChunkModel } from '../../../models/ChunkModel';
import { IngestionQueueService } from '../IngestionQueueService';
import { ChunkingService } from '../ChunkingService';
import type { IVectorStore, IngestionJob } from '../../../shared/types';
import runMigrations from '../../../models/runMigrations';
import { logger } from '../../../utils/logger';
import * as fetchMethod from '../../../ingestion/fetch/fetchMethod';
import { Worker } from 'worker_threads';
import { IngestionAiService } from '../IngestionAIService';

// Mock the entire worker_threads module before imports
vi.mock('worker_threads');

// Mock the fetch method
vi.mock('../../../ingestion/fetch/fetchMethod');

// Mock the IngestionAiService
vi.mock('../IngestionAIService');

// Mock require.resolve for the worker file check
const originalRequire = global.require;
vi.stubGlobal('require', Object.assign((...args: any[]) => originalRequire(...args), {
  resolve: vi.fn(() => '/mocked/path/to/worker.js')
}));

// Import UrlIngestionWorker after mocks are set up
import { UrlIngestionWorker } from '../UrlIngestionWorker';

describe('UrlIngestionWorker', () => {
  let db: Database.Database;
  let objectModel: ObjectModelCore;
  let ingestionJobModel: IngestionJobModel;
  let urlWorker: UrlIngestionWorker;
  let mockWorker: any;
  let mockIngestionAiService: any;

  beforeEach(async () => {
    // Setup in-memory database
    db = new Database(':memory:');
    await runMigrations(db);
    
    // Initialize models
    objectModel = new ObjectModelCore(db);
    ingestionJobModel = new IngestionJobModel(db);
    
    // Setup mock worker
    mockWorker = {
      postMessage: vi.fn(),
      terminate: vi.fn().mockResolvedValue(undefined),
      removeAllListeners: vi.fn(),
      on: vi.fn()
    };
    
    vi.mocked(Worker).mockImplementation(() => mockWorker as any);
    
    // Setup mock IngestionAiService
    mockIngestionAiService = {
      generateObjectSummary: vi.fn().mockResolvedValue({
        title: 'Test Article',
        summary: 'This is a test summary of the article.',
        tags: ['test', 'mock', 'article'],
        propositions: [
          { type: 'main', content: 'Main proposition about the article' },
          { type: 'supporting', content: 'Supporting detail' }
        ]
      })
    };
    
    vi.mocked(IngestionAiService).mockImplementation(() => mockIngestionAiService);
    
    // Initialize worker
    urlWorker = new UrlIngestionWorker(objectModel, ingestionJobModel);
  });

  afterEach(() => {
    vi.clearAllMocks();
    db.close();
  });

  describe('execute', () => {
    it('should successfully process a URL and create a new object', async () => {
      const testUrl = 'https://example.com/test-article';
      
      // Mock fetch response
      vi.mocked(fetchMethod.fetchPageWithFallback).mockResolvedValue({
        html: '<html><body><h1>Test Article</h1><p>Test content</p></body></html>',
        finalUrl: testUrl,
        httpStatus: 200
      });
      
      // Create a test job
      const job = await ingestionJobModel.create({
        jobType: 'url',
        sourceIdentifier: testUrl,
        priority: 0,
        jobSpecificData: {}
      });
      
      // Setup worker mock to simulate successful parsing
      mockWorker.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'message') {
          // Simulate worker sending back parsed content
          setTimeout(() => {
            handler({
              result: {
                title: 'Test Article',
                byline: 'Test Author',
                dir: 'ltr',
                content: '<h1>Test Article</h1><p>Test content</p>',
                textContent: 'Test Article\n\nTest content',
                length: 100,
                excerpt: 'Test content',
                siteName: 'Example Site'
              }
            });
          }, 10);
        }
      });
      
      // Execute the job
      await urlWorker.execute(job);
      
      // Verify fetch was called
      expect(fetchMethod.fetchPageWithFallback).toHaveBeenCalledWith(testUrl, {});
      
      // Verify worker was created and used
      expect(Worker).toHaveBeenCalled();
      expect(mockWorker.postMessage).toHaveBeenCalledWith({
        html: '<html><body><h1>Test Article</h1><p>Test content</p></body></html>',
        url: testUrl
      });
      
      // Verify AI service was called
      expect(mockIngestionAiService.generateObjectSummary).toHaveBeenCalledWith(
        expect.stringContaining('Test Article'),
        'Test Article',
        job.id
      );
      
      // Verify object was created
      const createdObject = await objectModel.getBySourceUri(testUrl);
      expect(createdObject).not.toBeNull();
      expect(createdObject).toMatchObject({
        objectType: 'webpage',
        sourceUri: testUrl,
        title: 'Test Article',
        status: 'parsed',
        summary: 'This is a test summary of the article.'
      });
      
      // Verify job status was updated
      const updatedJob = await ingestionJobModel.getById(job.id);
      expect(updatedJob?.status).toBe('vectorizing');
      expect(updatedJob?.chunking_status).toBe('pending');
      expect(updatedJob?.relatedObjectId).toBe(createdObject!.id);
    });

    it('should handle fetch failures gracefully', async () => {
      const testUrl = 'https://example.com/fail';
      
      // Mock fetch failure
      vi.mocked(fetchMethod.fetchPageWithFallback).mockRejectedValue(
        new Error('Network error')
      );
      
      // Create a test job
      const job = await ingestionJobModel.create({
        jobType: 'url',
        sourceIdentifier: testUrl,
        priority: 0,
        jobSpecificData: {}
      });
      
      // Execute the job
      await urlWorker.execute(job);
      
      // Verify job was marked as failed (network errors are transient so status is retry_pending)
      const updatedJob = await ingestionJobModel.getById(job.id);
      expect(updatedJob?.status).toBe('retry_pending');
      expect(updatedJob?.errorInfo).toBeTruthy();
      expect(updatedJob?.errorInfo).toMatch(/Network error/);
      
      // Verify no object was created
      const createdObject = await objectModel.getBySourceUri(testUrl);
      expect(createdObject).toBeNull();
    });

    it('should handle parsing failures gracefully', async () => {
      const testUrl = 'https://example.com/unparseable';
      
      // Mock successful fetch
      vi.mocked(fetchMethod.fetchPageWithFallback).mockResolvedValue({
        html: '<html><body>Invalid content</body></html>',
        finalUrl: testUrl,
        httpStatus: 200
      });
      
      // Create a test job
      const job = await ingestionJobModel.create({
        jobType: 'url',
        sourceIdentifier: testUrl,
        priority: 0,
        jobSpecificData: {}
      });
      
      // Setup worker mock to simulate parsing failure
      mockWorker.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            handler({ result: null });
          }, 10);
        }
      });
      
      // Execute the job
      await urlWorker.execute(job);
      
      // Verify job was marked as failed
      const updatedJob = await ingestionJobModel.getById(job.id);
      expect(updatedJob?.status).toBe('failed');
      expect(updatedJob?.errorInfo).toBeTruthy();
      expect(updatedJob?.errorInfo).toMatch(/Failed to extract content/);
      
      // Verify no object was created
      const createdObject = await objectModel.getBySourceUri(testUrl);
      expect(createdObject).toBeNull();
    });

    it('should update existing object when relatedObjectId is provided', async () => {
      const testUrl = 'https://example.com/existing';
      
      // Create an existing object
      const existingObject = await objectModel.create({
        objectType: 'webpage',
        sourceUri: testUrl,
        title: 'Old Title',
        status: 'new',
        rawContentRef: null,
        parsedContentJson: null,
        errorInfo: null
      });
      
      // Mock fetch response
      vi.mocked(fetchMethod.fetchPageWithFallback).mockResolvedValue({
        html: '<html><body><h1>Updated Article</h1></body></html>',
        finalUrl: testUrl,
        httpStatus: 200
      });
      
      // Create a test job with relatedObjectId
      const job = await ingestionJobModel.create({
        jobType: 'url',
        sourceIdentifier: testUrl,
        priority: 0,
        relatedObjectId: existingObject.id,
        jobSpecificData: { relatedObjectId: existingObject.id }
      });
      
      // Setup worker mock
      mockWorker.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            handler({
              result: {
                title: 'Updated Article',
                textContent: 'Updated content',
                content: '<h1>Updated Article</h1>',
                byline: null,
                dir: 'ltr',
                length: 100,
                excerpt: 'Updated content',
                siteName: null
              }
            });
          }, 10);
        }
      });
      
      // Execute the job
      await urlWorker.execute(job);
      
      // Verify object was updated
      const updatedObject = await objectModel.getById(existingObject.id);
      expect(updatedObject).toMatchObject({
        id: existingObject.id,
        title: 'Updated Article',
        status: 'parsed',
        summary: 'This is a test summary of the article.'
      });
      
      // Verify no new object was created - just updated the existing one
      const allObjects = await objectModel.findByStatus(['parsed']);
      const objectsWithUrl = allObjects.filter(o => o.sourceUri === testUrl);
      expect(objectsWithUrl).toHaveLength(1);
      expect(objectsWithUrl[0].id).toBe(existingObject.id);
    });

    it.skip('should handle worker timeout', async () => {
      const testUrl = 'https://example.com/timeout';
      
      // Mock successful fetch
      vi.mocked(fetchMethod.fetchPageWithFallback).mockResolvedValue({
        html: '<html><body>Content</body></html>',
        finalUrl: testUrl,
        httpStatus: 200
      });
      
      // Create a test job
      const job = await ingestionJobModel.create({
        jobType: 'url',
        sourceIdentifier: testUrl,
        priority: 0,
        jobSpecificData: {}
      });
      
      // Setup worker mock to never respond (simulating timeout)
      mockWorker.on.mockImplementation(() => {
        // Do nothing - simulate hanging worker
      });
      
      // Mock the timeout by using vi.useFakeTimers
      vi.useFakeTimers();
      
      // Execute the job (this will hang waiting for worker response)
      const executePromise = urlWorker.execute(job);
      
      // Need to wait a tick for the timer to be set up
      await new Promise(resolve => setImmediate(resolve));
      
      // Fast forward time to trigger timeout
      await vi.advanceTimersByTimeAsync(31000); // Advance past WORKER_TIMEOUT_MS (30 seconds)
      
      // Wait for the execution to complete
      await executePromise;
      
      // Restore real timers
      vi.useRealTimers();
      
      // Verify job was marked as failed
      const updatedJob = await ingestionJobModel.getById(job.id);
      expect(updatedJob?.status).toBe('failed');
      expect(updatedJob?.errorInfo).toBeTruthy();
      expect(updatedJob?.errorInfo).toMatch(/timeout/);
    });

    it('should handle AI service failures with fallback', async () => {
      const testUrl = 'https://example.com/ai-fail';
      
      // Mock fetch response
      vi.mocked(fetchMethod.fetchPageWithFallback).mockResolvedValue({
        html: '<html><body><h1>Test Article</h1></body></html>',
        finalUrl: testUrl,
        httpStatus: 200
      });
      
      // Mock AI service failure
      mockIngestionAiService.generateObjectSummary.mockRejectedValue(
        new Error('AI service error')
      );
      
      // Create a test job
      const job = await ingestionJobModel.create({
        jobType: 'url',
        sourceIdentifier: testUrl,
        priority: 0,
        jobSpecificData: {}
      });
      
      // Setup worker mock
      mockWorker.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            handler({
              result: {
                title: 'Test Article',
                textContent: 'Test content',
                content: '<h1>Test Article</h1>',
                byline: null,
                dir: 'ltr',
                length: 100,
                excerpt: 'Test content',
                siteName: null
              }
            });
          }, 10);
        }
      });
      
      // Execute the job
      await urlWorker.execute(job);
      
      // Verify object was still created with fallback summary
      const createdObject = await objectModel.getBySourceUri(testUrl);
      expect(createdObject).not.toBeNull();
      expect(createdObject).toMatchObject({
        title: 'Test Article',
        status: 'parsed',
        summary: 'Summary of: Test Article'
      });
      
      // Verify job completed successfully despite AI failure
      const updatedJob = await ingestionJobModel.getById(job.id);
      expect(updatedJob?.status).toBe('vectorizing');
    });
  });
});

describe('URL Ingestion Pipeline - Integration', () => {
  let db: Database.Database;
  let objectModel: ObjectModelCore;
  let ingestionJobModel: IngestionJobModel;
  let chunkModel: ChunkModel;
  let embeddingModel: EmbeddingModel;
  let ingestionQueueService: IngestionQueueService;
  let chunkingService: ChunkingService;
  let urlWorker: UrlIngestionWorker;
  let vectorStore: IVectorStore;

  beforeEach(async () => {
    // Setup in-memory database
    db = new Database(':memory:');
    await runMigrations(db);
    
    // Initialize models
    objectModel = new ObjectModelCore(db);
    ingestionJobModel = new IngestionJobModel(db);
    chunkModel = new ChunkModel(db);
    embeddingModel = new EmbeddingModel(db);
    
    // Mock vector store
    vectorStore = {
      addDocuments: vi.fn().mockImplementation(async (docs) => {
        const { v4: uuidv4 } = await import('uuid');
        return docs.map(() => uuidv4());
      })
    } as any;
    
    // Initialize services
    ingestionQueueService = new IngestionQueueService(ingestionJobModel, {
      concurrency: 5,
      pollInterval: 100,
      maxRetries: 1
    });
    
    urlWorker = new UrlIngestionWorker(objectModel, ingestionJobModel);
    ingestionQueueService.registerProcessor('url', urlWorker.execute.bind(urlWorker));
    
    chunkingService = new ChunkingService(
      db,
      vectorStore,
      100,
      undefined,
      objectModel,
      chunkModel,
      embeddingModel,
      ingestionJobModel,
      5
    );
  });

  afterEach(async () => {
    await ingestionQueueService.stop();
    chunkingService.stop();
    vi.clearAllMocks();
    db.close();
  });

  it('should process a URL through the complete pipeline', async () => {
    // Reset the mock AI service for this test
    const mockIngestionAiService = {
      generateObjectSummary: vi.fn().mockResolvedValue({
        title: 'Pipeline Test',
        summary: 'This is a test summary of the article.',
        tags: ['test', 'pipeline'],
        propositions: [
          { type: 'main', content: 'Main proposition' },
          { type: 'supporting', content: 'Supporting detail' }
        ]
      })
    };
    
    vi.mocked(IngestionAiService).mockImplementation(() => mockIngestionAiService);
    
    // Recreate the worker with the new mock
    urlWorker = new UrlIngestionWorker(objectModel, ingestionJobModel);
    ingestionQueueService.registerProcessor('url', urlWorker.execute.bind(urlWorker));
    const testUrl = 'https://example.com/pipeline-test';
    
    // Mock fetch
    vi.mocked(fetchMethod.fetchPageWithFallback).mockResolvedValue({
      html: '<html><body><h1>Pipeline Test</h1><p>Test content for pipeline</p></body></html>',
      finalUrl: testUrl,
      httpStatus: 200
    });
    
    // Setup worker mock
    const mockWorker = {
      postMessage: vi.fn(),
      terminate: vi.fn().mockResolvedValue(undefined),
      removeAllListeners: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            handler({
              result: {
                title: 'Pipeline Test',
                textContent: 'Pipeline Test\n\nTest content for pipeline',
                content: '<h1>Pipeline Test</h1><p>Test content for pipeline</p>',
                byline: null,
                dir: 'ltr',
                length: 150,
                excerpt: 'Test content',
                siteName: null
              }
            });
          }, 10);
        }
      })
    };
    
    vi.mocked(Worker).mockImplementation(() => mockWorker as any);
    
    // Create object and job
    const object = await objectModel.create({
      objectType: 'webpage',
      sourceUri: testUrl,
      title: null,
      status: 'new',
      rawContentRef: null,
      parsedContentJson: null,
      errorInfo: null
    });
    
    const job = await ingestionQueueService.addJob('url', testUrl, {
      priority: 0,
      jobSpecificData: { relatedObjectId: object.id }
    });
    
    // Start processing
    ingestionQueueService.start();
    
    // Wait for job to complete
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(async () => {
        const updatedJob = await ingestionJobModel.getById(job.id);
        if (updatedJob?.status === 'vectorizing') {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
    });
    
    // Verify object was updated
    const updatedObject = await objectModel.getById(object.id);
    expect(updatedObject).toMatchObject({
      status: 'parsed',
      title: 'Pipeline Test',
      summary: 'This is a test summary of the article.'
    });
    
    // Verify job status
    const finalJob = await ingestionJobModel.getById(job.id);
    expect(finalJob?.status).toBe('vectorizing');
    expect(finalJob?.chunking_status).toBe('pending');
  });
});