import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChunkingService } from '../ChunkingService';
import type { ChunkLLMResult } from '../IngestionAIService';
import type { JeffersObject, ObjectStatus, IVectorStore } from '../../../shared/types';
import type Database from 'better-sqlite3';
import { createTestObject } from '../../../test-utils/mocks/models';
import { createMockDatabase } from '../../../test-utils/mocks/services';

// Set up fake timers for deterministic testing
vi.useFakeTimers();

// Mock IngestionAiService before import
vi.mock('../IngestionAIService');
import { IngestionAiService } from '../IngestionAIService';

describe('ChunkingService', () => {
  let chunkingService: ChunkingService;
  let mockDb: Partial<Database.Database>;
  let mockVectorStore: IVectorStore;
  let mockObjectModel: any;
  let mockChunkSqlModel: any;
  let mockEmbeddingSqlModel: any;
  let mockIngestionJobModel: any;
  let mockAgent: any;
  
  // Test data storage to simulate database behavior
  let objectStore: Map<string, JeffersObject>;
  let chunkStore: any[];
  let embeddingStore: any[];
  
  beforeEach(() => {
    // Initialize test data stores
    objectStore = new Map();
    chunkStore = [];
    embeddingStore = [];
    
    // Create minimal database mock
    mockDb = createMockDatabase();
    
    // Create minimal vector store mock
    mockVectorStore = {
      addDocuments: vi.fn().mockImplementation(async (documents) => {
        return documents.map((_, i) => `fake-vector-id-${i}`);
      })
    };
    
    // Create minimal object model mock
    mockObjectModel = {
      findByStatus: vi.fn().mockImplementation(async (statuses: ObjectStatus[]) => {
        return Array.from(objectStore.values())
          .filter(obj => statuses.includes(obj.status as ObjectStatus))
          .map(obj => ({ id: obj.id, source_uri: obj.sourceUri }));
      }),
      transitionStatus: vi.fn().mockImplementation(async (id: string, from: ObjectStatus, to: ObjectStatus) => {
        const obj = objectStore.get(id);
        if (obj && obj.status === from) {
          obj.status = to;
          return true;
        }
        return false;
      }),
      updateStatus: vi.fn().mockImplementation(async (id: string, status: ObjectStatus) => {
        const obj = objectStore.get(id);
        if (obj) {
          obj.status = status;
        }
      }),
      getById: vi.fn().mockImplementation(async (id: string) => {
        return objectStore.get(id) || null;
      })
    };
    
    // Create minimal chunk model mock
    mockChunkSqlModel = {
      addChunksBulk: vi.fn().mockImplementation(async (chunks) => {
        chunkStore.push(...chunks.map((chunk, i) => ({
          ...chunk,
          id: `chunk-${chunkStore.length + i + 1}`
        })));
      }),
      listByObjectId: vi.fn().mockImplementation(async (objectId: string) => {
        return chunkStore.filter(chunk => chunk.objectId === objectId);
      })
    };
    
    // Create minimal embedding model mock
    mockEmbeddingSqlModel = {
      addEmbeddings: vi.fn().mockImplementation(async (embeddings) => {
        embeddingStore.push(...embeddings);
      }),
      addEmbeddingRecord: vi.fn().mockImplementation(async (chunkId: string, vectorId: string) => {
        embeddingStore.push({ chunkId, vectorId });
      })
    };
    
    // Create minimal ingestion job model mock
    mockIngestionJobModel = {
      findJobAwaitingChunking: vi.fn().mockResolvedValue({
        id: 'job-id',
        object_id: 'test-object',
        chunking_status: 'pending'
      }),
      updateChunkingStatus: vi.fn()
    };
    
    // Create mock agent with chunkText method
    const mockChunkText = vi.fn().mockResolvedValue([
      { 
        chunkIdx: 0, 
        content: 'First chunk content', 
        summary: 'First summary',
        tags: ['tag1', 'tag2'],
        propositions: ['First proposition'],
      },
      { 
        chunkIdx: 1, 
        content: 'Second chunk content',
        summary: 'Second summary',
        tags: ['tag3', 'tag4'],
        propositions: ['Second proposition', 'Third proposition'],
      }
    ] as ChunkLLMResult[]);
    
    mockAgent = { chunkText: mockChunkText };
    
    // Create service instance
    chunkingService = new ChunkingService(
      mockDb as Database.Database,
      mockVectorStore,
      10, // intervalMs
      mockAgent,
      mockObjectModel,
      mockChunkSqlModel,
      mockEmbeddingSqlModel,
      mockIngestionJobModel
    );
  });

  afterEach(() => {
    chunkingService?.stop();
    vi.clearAllMocks();
  });

  it('processes a parsed object through to embedded status', async () => {
    // Setup test object
    const testObject = createTestObject({
      id: 'test-1',
      status: 'parsed',
      content: 'This is test content that should be chunked.',
      mediaType: 'webpage'
    });
    objectStore.set(testObject.id, testObject);

    // Run one tick
    const tickMethod = (chunkingService as any).tick.bind(chunkingService);
    await tickMethod();

    // Verify operations
    expect(mockObjectModel.findByStatus).toHaveBeenCalledWith(['parsed']);
    expect(mockObjectModel.updateStatus).toHaveBeenCalledWith('test-1', 'embedding');
    expect(mockAgent.chunkText).toHaveBeenCalled();
    expect(mockChunkSqlModel.addChunksBulk).toHaveBeenCalled();
    expect(mockVectorStore.addDocuments).toHaveBeenCalled();
    
    // Check that chunks were created
    expect(chunkStore).toHaveLength(2);
    expect(chunkStore[0].objectId).toBe('test-1');
  });

  it('marks object as embedding_failed when content is missing', async () => {
    // Setup object with no content
    const testObject = createTestObject({
      id: 'error-id',
      status: 'parsed',
      content: null,
      mediaType: 'webpage'
    });
    objectStore.set(testObject.id, testObject);

    // Run one tick
    const tickMethod = (chunkingService as any).tick.bind(chunkingService);
    await tickMethod();

    // Should have attempted to update status
    expect(mockObjectModel.updateStatus).toHaveBeenCalledWith('error-id', 'embedding');
  });

  it('handles LLM errors gracefully', async () => {
    // Setup test object
    const testObject = createTestObject({
      id: 'llm-error',
      status: 'parsed',
      content: 'Content that will trigger LLM error',
      mediaType: 'webpage'
    });
    objectStore.set(testObject.id, testObject);
    
    // Make agent throw error
    mockAgent.chunkText.mockRejectedValueOnce(new Error('LLM API error'));
    
    // Run one tick
    const tickMethod = (chunkingService as any).tick.bind(chunkingService);
    await tickMethod();
    
    // Should have attempted to process
    expect(mockObjectModel.updateStatus).toHaveBeenCalledWith('llm-error', 'embedding');
    expect(mockAgent.chunkText).toHaveBeenCalled();
    
    // Should not have created chunks due to error
    expect(mockChunkSqlModel.addChunksBulk).not.toHaveBeenCalled();
  });

  it('runs in polling mode', async () => {
    // Setup test object
    const testObject = createTestObject({
      id: 'polling-test',
      status: 'parsed',
      content: 'Content for polling test',
      mediaType: 'webpage'
    });
    objectStore.set(testObject.id, testObject);

    // Start service
    chunkingService.start();
    
    // Advance time by one interval
    await vi.advanceTimersByTimeAsync(11);
    
    // Stop service
    chunkingService.stop();

    // Verify processing occurred
    expect(mockObjectModel.findByStatus).toHaveBeenCalled();
    expect(mockAgent.chunkText).toHaveBeenCalled();
    expect(chunkStore).toHaveLength(2);
  });
  
  it('skips processing when no parsed objects exist', async () => {
    // No objects in store
    
    // Run one tick
    const tickMethod = (chunkingService as any).tick.bind(chunkingService);
    await tickMethod();
    
    // Should only check for objects
    expect(mockObjectModel.findByStatus).toHaveBeenCalledWith(['parsed']);
    expect(mockAgent.chunkText).not.toHaveBeenCalled();
    expect(mockChunkSqlModel.addChunksBulk).not.toHaveBeenCalled();
  });
});