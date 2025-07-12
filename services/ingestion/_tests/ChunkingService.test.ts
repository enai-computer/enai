import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChunkingService } from '../ChunkingService';
import { setupTestDb } from '../../../test-utils/db';
import { ObjectModelCore } from '../../../models/ObjectModelCore';
import { ChunkModel } from '../../../models/ChunkModel';
import { EmbeddingModel } from '../../../models/EmbeddingModel';
import { IngestionJobModel } from '../../../models/IngestionJobModel';
import type { JeffersObject } from '../../../shared/types';
import type Database from 'better-sqlite3';

// Mock only external dependencies
vi.mock('../IngestionAIService');
import { IngestionAiService } from '../IngestionAIService';

describe('ChunkingService', () => {
  let db: Database.Database;
  let service: ChunkingService;
  let objectModel: ObjectModelCore;
  let mockAiService: any;
  let mockVectorStore: any;

  beforeEach(() => {
    // Use real in-memory database
    db = setupTestDb();
    
    // Use real models
    objectModel = new ObjectModelCore(db);
    const chunkModel = new ChunkModel(db);
    const embeddingModel = new EmbeddingModel(db);
    const ingestionJobModel = new IngestionJobModel(db);
    
    // Mock only external services
    mockAiService = {
      chunkText: vi.fn().mockResolvedValue([
        { 
          chunkIdx: 0, 
          content: 'First chunk', 
          summary: 'Summary 1',
          tags: ['tag1'],
          propositions: ['prop1'],
        },
        { 
          chunkIdx: 1, 
          content: 'Second chunk',
          summary: 'Summary 2',
          tags: ['tag2'],
          propositions: ['prop2'],
        }
      ])
    };
    
    mockVectorStore = {
      addDocumentsWithText: vi.fn().mockResolvedValue(['vec-1', 'vec-2']),
      deleteDocumentsByIds: vi.fn()
    };
    
    service = new ChunkingService({
      db,
      vectorStore: mockVectorStore,
      ingestionAiService: mockAiService,
      objectModelCore: objectModel,
      chunkModel,
      embeddingModel,
      ingestionJobModel
    });
  });

  afterEach(() => {
    service?.cleanup();
    db?.close();
    vi.clearAllMocks();
  });

  describe('processObject', () => {
    it('should chunk and embed parsed objects', async () => {
      // Arrange
      const object = await objectModel.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com',
        title: 'Test Page',
        status: 'parsed',
        cleanedText: 'Test content to be chunked'
      });
      
      // Act
      await service['processObject'](object);
      
      // Assert
      expect(mockAiService.chunkText).toHaveBeenCalledWith('Test content to be chunked');
      expect(mockVectorStore.addDocumentsWithText).toHaveBeenCalled();
      
      const updated = await objectModel.getById(object.id);
      expect(updated?.status).toBe('embedded');
    });

    it('should fail when content is missing', async () => {
      // Arrange
      const object = await objectModel.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com',
        title: 'Empty Page',
        status: 'parsed',
        cleanedText: null
      });
      
      // Act
      await service['processObject'](object);
      
      // Assert
      expect(mockAiService.chunkText).not.toHaveBeenCalled();
      const updated = await objectModel.getById(object.id);
      expect(updated?.status).toBe('embedding_failed');
    });

    it('should handle AI service errors', async () => {
      // Arrange
      const object = await objectModel.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com',
        title: 'Error Page',
        status: 'parsed',
        cleanedText: 'Content'
      });
      mockAiService.chunkText.mockRejectedValueOnce(new Error('AI error'));
      
      // Act
      await service['processObject'](object);
      
      // Assert
      const updated = await objectModel.getById(object.id);
      expect(updated?.status).toBe('embedding_failed');
      expect(updated?.errorInfo).toContain('AI error');
    });
  });

  describe('tick', () => {
    it('should process multiple parsed objects', async () => {
      // Arrange
      await objectModel.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com/1',
        title: 'Page 1',
        status: 'parsed',
        cleanedText: 'Content 1'
      });
      await objectModel.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com/2',
        title: 'Page 2',
        status: 'parsed',
        cleanedText: 'Content 2'
      });
      
      // Act
      await service['tick']();
      
      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Assert
      expect(mockAiService.chunkText).toHaveBeenCalledTimes(2);
      const objects = await objectModel.findByStatus(['embedded']);
      expect(objects).toHaveLength(2);
    });

    it('should skip when no parsed objects exist', async () => {
      // Act
      await service['tick']();
      
      // Assert
      expect(mockAiService.chunkText).not.toHaveBeenCalled();
    });
  });
});