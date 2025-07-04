import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ChunkingService } from '../ingestion/ChunkingService';
import { IngestionAiService } from '../ingestion/IngestionAIService';
import { ObjectModel } from '../../models/ObjectModel';
import { ChunkModel } from '../../models/ChunkModel';
import { EmbeddingModel } from '../../models/EmbeddingModel';
import { IngestionJobModel } from '../../models/IngestionJobModel';
import { runMigrations } from '../../models/runMigrations';

describe('ChunkingService Transaction Handling', () => {
  let db: Database.Database;
  let chunkingService: ChunkingService;
  let mockVectorStore: any;
  let mockIngestionAi: any;
  
  beforeEach(async () => {
    // Create in-memory database
    db = new Database(':memory:');
    await runMigrations(db);
    
    // Create real model instances
    const objectModel = new ObjectModel(db);
    const chunkModel = new ChunkModel(db);
    const embeddingModel = new EmbeddingModel(db);
    const ingestionJobModel = new IngestionJobModel(db);
    
    // Mock external services
    mockVectorStore = {
      addDocuments: vi.fn(),
      deleteDocumentsByIds: vi.fn(),
    };
    
    mockIngestionAi = {
      chunkText: vi.fn(),
    };
    
    // Create service
    chunkingService = new ChunkingService({
      db,
      ingestionAiService: mockIngestionAi,
      objectModel,
      chunkModel,
      embeddingModel,
      ingestionJobModel,
      vectorStore: mockVectorStore,
    });
  });
  
  afterEach(() => {
    db.close();
  });

  describe('Saga failure scenarios', () => {
    it('should rollback chunks when embedding creation fails', async () => {
      // Setup: Create an object
      const objectModel = new ObjectModel(db);
      const object = await objectModel.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com',
        title: 'Test Page',
        status: 'embedding',
        cleanedText: 'Test content for chunking',
      });
      
      // Mock AI to return chunks
      mockIngestionAi.chunkText.mockResolvedValue([
        { content: 'Chunk 1', chunkIdx: 0 },
        { content: 'Chunk 2', chunkIdx: 1 },
      ]);
      
      // Mock vector store to fail
      mockVectorStore.addDocuments.mockRejectedValue(new Error('Vector store error'));
      
      // Process object - should fail
      await expect(chunkingService['processObject'](object)).rejects.toThrow('Vector store error');
      
      // Verify no chunks were left in database
      const chunkModel = new ChunkModel(db);
      const chunks = await chunkModel.listByObjectId(object.id);
      expect(chunks).toHaveLength(0);
      
      // Verify no embeddings were created
      const embeddingModel = new EmbeddingModel(db);
      const stmt = db.prepare('SELECT COUNT(*) as count FROM embeddings');
      const result = stmt.get() as { count: number };
      expect(result.count).toBe(0);
    });

    it('should rollback chunks and embeddings when linking fails', async () => {
      // Setup: Create an object
      const objectModel = new ObjectModel(db);
      const object = await objectModel.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com',
        title: 'Test Page',
        status: 'embedding',
        cleanedText: 'Test content for chunking',
      });
      
      // Mock AI to return chunks
      mockIngestionAi.chunkText.mockResolvedValue([
        { content: 'Chunk 1', chunkIdx: 0 },
        { content: 'Chunk 2', chunkIdx: 1 },
      ]);
      
      // Mock vector store to return mismatched number of IDs
      mockVectorStore.addDocuments.mockResolvedValue(['vec1']); // Only 1 ID for 2 chunks
      
      // Process object - should fail during linking
      await expect(chunkingService['processObject'](object)).rejects.toThrow('Vector ID count mismatch');
      
      // Verify chunks were rolled back
      const chunkModel = new ChunkModel(db);
      const chunks = await chunkModel.listByObjectId(object.id);
      expect(chunks).toHaveLength(0);
      
      // Verify vector store cleanup was attempted
      expect(mockVectorStore.deleteDocumentsByIds).toHaveBeenCalledWith(['vec1']);
    });

    it('should handle partial embedding link failures gracefully', async () => {
      // Setup: Create an object
      const objectModel = new ObjectModel(db);
      const object = await objectModel.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com',
        title: 'Test Page',
        status: 'embedding',
        cleanedText: 'Test content for chunking',
      });
      
      // Mock AI to return chunks
      mockIngestionAi.chunkText.mockResolvedValue([
        { content: 'Chunk 1', chunkIdx: 0 },
        { content: 'Chunk 2', chunkIdx: 1 },
      ]);
      
      // Mock vector store to succeed
      mockVectorStore.addDocuments.mockResolvedValue(['vec1', 'vec2']);
      
      // Create a spy to make embedding creation fail on second call
      const embeddingModel = new EmbeddingModel(db);
      const addEmbeddingSpy = vi.spyOn(embeddingModel, 'addEmbeddingRecord');
      let callCount = 0;
      addEmbeddingSpy.mockImplementation((data) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Embedding link failed');
        }
        // Call the original implementation
        return addEmbeddingSpy.getMockImplementation()!.call(embeddingModel, data);
      });
      
      // Update service to use spied model
      (chunkingService as any).deps.embeddingModel = embeddingModel;
      
      // Process should fail
      await expect(chunkingService['processObject'](object)).rejects.toThrow();
      
      // Verify rollback occurred
      const chunkModel = new ChunkModel(db);
      const chunks = await chunkModel.listByObjectId(object.id);
      expect(chunks).toHaveLength(0);
      
      // Verify vector cleanup was attempted
      expect(mockVectorStore.deleteDocumentsByIds).toHaveBeenCalled();
    });
  });

  describe('PDF processing saga', () => {
    it('should handle PDF embedding failures gracefully', async () => {
      // Setup: Create a PDF object with existing chunk
      const objectModel = new ObjectModel(db);
      const chunkModel = new ChunkModel(db);
      
      const pdfObject = await objectModel.create({
        objectType: 'pdf',
        sourceUri: 'file:///test.pdf',
        title: 'Test PDF',
        status: 'embedding',
        cleanedText: 'PDF summary content',
      });
      
      // Create a chunk for the PDF
      await chunkModel.addChunk({
        objectId: pdfObject.id,
        chunkIdx: 0,
        content: 'PDF chunk content',
      });
      
      // Mock vector store to fail
      mockVectorStore.addDocuments.mockRejectedValue(new Error('Embedding failed'));
      
      // Process should fail
      await expect(chunkingService['processPdfObject'](pdfObject)).rejects.toThrow('Embedding failed');
      
      // Verify chunk still exists (PDFs don't delete chunks on failure)
      const chunks = await chunkModel.listByObjectId(pdfObject.id);
      expect(chunks).toHaveLength(1);
      
      // Verify no embeddings were created
      const stmt = db.prepare('SELECT COUNT(*) as count FROM embeddings');
      const result = stmt.get() as { count: number };
      expect(result.count).toBe(0);
    });
  });

  describe('Concurrent processing', () => {
    it('should handle multiple objects concurrently without data corruption', async () => {
      const objectModel = new ObjectModel(db);
      const jobModel = new IngestionJobModel(db);
      
      // Create multiple objects
      const objects = await Promise.all([
        objectModel.create({
          objectType: 'webpage',
          sourceUri: 'https://example1.com',
          title: 'Page 1',
          status: 'parsed',
          cleanedText: 'Content 1',
        }),
        objectModel.create({
          objectType: 'webpage',
          sourceUri: 'https://example2.com',
          title: 'Page 2',
          status: 'parsed',
          cleanedText: 'Content 2',
        }),
        objectModel.create({
          objectType: 'webpage',
          sourceUri: 'https://example3.com',
          title: 'Page 3',
          status: 'parsed',
          cleanedText: 'Content 3',
        }),
      ]);
      
      // Create jobs for each object
      for (const obj of objects) {
        await jobModel.create({
          url: obj.sourceUri!,
          notebookId: 'test-notebook',
          jobType: 'url',
          relatedObjectId: obj.id,
        });
      }
      
      // Mock AI to return chunks based on content
      mockIngestionAi.chunkText.mockImplementation((text: string) => {
        const num = text.match(/\d+/)?.[0] || '0';
        return Promise.resolve([
          { content: `Chunk A for ${num}`, chunkIdx: 0 },
          { content: `Chunk B for ${num}`, chunkIdx: 1 },
        ]);
      });
      
      // Mock vector store to succeed but with delay
      mockVectorStore.addDocuments.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve([`vec-${Date.now()}-1`, `vec-${Date.now()}-2`]);
          }, 10);
        });
      });
      
      // Process objects concurrently
      await chunkingService.tick();
      
      // Wait for processing to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify each object has correct chunks
      const chunkModel = new ChunkModel(db);
      for (let i = 0; i < objects.length; i++) {
        const chunks = await chunkModel.listByObjectId(objects[i].id);
        
        // Verify chunks belong to correct object
        for (const chunk of chunks) {
          expect(chunk.content).toContain(`${i + 1}`);
        }
      }
    });
  });
});