import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import Database from 'better-sqlite3';
import { ObjectService } from '../../services/ObjectService';
import { ObjectModel } from '../../models/ObjectModel';
import { ChunkSqlModel } from '../../models/ChunkModel';
import { EmbeddingSqlModel } from '../../models/EmbeddingModel';
import { IVectorStoreModel, LanceVectorModel } from '../../models/LanceVectorModel';
import { initDb } from '../../models/db';
import runMigrations from '../../models/runMigrations';
import { v4 as uuidv4 } from 'uuid';

// Mock the LanceVectorModel since it requires external service
vi.mock('../../models/LanceVectorModel');

describe('ObjectService', () => {
  let db: Database.Database;
  let objectService: ObjectService;
  let objectModel: ObjectModel;
  let chunkModel: ChunkSqlModel;
  let embeddingModel: EmbeddingSqlModel;
  let vectorModel: IVectorStoreModel;

  // Helper function to create test objects
  const createTestObject = async (id?: string) => {
    const uniqueId = id || uuidv4();
    const created = await objectModel.create({
      objectType: 'pdf_document',
      sourceUri: `file:///test/${uniqueId}.pdf`,
      title: `Test PDF ${uniqueId}`,
      status: 'complete',
      rawContentRef: null,
      fileHash: `hash_${uniqueId}`,
      originalFileName: `test_${uniqueId}.pdf`,
      fileSizeBytes: 1024,
    });
    // Return the actual ID that was created
    return created.id;
  };

  // Helper function to create test chunks
  const createTestChunks = (objectId: string, count: number = 3) => {
    const chunkIds: number[] = [];
    for (let i = 0; i < count; i++) {
      const chunk = chunkModel.addChunkSync({
        objectId,
        chunkIdx: i,
        content: `Test chunk ${i} for object ${objectId}`,
        summary: `Summary ${i}`,
        tagsJson: JSON.stringify(['test', 'chunk']),
        propositionsJson: null,
        tokenCount: 100,
        notebookId: null,
      });
      chunkIds.push(chunk.id);
    }
    return chunkIds;
  };

  // Helper function to create test embeddings
  const createTestEmbeddings = (chunkIds: number[]) => {
    const vectorIds: string[] = [];
    chunkIds.forEach((chunkId, index) => {
      const vectorId = `vector_${chunkId}_${index}`;
      embeddingModel.addEmbeddingRecord({
        chunkId,
        model: 'text-embedding-3-small',
        vectorId,
      });
      vectorIds.push(vectorId);
    });
    return vectorIds;
  };

  beforeEach(() => {
    // Create fresh in-memory database for each test
    db = initDb(':memory:');
    runMigrations(db);
    
    // Create real model instances
    objectModel = new ObjectModel(db);
    chunkModel = new ChunkSqlModel(db);
    embeddingModel = new EmbeddingSqlModel(db);
    
    // Create mocked LanceVectorModel
    vectorModel = new LanceVectorModel({ userDataPath: ':memory:' });
    
    // Create service instance with dependencies
    objectService = new ObjectService({
      db,
      objectModel,
      chunkModel,
      embeddingModel,
      vectorModel
    });
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe('deleteObjects', () => {
    it('should successfully delete a single object with all related data', async () => {
      // Arrange
      const objectId = await createTestObject();
      const chunkIds = createTestChunks(objectId);
      const vectorIds = createTestEmbeddings(chunkIds);
      
      // Mock ChromaDB deletion to succeed
      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act
      const result = await objectService.deleteObjects([objectId]);

      // Assert
      expect(result.successful).toEqual([objectId]);
      expect(result.failed).toEqual([]);
      expect(result.notFound).toEqual([]);
      expect(result.orphanedChunkIds).toEqual([]); // Empty array when no orphaned chunks
      expect(result.chromaDbError).toBeUndefined();
      expect(result.sqliteError).toBeUndefined();

      // Verify ChromaDB was called with correct chunk IDs
      expect(vectorModel.deleteDocumentsByIds).toHaveBeenCalledWith(
        chunkIds.map(id => id.toString())
      );

      // Verify data was actually deleted from SQLite
      const remainingObject = await objectModel.getById(objectId);
      expect(remainingObject).toBeNull();
      
      const remainingChunks = chunkModel.getChunksByObjectId(objectId);
      expect(remainingChunks).toHaveLength(0);
    });

    it('should handle multiple objects in a single batch', async () => {
      // Arrange
      const objectIds = await Promise.all([
        createTestObject(),
        createTestObject(),
        createTestObject(),
      ]);
      
      objectIds.forEach(id => {
        const chunkIds = createTestChunks(id, 2);
        createTestEmbeddings(chunkIds);
      });

      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act
      const result = await objectService.deleteObjects(objectIds);

      // Assert
      expect(result.successful).toHaveLength(3);
      expect(result.successful.sort()).toEqual(objectIds.sort());
      expect(result.failed).toEqual([]);
      expect(result.notFound).toEqual([]);
    });

    it('should handle non-existent object IDs gracefully', async () => {
      // Arrange
      const existingId = await createTestObject();
      const nonExistentIds = [uuidv4(), uuidv4()];
      const allIds = [existingId, ...nonExistentIds];

      createTestChunks(existingId);
      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act
      const result = await objectService.deleteObjects(allIds);

      // Assert
      expect(result.successful).toEqual([existingId]);
      expect(result.failed).toEqual([]);
      expect(result.notFound.sort()).toEqual(nonExistentIds.sort());
    });

    it('should continue with SQLite deletion when ChromaDB fails', async () => {
      // Arrange
      const objectId = await createTestObject();
      const chunkIds = createTestChunks(objectId);
      createTestEmbeddings(chunkIds);
      
      const chromaError = new Error('ChromaDB connection failed');
      (vectorModel.deleteDocumentsByIds as Mock).mockRejectedValue(chromaError);

      // Act
      const result = await objectService.deleteObjects([objectId]);

      // Assert
      expect(result.successful).toEqual([objectId]);
      expect(result.failed).toEqual([]);
      expect(result.notFound).toEqual([]);
      expect(result.orphanedChunkIds).toEqual(chunkIds.map(id => id.toString()));
      expect(result.chromaDbError).toBeDefined();
      expect(result.chromaDbError?.message).toBe('ChromaDB connection failed');
      expect(result.sqliteError).toBeUndefined();

      // Verify SQLite deletion still succeeded
      const remainingObject = await objectModel.getById(objectId);
      expect(remainingObject).toBeNull();
    });

    it('should handle empty array input', async () => {
      // Act
      const result = await objectService.deleteObjects([]);

      // Assert
      expect(result.successful).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(result.notFound).toEqual([]);
      expect(vectorModel.deleteDocumentsByIds).not.toHaveBeenCalled();
    });

    it('should handle large batches correctly', async () => {
      // Arrange - Create 150 objects to test batching (reduced for test speed)
      const existingIds: string[] = [];
      const nonExistentIds: string[] = [];
      
      // Create 50 objects that exist
      for (let i = 0; i < 50; i++) {
        const id = await createTestObject();
        existingIds.push(id);
      }
      
      // Generate 100 non-existent IDs
      for (let i = 0; i < 100; i++) {
        nonExistentIds.push(uuidv4());
      }
      
      const allIds = [...existingIds, ...nonExistentIds];

      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act
      const result = await objectService.deleteObjects(allIds);

      // Assert
      expect(result.successful.length).toBe(50);
      expect(result.notFound.length).toBe(100);
      expect(result.failed).toEqual([]);
    });

    it('should handle transaction rollback on SQLite error', async () => {
      // Arrange
      const objectId = await createTestObject();
      createTestChunks(objectId);
      
      // Mock a database error during deletion
      const dbError = new Error('Database locked');
      vi.spyOn(db, 'transaction').mockImplementation(() => {
        throw dbError;
      });

      // Act
      const result = await objectService.deleteObjects([objectId]);

      // Assert
      expect(result.successful).toEqual([]);
      expect(result.failed).toEqual([objectId]);
      expect(result.notFound).toEqual([]);
      expect(result.sqliteError).toBeDefined();
      expect(result.sqliteError?.message).toBe('Database locked');
      
      // Verify ChromaDB was never called
      expect(vectorModel.deleteDocumentsByIds).not.toHaveBeenCalled();
      
      // Verify object still exists (transaction rolled back)
      vi.spyOn(db, 'transaction').mockRestore();
      const remainingObject = await objectModel.getById(objectId);
      expect(remainingObject).toBeDefined();
    });

    it('should not call ChromaDB if no chunks exist', async () => {
      // Arrange - Object without chunks
      const objectId = await createTestObject();
      // Don't create any chunks
      
      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act
      const result = await objectService.deleteObjects([objectId]);

      // Assert
      expect(result.successful).toEqual([objectId]);
      expect(vectorModel.deleteDocumentsByIds).not.toHaveBeenCalled();
    });

    it('should handle mixed success/failure scenarios in batch', async () => {
      // Arrange
      const successIds = await Promise.all([
        createTestObject(),
        createTestObject(),
      ]);
      const nonExistentIds = [uuidv4(), uuidv4()];
      const allIds = [...successIds, ...nonExistentIds];

      successIds.forEach(id => createTestChunks(id));
      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act
      const result = await objectService.deleteObjects(allIds);

      // Assert
      expect(result.successful.sort()).toEqual(successIds.sort());
      expect(result.failed).toEqual([]);
      expect(result.notFound.sort()).toEqual(nonExistentIds.sort());
    });

    it('should properly track chunks across multiple objects', async () => {
      // Arrange
      const object1 = await createTestObject();
      const object2 = await createTestObject();
      const chunks1 = createTestChunks(object1, 2);
      const chunks2 = createTestChunks(object2, 3);
      const allChunkIds = [...chunks1, ...chunks2].map(id => id.toString());

      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act
      const result = await objectService.deleteObjects([object1, object2]);

      // Assert
      expect(result.successful.sort()).toEqual([object1, object2].sort());
      expect(vectorModel.deleteDocumentsByIds).toHaveBeenCalledWith(
        expect.arrayContaining(allChunkIds)
      );
      expect(vectorModel.deleteDocumentsByIds).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge cases', () => {
    it('should handle objects with no embeddings', async () => {
      // Arrange
      const objectId = await createTestObject();
      createTestChunks(objectId); // Create chunks but no embeddings
      
      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act
      const result = await objectService.deleteObjects([objectId]);

      // Assert
      expect(result.successful).toEqual([objectId]);
      expect(result.failed).toEqual([]);
      
      // Verify all data was cleaned up
      const remainingObject = await objectModel.getById(objectId);
      expect(remainingObject).toBeNull();
    });

    it('should handle duplicate IDs in input array', async () => {
      // Arrange
      const objectId = await createTestObject();
      createTestChunks(objectId);
      
      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act - Pass same ID multiple times
      const result = await objectService.deleteObjects([objectId, objectId, objectId]);

      // Assert - Should only delete once
      expect(result.successful).toEqual([objectId]);
      expect(result.failed).toEqual([]);
      expect(result.notFound).toEqual([]);
    });
  });
});