import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LanceVectorModel } from '../LanceVectorModel';
import { Document } from '@langchain/core/documents';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-lance')
  }
}));

// Mock the logger
vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock OpenAI embeddings
vi.mock('../../utils/llm', () => ({
  createEmbeddingModel: vi.fn(() => ({
    embedDocuments: vi.fn(async (texts: string[]) => {
      // Return mock embeddings - 1536 dimensional vectors
      return texts.map(() => Array(1536).fill(0).map((_, i) => Math.random()));
    }),
    embedQuery: vi.fn(async (text: string) => {
      // Return a mock query embedding
      return Array(1536).fill(0).map((_, i) => Math.random());
    })
  }))
}));

describe('LanceVectorModel', () => {
  let model: LanceVectorModel;
  const testDbPath = '/tmp/test-lance/data/lancedb';

  beforeEach(async () => {
    // Clean up test directory
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { recursive: true, force: true });
    }
    
    model = new LanceVectorModel();
  });

  afterEach(async () => {
    // Clean up
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await expect(model.initialize()).resolves.not.toThrow();
    });

    it('should handle multiple initialization calls gracefully', async () => {
      await model.initialize();
      await expect(model.initialize()).resolves.not.toThrow();
    });

    it('should create the database directory if it does not exist', async () => {
      await model.initialize();
      expect(fs.existsSync(testDbPath)).toBe(true);
    });
  });

  describe('addDocuments', () => {
    beforeEach(async () => {
      await model.initialize();
    });

    it('should add documents and return vector IDs', async () => {
      const documents = [
        new Document({ 
          pageContent: 'Test document 1',
          metadata: { source: 'test1' }
        }),
        new Document({ 
          pageContent: 'Test document 2',
          metadata: { source: 'test2' }
        })
      ];

      const ids = await model.addDocuments(documents);
      
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBeTruthy();
      expect(ids[1]).toBeTruthy();
    });

    it('should use provided document IDs', async () => {
      const documents = [
        new Document({ pageContent: 'Test document' })
      ];
      const providedIds = ['custom-id-123'];

      const ids = await model.addDocuments(documents, providedIds);
      
      expect(ids).toEqual(providedIds);
    });

    it('should handle empty documents array', async () => {
      const ids = await model.addDocuments([]);
      expect(ids).toEqual([]);
    });

    it('should throw error if not initialized', async () => {
      const uninitializedModel = new LanceVectorModel();
      const documents = [new Document({ pageContent: 'Test' })];
      
      await expect(uninitializedModel.addDocuments(documents))
        .rejects.toThrow('LanceVectorModel not initialized');
    });
  });

  describe('querySimilarByText', () => {
    beforeEach(async () => {
      await model.initialize();
      
      // Add some test documents
      const documents = [
        new Document({ 
          pageContent: 'The quick brown fox jumps over the lazy dog',
          metadata: { objectId: '1', topic: 'animals' }
        }),
        new Document({ 
          pageContent: 'Machine learning is a subset of artificial intelligence',
          metadata: { objectId: '2', topic: 'technology' }
        }),
        new Document({ 
          pageContent: 'The weather is sunny and warm today',
          metadata: { objectId: '3', topic: 'weather' }
        })
      ];
      
      await model.addDocuments(documents, ['doc1', 'doc2', 'doc3']);
    });

    it('should return similar documents with scores', async () => {
      const results = await model.querySimilarByText('artificial intelligence', 2);
      
      expect(results).toHaveLength(2);
      expect(results[0][0]).toBeInstanceOf(Document);
      expect(results[0][1]).toBeGreaterThanOrEqual(0);
      expect(results[0][1]).toBeLessThanOrEqual(1);
    });

    it('should respect the k parameter', async () => {
      const results = await model.querySimilarByText('test query', 1);
      expect(results).toHaveLength(1);
    });

    it('should apply filters', async () => {
      const results = await model.querySimilarByText('test query', 10, { objectId: '2' });
      
      // Should only return documents matching the filter
      for (const [doc, _] of results) {
        expect(doc.metadata.objectId).toBe('2');
      }
    });
  });

  describe('querySimilarByVector', () => {
    beforeEach(async () => {
      await model.initialize();
      
      // Add a test document
      const documents = [
        new Document({ 
          pageContent: 'Test content',
          metadata: { id: 'test-1' }
        })
      ];
      
      await model.addDocuments(documents);
    });

    it('should return similar documents for a vector query', async () => {
      const queryVector = Array(1536).fill(0).map(() => Math.random());
      const results = await model.querySimilarByVector(queryVector, 1);
      
      expect(results).toHaveLength(1);
      expect(results[0][0]).toBeInstanceOf(Document);
      expect(results[0][1]).toBeGreaterThanOrEqual(0);
      expect(results[0][1]).toBeLessThanOrEqual(1);
    });
  });

  describe('deleteDocumentsByIds', () => {
    beforeEach(async () => {
      await model.initialize();
    });

    it('should delete documents by IDs', async () => {
      // Add documents
      const documents = [
        new Document({ pageContent: 'Document 1' }),
        new Document({ pageContent: 'Document 2' }),
        new Document({ pageContent: 'Document 3' })
      ];
      const ids = ['id1', 'id2', 'id3'];
      await model.addDocuments(documents, ids);

      // Delete some documents
      await model.deleteDocumentsByIds(['id1', 'id3']);

      // Query to verify deletion
      const results = await model.querySimilarByText('Document', 10);
      
      // Should only find one document (id2)
      expect(results).toHaveLength(1);
      expect(results[0][0].pageContent).toBe('Document 2');
    });

    it('should handle empty array gracefully', async () => {
      await expect(model.deleteDocumentsByIds([])).resolves.not.toThrow();
    });
  });

  describe('getRetriever', () => {
    beforeEach(async () => {
      await model.initialize();
      
      // Add test documents
      const documents = [
        new Document({ pageContent: 'Retriever test document 1' }),
        new Document({ pageContent: 'Retriever test document 2' })
      ];
      await model.addDocuments(documents);
    });

    it('should return a working retriever', async () => {
      const retriever = await model.getRetriever(2);
      
      expect(retriever).toBeDefined();
      expect(retriever).toHaveProperty('invoke');
    });

    it('should create retriever with custom k and filter', async () => {
      const retriever = await model.getRetriever(5, { category: 'test' });
      
      expect(retriever).toBeDefined();
    });
  });

  describe('similaritySearch', () => {
    beforeEach(async () => {
      await model.initialize();
      
      // Add test documents
      const documents = [
        new Document({ 
          pageContent: 'LangChain compatibility test',
          metadata: { id: '1' }
        })
      ];
      await model.addDocuments(documents);
    });

    it('should return documents without scores', async () => {
      const results = await model.similaritySearch('test', 1);
      
      expect(results).toHaveLength(1);
      expect(results[0]).toBeInstanceOf(Document);
      expect(results[0].pageContent).toBe('LangChain compatibility test');
    });
  });
});