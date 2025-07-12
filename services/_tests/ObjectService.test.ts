import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import Database from 'better-sqlite3';
import { ObjectService } from '../../services/ObjectService';
import { ObjectModelCore } from '../../models/ObjectModelCore';
import { ObjectCognitiveModel } from '../../models/ObjectCognitiveModel';
import { ObjectAssociationModel } from '../../models/ObjectAssociationModel';
import { ChunkModel } from '../../models/ChunkModel';
import { EmbeddingModel } from '../../models/EmbeddingModel';
import { IVectorStoreModel } from '../../shared/types/vector.types';
import { LanceVectorModel } from '../../models/LanceVectorModel';
import { initDb } from '../../models/db';
import runMigrations from '../../models/runMigrations';
import { v4 as uuidv4 } from 'uuid';

// Mock the LanceVectorModel since it requires external service
vi.mock('../../models/LanceVectorModel', () => ({
  LanceVectorModel: vi.fn().mockImplementation(() => ({
    deleteDocumentsByIds: vi.fn()
  }))
}));

describe('ObjectService', () => {
  let db: Database.Database;
  let objectService: ObjectService;
  let objectModelCore: ObjectModelCore;
  let objectCognitive: ObjectCognitiveModel;
  let objectAssociation: ObjectAssociationModel;
  let chunkModel: ChunkModel;
  let embeddingModel: EmbeddingModel;
  let vectorModel: IVectorStoreModel;

  // Helper function to create test objects
  const createTestObject = async (id?: string) => {
    const uniqueId = id || uuidv4();
    const created = await objectModelCore.create({
      objectType: 'pdf',
      sourceUri: `file:///test/${uniqueId}.pdf`,
      title: `Test PDF ${uniqueId}`,
      status: 'complete',
      rawContentRef: null,
      fileHash: `hash_${uniqueId}`,
      originalFileName: `test_${uniqueId}.pdf`,
      fileSizeBytes: 1024,
      cleanedText: null,
      parsedContentJson: null,
      errorInfo: null,
      parsedAt: undefined,
      fileMimeType: 'application/pdf',
      internalFilePath: null,
      aiGeneratedMetadata: null,
      summary: null,
      propositionsJson: null,
      tagsJson: null,
      summaryGeneratedAt: null,
      lastAccessedAt: undefined,
      childObjectIds: undefined,
      objectBio: undefined,
      objectRelationships: undefined,
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
    objectModelCore = new ObjectModelCore(db);
    objectCognitive = new ObjectCognitiveModel(objectModelCore);
    objectAssociation = new ObjectAssociationModel(db);
    chunkModel = new ChunkModel(db);
    embeddingModel = new EmbeddingModel(db);
    
    // Create mocked LanceVectorModel
    vectorModel = new LanceVectorModel({ userDataPath: ':memory:' });
    
    // Create service instance with dependencies
    objectService = new ObjectService({
      db,
      objectModelCore,
      objectCognitive,
      objectAssociation,
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
      const remainingObject = await objectModelCore.getById(objectId);
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
      expect(result.vectorError).toBeDefined();
      expect(result.vectorError?.message).toBe('ChromaDB connection failed');
      expect(result.sqliteError).toBeUndefined();

      // Verify SQLite deletion still succeeded
      const remainingObject = await objectModelCore.getById(objectId);
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
      const remainingObject = await objectModelCore.getById(objectId);
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
      const remainingObject = await objectModelCore.getById(objectId);
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

  describe('createWithCognitive', () => {
    it('should create object with initialized cognitive fields', async () => {
      // Arrange
      const data = {
        objectType: 'webpage' as const,
        sourceUri: 'https://example.com/test',
        title: 'Test Page',
        status: 'new' as const,
        rawContentRef: null
      };

      // Act
      const created = await objectService.createWithCognitive(data);

      // Assert
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.objectType).toBe('webpage');
      expect(created.title).toBe('Test Page');
      expect(created.objectBio).toBeDefined();
      expect(created.objectRelationships).toBeDefined();

      // Verify bio was initialized
      const bio = JSON.parse(created.objectBio!);
      expect(bio.createdAt).toBeDefined();
      expect(bio.events).toEqual([]);

      // Verify relationships were initialized
      const relationships = JSON.parse(created.objectRelationships!);
      expect(relationships.related).toEqual([]);
    });

    it('should handle errors during creation', async () => {
      // Arrange - Mock core.create to throw
      vi.spyOn(objectModelCore, 'create').mockRejectedValueOnce(new Error('DB Error'));
      
      const data = {
        objectType: 'webpage' as const,
        sourceUri: 'https://example.com/fail',
        title: 'Will Fail',
        status: 'new' as const,
        rawContentRef: null
      };

      // Act & Assert
      await expect(objectService.createWithCognitive(data)).rejects.toThrow('DB Error');
    });

    it('should clean up cognitive relationships on deletion', async () => {
      // Arrange - Create two objects with a relationship
      const obj1 = await objectService.createWithCognitive({
        objectType: 'webpage' as const,
        sourceUri: 'https://example.com/obj1',
        title: 'Object 1',
        status: 'new' as const,
        rawContentRef: null
      });

      const obj2 = await objectService.createWithCognitive({
        objectType: 'webpage' as const,
        sourceUri: 'https://example.com/obj2',
        title: 'Object 2',
        status: 'new' as const,
        rawContentRef: null
      });

      // Add bidirectional relationship
      const rel1to2 = await objectCognitive.addRelationship(obj1.id, {
        to: obj2.id,
        nature: 'reference',
        strength: 0.8,
        formed: new Date().toISOString()
      });
      await objectModelCore.update(obj1.id, { objectRelationships: rel1to2 });

      const rel2to1 = await objectCognitive.addRelationship(obj2.id, {
        to: obj1.id,
        nature: 'reference',
        strength: 0.8,
        formed: new Date().toISOString()
      });
      await objectModelCore.update(obj2.id, { objectRelationships: rel2to1 });

      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act - Delete obj1
      const result = await objectService.deleteObjects([obj1.id]);

      // Assert
      expect(result.successful).toEqual([obj1.id]);

      // Verify obj2's relationship to obj1 was cleaned up
      const remainingObj2 = await objectModelCore.getById(obj2.id);
      const relationships = JSON.parse(remainingObj2!.objectRelationships!);
      expect(relationships.related).toHaveLength(0);
    });

    it('should handle complex relationship networks on deletion', async () => {
      // Arrange - Create a network of 3 objects with relationships
      const obj1 = await objectService.createWithCognitive({
        objectType: 'webpage' as const,
        sourceUri: 'https://example.com/obj1',
        title: 'Object 1',
        status: 'new' as const,
        rawContentRef: null
      });

      const obj2 = await objectService.createWithCognitive({
        objectType: 'webpage' as const,
        sourceUri: 'https://example.com/obj2',
        title: 'Object 2',
        status: 'new' as const,
        rawContentRef: null
      });

      const obj3 = await objectService.createWithCognitive({
        objectType: 'webpage' as const,
        sourceUri: 'https://example.com/obj3',
        title: 'Object 3',
        status: 'new' as const,
        rawContentRef: null
      });

      // Create relationships: obj1 -> obj2, obj1 -> obj3, obj2 -> obj3
      const rel1to2 = await objectCognitive.addRelationship(obj1.id, {
        to: obj2.id,
        nature: 'reference',
        strength: 0.8,
        formed: new Date().toISOString()
      });
      await objectModelCore.update(obj1.id, { objectRelationships: rel1to2 });

      const rel1to3 = await objectCognitive.addRelationship(obj1.id, {
        to: obj3.id,
        nature: 'similar',
        strength: 0.6,
        formed: new Date().toISOString()
      });
      await objectModelCore.update(obj1.id, { objectRelationships: rel1to3 });

      const rel2to1 = await objectCognitive.addRelationship(obj2.id, {
        to: obj1.id,
        nature: 'reference',
        strength: 0.8,
        formed: new Date().toISOString()
      });
      await objectModelCore.update(obj2.id, { objectRelationships: rel2to1 });

      const rel2to3 = await objectCognitive.addRelationship(obj2.id, {
        to: obj3.id,
        nature: 'related',
        strength: 0.5,
        formed: new Date().toISOString()
      });
      await objectModelCore.update(obj2.id, { objectRelationships: rel2to3 });

      const rel3to1 = await objectCognitive.addRelationship(obj3.id, {
        to: obj1.id,
        nature: 'similar',
        strength: 0.6,
        formed: new Date().toISOString()
      });
      await objectModelCore.update(obj3.id, { objectRelationships: rel3to1 });

      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act - Delete obj1
      const result = await objectService.deleteObjects([obj1.id]);

      // Assert
      expect(result.successful).toEqual([obj1.id]);

      // Verify obj2's relationships were updated (should only have relationship to obj3)
      const remainingObj2 = await objectModelCore.getById(obj2.id);
      const obj2Relationships = JSON.parse(remainingObj2!.objectRelationships!);
      expect(obj2Relationships.related).toHaveLength(1);
      expect(obj2Relationships.related[0].to).toBe(obj3.id);

      // Verify obj3's relationships were updated (should not have relationship to obj1)
      const remainingObj3 = await objectModelCore.getById(obj3.id);
      const obj3Relationships = JSON.parse(remainingObj3!.objectRelationships!);
      expect(obj3Relationships.related).toHaveLength(0);
    });

    it('should handle relationship cleanup errors gracefully', async () => {
      // Arrange - Create objects with relationship
      const obj1 = await objectService.createWithCognitive({
        objectType: 'webpage' as const,
        sourceUri: 'https://example.com/obj1',
        title: 'Object 1',
        status: 'new' as const,
        rawContentRef: null
      });

      const obj2 = await objectService.createWithCognitive({
        objectType: 'webpage' as const,
        sourceUri: 'https://example.com/obj2',
        title: 'Object 2',
        status: 'new' as const,
        rawContentRef: null
      });

      // Add relationship
      const rel1to2 = await objectCognitive.addRelationship(obj1.id, {
        to: obj2.id,
        nature: 'reference',
        strength: 0.8,
        formed: new Date().toISOString()
      });
      await objectModelCore.update(obj1.id, { objectRelationships: rel1to2 });

      // Mock removeRelationship to throw an error
      vi.spyOn(objectCognitive, 'removeRelationship').mockRejectedValueOnce(new Error('Failed to update'));
      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act - Delete obj1 (should continue despite relationship cleanup error)
      const result = await objectService.deleteObjects([obj1.id]);

      // Assert - Deletion should still succeed
      expect(result.successful).toEqual([obj1.id]);
      expect(result.failed).toEqual([]);

      // Verify object was deleted
      const deletedObj = await objectModelCore.getById(obj1.id);
      expect(deletedObj).toBeNull();
    });

    it('should handle objects with malformed relationships during deletion', async () => {
      // Arrange - Create object with malformed relationships
      const obj1 = await objectService.createWithCognitive({
        objectType: 'webpage' as const,
        sourceUri: 'https://example.com/obj1',
        title: 'Object 1',
        status: 'new' as const,
        rawContentRef: null
      });

      // Manually set malformed relationships
      await objectModelCore.update(obj1.id, { 
        objectRelationships: '{"invalid": "json structure"}'
      });

      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act - Delete should handle malformed data gracefully
      const result = await objectService.deleteObjects([obj1.id]);

      // Assert
      expect(result.successful).toEqual([obj1.id]);
      expect(result.failed).toEqual([]);
    });

    it('should correctly initialize cognitive fields with proper structure', async () => {
      // Act
      const created = await objectService.createWithCognitive({
        objectType: 'pdf' as const,
        sourceUri: 'file:///test.pdf',
        title: 'Test PDF',
        status: 'new' as const,
        rawContentRef: null,
        fileHash: 'abc123',
        originalFileName: 'test.pdf',
        fileSizeBytes: 1024
      });

      // Assert - Verify biography structure
      const bio = JSON.parse(created.objectBio!);
      expect(bio).toHaveProperty('createdAt');
      expect(bio).toHaveProperty('events');
      expect(bio.events).toBeInstanceOf(Array);
      expect(bio.events).toHaveLength(0);
      expect(new Date(bio.createdAt).getTime()).toBeCloseTo(Date.now(), -2); // Within 100ms

      // Assert - Verify relationships structure
      const relationships = JSON.parse(created.objectRelationships!);
      expect(relationships).toHaveProperty('related');
      expect(relationships.related).toBeInstanceOf(Array);
      expect(relationships.related).toHaveLength(0);
    });
  });

  describe('deleteObjectBySourceUri', () => {
    it('should delete object by source URI', async () => {
      // Arrange
      const sourceUri = 'https://example.com/to-delete';
      const obj = await objectModelCore.create({
        objectType: 'webpage',
        sourceUri,
        title: 'Delete by URI',
        status: 'new',
        rawContentRef: null,
        parsedContentJson: null,
        cleanedText: null,
        errorInfo: null,
        parsedAt: undefined,
        fileHash: null,
        originalFileName: null,
        fileSizeBytes: null,
        fileMimeType: null,
        internalFilePath: null,
        aiGeneratedMetadata: null,
        summary: null,
        propositionsJson: null,
        tagsJson: null,
        summaryGeneratedAt: null,
        lastAccessedAt: undefined,
        childObjectIds: undefined,
        objectBio: undefined,
        objectRelationships: undefined,
      });

      (vectorModel.deleteDocumentsByIds as Mock).mockResolvedValue(undefined);

      // Act
      const result = await objectService.deleteObjectBySourceUri(sourceUri);

      // Assert
      expect(result.successful).toEqual([obj.id]);
      expect(result.failed).toEqual([]);
      expect(result.notFound).toEqual([]);
    });

    it('should handle non-existent source URI', async () => {
      // Act
      const result = await objectService.deleteObjectBySourceUri('https://example.com/not-found');

      // Assert
      expect(result.successful).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(result.notFound).toEqual(['https://example.com/not-found']);
    });
  });
});