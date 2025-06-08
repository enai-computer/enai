import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, MockedFunction } from 'vitest';
import { ChromaVectorModel } from '../ChromaVectorModel';
import { Document } from '@langchain/core/documents';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import * as llmModule from '../../utils/llm';

// Mock dependencies
vi.mock('@langchain/community/vectorstores/chroma');
vi.mock('../../utils/llm');
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

describe('ChromaVectorModel Unit Tests', () => {
  let chromaVectorModel: ChromaVectorModel;
  let mockChromaInstance: any;
  let mockCollection: any;
  let mockEmbeddings: any;
  
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    
    // Reset environment variables
    process.env.CHROMA_URL = 'http://localhost:8000';
    
    // Setup mock embeddings
    mockEmbeddings = {
      embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]])
    };
    
    // Setup mock collection
    mockCollection = {
      peek: vi.fn().mockResolvedValue({ documents: [], ids: [] })
    };
    
    // Setup mock Chroma instance
    mockChromaInstance = {
      collection: mockCollection,
      addDocuments: vi.fn().mockResolvedValue(['id1', 'id2']),
      similaritySearchWithScore: vi.fn().mockResolvedValue([]),
      similaritySearchVectorWithScore: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      asRetriever: vi.fn().mockReturnValue({ type: 'retriever' })
    };
    
    // Mock Chroma constructor
    (Chroma as unknown as MockedFunction<typeof Chroma>).mockImplementation(() => mockChromaInstance);
    
    // Mock createEmbeddingModel
    (llmModule.createEmbeddingModel as MockedFunction<typeof llmModule.createEmbeddingModel>).mockReturnValue(mockEmbeddings);
    
    // Create a new instance for each test
    chromaVectorModel = new ChromaVectorModel();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully with valid configuration', async () => {
      await chromaVectorModel.initialize();
      
      expect(chromaVectorModel.isReady()).toBe(true);
      expect(llmModule.createEmbeddingModel).toHaveBeenCalledWith('text-embedding-3-small');
      expect(Chroma).toHaveBeenCalledWith(
        mockEmbeddings,
        {
          collectionName: 'jeffers_embeddings',
          url: 'http://localhost:8000',
          collectionMetadata: { embedding_model_name: 'text-embedding-3-small' }
        }
      );
      expect(mockCollection.peek).toHaveBeenCalledWith({ limit: 1 });
    });

    it('should throw error when CHROMA_URL is not set', async () => {
      delete process.env.CHROMA_URL;
      
      await expect(chromaVectorModel.initialize()).rejects.toThrow('CHROMA_URL environment variable is not set.');
      expect(chromaVectorModel.isReady()).toBe(false);
    });

    it('should throw error when Chroma connection fails', async () => {
      const connectionError = new Error('Connection refused');
      mockCollection.peek.mockRejectedValueOnce(connectionError);
      
      await expect(chromaVectorModel.initialize()).rejects.toThrow(/Failed to initialize Chroma vector store/);
      expect(chromaVectorModel.isReady()).toBe(false);
    });

    it('should return early if already initialized', async () => {
      await chromaVectorModel.initialize();
      
      // Clear mocks
      vi.clearAllMocks();
      
      // Call initialize again
      await chromaVectorModel.initialize();
      
      // Should not create new instances
      expect(llmModule.createEmbeddingModel).not.toHaveBeenCalled();
      expect(Chroma).not.toHaveBeenCalled();
    });

    it('should throw stored error on subsequent initialization attempts after failure', async () => {
      const connectionError = new Error('Connection refused');
      mockCollection.peek.mockRejectedValueOnce(connectionError);
      
      // First attempt fails
      await expect(chromaVectorModel.initialize()).rejects.toThrow(/Failed to initialize Chroma vector store/);
      
      // Second attempt should throw the stored error immediately
      await expect(chromaVectorModel.initialize()).rejects.toThrow(/Failed to initialize Chroma vector store/);
      
      // Should not try to connect again
      expect(mockCollection.peek).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent initialization calls', async () => {
      // Make peek slower to ensure concurrent calls
      mockCollection.peek.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ documents: [], ids: [] }), 100))
      );
      
      // Call initialize multiple times concurrently
      const promises = [
        chromaVectorModel.initialize(),
        chromaVectorModel.initialize(),
        chromaVectorModel.initialize()
      ];
      
      await Promise.all(promises);
      
      // Should only initialize once
      expect(llmModule.createEmbeddingModel).toHaveBeenCalledTimes(1);
      expect(Chroma).toHaveBeenCalledTimes(1);
      expect(mockCollection.peek).toHaveBeenCalledTimes(1);
    });
  });

  describe('addDocuments', () => {
    beforeEach(async () => {
      await chromaVectorModel.initialize();
    });

    it('should add documents successfully', async () => {
      const documents = [
        new Document({ pageContent: 'Test content 1', metadata: { source: 'test1' } }),
        new Document({ pageContent: 'Test content 2', metadata: { source: 'test2' } })
      ];
      
      const ids = await chromaVectorModel.addDocuments(documents);
      
      expect(ids).toEqual(['id1', 'id2']);
      expect(mockChromaInstance.addDocuments).toHaveBeenCalledWith(documents, undefined);
    });

    it('should add documents with custom IDs', async () => {
      const documents = [
        new Document({ pageContent: 'Test content 1', metadata: { source: 'test1' } }),
        new Document({ pageContent: 'Test content 2', metadata: { source: 'test2' } })
      ];
      const customIds = ['custom-id-1', 'custom-id-2'];
      
      mockChromaInstance.addDocuments.mockResolvedValueOnce(customIds);
      
      const ids = await chromaVectorModel.addDocuments(documents, customIds);
      
      expect(ids).toEqual(customIds);
      expect(mockChromaInstance.addDocuments).toHaveBeenCalledWith(documents, { ids: customIds });
    });

    it('should return empty array when no documents provided', async () => {
      const ids = await chromaVectorModel.addDocuments([]);
      
      expect(ids).toEqual([]);
      expect(mockChromaInstance.addDocuments).not.toHaveBeenCalled();
    });

    it('should throw error when document count does not match ID count', async () => {
      const documents = [
        new Document({ pageContent: 'Test content 1', metadata: { source: 'test1' } }),
        new Document({ pageContent: 'Test content 2', metadata: { source: 'test2' } })
      ];
      const wrongIds = ['id1']; // Only one ID for two documents
      
      await expect(chromaVectorModel.addDocuments(documents, wrongIds))
        .rejects.toThrow('Number of documents and documentIds must match.');
    });

    it('should handle errors from Chroma', async () => {
      const documents = [new Document({ pageContent: 'Test', metadata: {} })];
      const chromaError = new Error('Chroma error');
      mockChromaInstance.addDocuments.mockRejectedValueOnce(chromaError);
      
      await expect(chromaVectorModel.addDocuments(documents)).rejects.toThrow('Chroma error');
    });

    it('should initialize store if not ready', async () => {
      // Create new instance that hasn't been initialized
      const newModel = new ChromaVectorModel();
      const documents = [new Document({ pageContent: 'Test', metadata: {} })];
      
      await newModel.addDocuments(documents);
      
      expect(llmModule.createEmbeddingModel).toHaveBeenCalled();
      expect(Chroma).toHaveBeenCalled();
      expect(mockChromaInstance.addDocuments).toHaveBeenCalled();
    });
  });

  describe('querySimilarByText', () => {
    beforeEach(async () => {
      await chromaVectorModel.initialize();
    });

    it('should query similar documents by text', async () => {
      const queryText = 'test query';
      const k = 5;
      const mockResults: [Document, number][] = [
        [new Document({ pageContent: 'Result 1', metadata: {} }), 0.9],
        [new Document({ pageContent: 'Result 2', metadata: {} }), 0.8]
      ];
      
      mockChromaInstance.similaritySearchWithScore.mockResolvedValueOnce(mockResults);
      
      const results = await chromaVectorModel.querySimilarByText(queryText, k);
      
      expect(results).toEqual(mockResults);
      expect(mockChromaInstance.similaritySearchWithScore).toHaveBeenCalledWith(queryText, k, undefined);
    });

    it('should query with filter', async () => {
      const queryText = 'test query';
      const k = 3;
      const filter = { source: 'website' };
      const mockResults: [Document, number][] = [];
      
      mockChromaInstance.similaritySearchWithScore.mockResolvedValueOnce(mockResults);
      
      const results = await chromaVectorModel.querySimilarByText(queryText, k, filter);
      
      expect(results).toEqual(mockResults);
      expect(mockChromaInstance.similaritySearchWithScore).toHaveBeenCalledWith(queryText, k, filter);
    });

    it('should handle complex filters with operators', async () => {
      const queryText = 'test';
      const k = 10;
      const filter = {
        timestamp: { $gte: 1000, $lte: 2000 },
        tags: { $in: ['tag1', 'tag2'] }
      };
      
      await chromaVectorModel.querySimilarByText(queryText, k, filter);
      
      expect(mockChromaInstance.similaritySearchWithScore).toHaveBeenCalledWith(queryText, k, filter);
    });

    it('should handle errors from Chroma', async () => {
      const chromaError = new Error('Search failed');
      mockChromaInstance.similaritySearchWithScore.mockRejectedValueOnce(chromaError);
      
      await expect(chromaVectorModel.querySimilarByText('test', 5))
        .rejects.toThrow('Search failed');
    });
  });

  describe('querySimilarByVector', () => {
    beforeEach(async () => {
      await chromaVectorModel.initialize();
    });

    it('should query similar documents by vector', async () => {
      const queryVector = [0.1, 0.2, 0.3, 0.4];
      const k = 5;
      const mockResults: [Document, number][] = [
        [new Document({ pageContent: 'Result 1', metadata: {} }), 0.95]
      ];
      
      mockChromaInstance.similaritySearchVectorWithScore.mockResolvedValueOnce(mockResults);
      
      const results = await chromaVectorModel.querySimilarByVector(queryVector, k);
      
      expect(results).toEqual(mockResults);
      expect(mockChromaInstance.similaritySearchVectorWithScore).toHaveBeenCalledWith(queryVector, k, undefined);
    });

    it('should query by vector with filter', async () => {
      const queryVector = [0.5, 0.6, 0.7];
      const k = 3;
      const filter = { type: 'document', status: 'active' };
      
      await chromaVectorModel.querySimilarByVector(queryVector, k, filter);
      
      expect(mockChromaInstance.similaritySearchVectorWithScore).toHaveBeenCalledWith(queryVector, k, filter);
    });

    it('should handle errors from Chroma', async () => {
      const chromaError = new Error('Vector search failed');
      mockChromaInstance.similaritySearchVectorWithScore.mockRejectedValueOnce(chromaError);
      
      await expect(chromaVectorModel.querySimilarByVector([0.1, 0.2], 5))
        .rejects.toThrow('Vector search failed');
    });
  });

  describe('deleteDocumentsByIds', () => {
    beforeEach(async () => {
      await chromaVectorModel.initialize();
    });

    it('should delete documents by IDs', async () => {
      const documentIds = ['id1', 'id2', 'id3'];
      
      await chromaVectorModel.deleteDocumentsByIds(documentIds);
      
      expect(mockChromaInstance.delete).toHaveBeenCalledWith({ ids: documentIds });
    });

    it('should handle empty array', async () => {
      await chromaVectorModel.deleteDocumentsByIds([]);
      
      expect(mockChromaInstance.delete).not.toHaveBeenCalled();
    });

    it('should handle errors from Chroma', async () => {
      const chromaError = new Error('Delete operation failed');
      mockChromaInstance.delete.mockRejectedValueOnce(chromaError);
      
      await expect(chromaVectorModel.deleteDocumentsByIds(['id1']))
        .rejects.toThrow('Delete operation failed');
    });

    it('should throw all errors including document not found', async () => {
      const notFoundError = new Error('Document not found');
      mockChromaInstance.delete.mockRejectedValueOnce(notFoundError);
      
      await expect(chromaVectorModel.deleteDocumentsByIds(['id1']))
        .rejects.toThrow('Document not found');
    });
  });

  describe('getRetriever', () => {
    beforeEach(async () => {
      await chromaVectorModel.initialize();
    });

    it('should get retriever with default parameters', async () => {
      const retriever = await chromaVectorModel.getRetriever();
      
      expect(retriever).toEqual({ type: 'retriever' });
      expect(mockChromaInstance.asRetriever).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should get retriever with k parameter', async () => {
      const k = 10;
      
      await chromaVectorModel.getRetriever(k);
      
      expect(mockChromaInstance.asRetriever).toHaveBeenCalledWith(k, undefined);
    });

    it('should get retriever with filter', async () => {
      const k = 5;
      const filter = { category: 'tech' };
      
      await chromaVectorModel.getRetriever(k, filter);
      
      expect(mockChromaInstance.asRetriever).toHaveBeenCalledWith(k, filter);
    });
  });

  describe('isReady', () => {
    it('should return false when not initialized', () => {
      expect(chromaVectorModel.isReady()).toBe(false);
    });

    it('should return true when properly initialized', async () => {
      await chromaVectorModel.initialize();
      expect(chromaVectorModel.isReady()).toBe(true);
    });

    it('should return false after initialization error', async () => {
      mockCollection.peek.mockRejectedValueOnce(new Error('Init failed'));
      
      try {
        await chromaVectorModel.initialize();
      } catch (e) {
        // Expected to throw
      }
      
      expect(chromaVectorModel.isReady()).toBe(false);
    });
  });

  describe('ensureVectorStore', () => {
    it('should auto-initialize if not ready', async () => {
      // Access a method without explicit initialization
      const documents = [new Document({ pageContent: 'Test', metadata: {} })];
      
      await chromaVectorModel.addDocuments(documents);
      
      // Should have auto-initialized
      expect(llmModule.createEmbeddingModel).toHaveBeenCalled();
      expect(Chroma).toHaveBeenCalled();
    });

    it('should throw initialization error if previously failed', async () => {
      // Make initialization fail
      delete process.env.CHROMA_URL;
      
      try {
        await chromaVectorModel.initialize();
      } catch (e) {
        // Expected to fail
      }
      
      // Try to use a method
      await expect(chromaVectorModel.querySimilarByText('test', 5))
        .rejects.toThrow('CHROMA_URL environment variable is not set.');
    });
  });
});

describe('ChromaVectorModel Integration Tests', () => {
  let chromaVectorModel: ChromaVectorModel;
  
  // Only run integration tests if CHROMA_URL is set and includes "test"
  const shouldRunIntegrationTests = process.env.CHROMA_URL?.includes('test') && process.env.RUN_INTEGRATION_TESTS === 'true';
  
  if (!shouldRunIntegrationTests) {
    it.skip('Integration tests skipped - set RUN_INTEGRATION_TESTS=true and ensure CHROMA_URL points to test instance', () => {});
    return;
  }

  beforeAll(async () => {
    chromaVectorModel = new ChromaVectorModel();
    await chromaVectorModel.initialize();
  });

  beforeEach(async () => {
    // Clean up test data between tests
    // This assumes we have a way to clean the test collection
  });

  it('should perform end-to-end document operations', async () => {
    // Add documents
    const documents = [
      new Document({ 
        pageContent: 'The quick brown fox jumps over the lazy dog', 
        metadata: { source: 'test1', type: 'sentence' } 
      }),
      new Document({ 
        pageContent: 'Machine learning is a subset of artificial intelligence', 
        metadata: { source: 'test2', type: 'definition' } 
      })
    ];
    
    const ids = await chromaVectorModel.addDocuments(documents);
    expect(ids).toHaveLength(2);
    
    // Query by text
    const results = await chromaVectorModel.querySimilarByText('artificial intelligence', 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0][0].pageContent).toContain('intelligence');
    
    // Query with filter
    const filteredResults = await chromaVectorModel.querySimilarByText(
      'test', 
      10, 
      { type: 'sentence' }
    );
    
    // Delete documents
    await chromaVectorModel.deleteDocumentsByIds(ids);
    
    // Verify deletion
    const afterDelete = await chromaVectorModel.querySimilarByText('artificial intelligence', 10);
    const remainingIds = afterDelete.map(([doc]) => doc.metadata.id).filter(id => ids.includes(id));
    expect(remainingIds).toHaveLength(0);
  });
});