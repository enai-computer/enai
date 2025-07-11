import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDb, cleanTestDb } from './testUtils';
import { EmbeddingModel } from '../EmbeddingModel';
import { ChunkModel } from '../ChunkModel';
import { ObjectModelCore } from '../ObjectModelCore';

describe('EmbeddingModel', () => {
  let db: Database.Database;
  let embeddingModel: EmbeddingModel;
  let chunkModel: ChunkModel;
  let objectModel: ObjectModelCore;
  let testObjectId: string;
  let testChunkId: number;

  beforeAll(() => {
    db = setupTestDb();
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(async () => {
    cleanTestDb(db);
    embeddingModel = new EmbeddingModel(db);
    chunkModel = new ChunkModel(db);
    objectModel = new ObjectModelCore(db);
    
    // Create test object and chunk for foreign key relationships
    const testObject = await objectModel.create({
      objectType: 'webpage',
      sourceUri: 'https://example.com',
      title: 'Test Object',
      status: 'new',
      rawContentRef: null,
      parsedContentJson: null,
      errorInfo: null
    });
    testObjectId = testObject.id;
    
    const chunk = await chunkModel.addChunk({
      objectId: testObjectId,
      chunkIdx: 0,
      content: 'Test chunk content',
      tokenCount: 3
    });
    testChunkId = chunk.id;
  });

  describe('addEmbeddingRecord', () => {
    it('should create a new embedding record', () => {
      const vectorId = `${testObjectId}_0_text-embedding-3-small`;
      const record = embeddingModel.addEmbeddingRecord({
        chunkId: testChunkId,
        model: 'text-embedding-3-small',
        vectorId
      });

      expect(record.chunkId).toBe(testChunkId);
      expect(record.model).toBe('text-embedding-3-small');
      expect(record.vectorId).toBe(vectorId);
      expect(record.createdAt).toBeInstanceOf(Date);
    });

    it('should return existing record on duplicate vector_id', () => {
      const vectorId = `${testObjectId}_0_text-embedding-3-small`;
      const data = {
        chunkId: testChunkId,
        model: 'text-embedding-3-small',
        vectorId
      };

      const firstRecord = embeddingModel.addEmbeddingRecord(data);
      const secondRecord = embeddingModel.addEmbeddingRecord(data);

      expect(secondRecord.id).toBe(firstRecord.id);
      expect(secondRecord.vectorId).toBe(firstRecord.vectorId);
    });

    it('should throw on invalid chunk_id', () => {
      expect(() => {
        embeddingModel.addEmbeddingRecord({
          chunkId: 999999,
          model: 'text-embedding-3-small',
          vectorId: 'invalid_chunk_vector'
        });
      }).toThrow();
    });
  });

  describe('addEmbeddingRecordsBulk', () => {
    it('should insert multiple records in one transaction', () => {
      const records = [
        {
          chunkId: testChunkId,
          model: 'text-embedding-3-small',
          vectorId: `${testObjectId}_0_bulk1`
        },
        {
          chunkId: testChunkId,
          model: 'text-embedding-3-small',
          vectorId: `${testObjectId}_0_bulk2`
        }
      ];

      embeddingModel.addEmbeddingRecordsBulk(records);
      
      const count = embeddingModel.getCount();
      expect(count).toBe(2);
    });

    it('should skip duplicates without failing', () => {
      const vectorId = `${testObjectId}_0_duplicate`;
      embeddingModel.addEmbeddingRecord({
        chunkId: testChunkId,
        model: 'text-embedding-3-small',
        vectorId
      });

      const records = [
        {
          chunkId: testChunkId,
          model: 'text-embedding-3-small',
          vectorId // duplicate
        },
        {
          chunkId: testChunkId,
          model: 'text-embedding-3-small',
          vectorId: `${testObjectId}_0_new`
        }
      ];

      embeddingModel.addEmbeddingRecordsBulk(records);
      
      const count = embeddingModel.getCount();
      expect(count).toBe(2); // Original + 1 new
    });

    it('should handle empty array gracefully', () => {
      embeddingModel.addEmbeddingRecordsBulk([]);
      const count = embeddingModel.getCount();
      expect(count).toBe(0);
    });
  });

  describe('getById', () => {
    it('should retrieve embedding by primary key', () => {
      const created = embeddingModel.addEmbeddingRecord({
        chunkId: testChunkId,
        model: 'text-embedding-3-small',
        vectorId: `${testObjectId}_0_getbyid`
      });

      const retrieved = embeddingModel.getById(created.id);
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.vectorId).toBe(created.vectorId);
    });

    it('should return null for non-existent id', () => {
      const result = embeddingModel.getById(999999);
      expect(result).toBeNull();
    });
  });

  describe('findByChunkId', () => {
    it('should find embedding by chunk id', () => {
      const vectorId = `${testObjectId}_0_bychunk`;
      embeddingModel.addEmbeddingRecord({
        chunkId: testChunkId,
        model: 'text-embedding-3-small',
        vectorId
      });

      const found = embeddingModel.findByChunkId(testChunkId);
      expect(found?.chunkId).toBe(testChunkId);
      expect(found?.vectorId).toBe(vectorId);
    });

    it('should return null when no embedding exists for chunk', () => {
      const result = embeddingModel.findByChunkId(999999);
      expect(result).toBeNull();
    });
  });

  describe('findByVectorId', () => {
    it('should find embedding by vector id', () => {
      const vectorId = `${testObjectId}_0_byvector`;
      const created = embeddingModel.addEmbeddingRecord({
        chunkId: testChunkId,
        model: 'text-embedding-3-small',
        vectorId
      });

      const found = embeddingModel.findByVectorId(vectorId);
      expect(found?.id).toBe(created.id);
      expect(found?.vectorId).toBe(vectorId);
    });

    it('should return null for non-existent vector id', () => {
      const result = embeddingModel.findByVectorId('non_existent_vector');
      expect(result).toBeNull();
    });
  });

  describe('deleteById', () => {
    it('should delete existing embedding record', () => {
      const created = embeddingModel.addEmbeddingRecord({
        chunkId: testChunkId,
        model: 'text-embedding-3-small',
        vectorId: `${testObjectId}_0_todelete`
      });

      embeddingModel.deleteById(created.id);
      
      const found = embeddingModel.getById(created.id);
      expect(found).toBeNull();
    });

    it('should handle deletion of non-existent id gracefully', () => {
      // Should not throw
      embeddingModel.deleteById(999999);
      expect(true).toBe(true);
    });
  });

  describe('deleteByChunkId', () => {
    it('should delete all embeddings for a chunk', () => {
      embeddingModel.addEmbeddingRecord({
        chunkId: testChunkId,
        model: 'text-embedding-3-small',
        vectorId: `${testObjectId}_0_del1`
      });

      embeddingModel.deleteByChunkId(testChunkId);
      
      const found = embeddingModel.findByChunkId(testChunkId);
      expect(found).toBeNull();
    });

    it('should handle deletion when no embeddings exist', () => {
      // Should not throw
      embeddingModel.deleteByChunkId(999999);
      expect(true).toBe(true);
    });
  });

  describe('deleteByChunkIds', () => {
    it('should delete embeddings for multiple chunks', async () => {
      // Create additional chunk
      const chunk2 = await chunkModel.addChunk({
        objectId: testObjectId,
        chunkIdx: 1,
        content: 'Second chunk',
        tokenCount: 2
      });

      embeddingModel.addEmbeddingRecord({
        chunkId: testChunkId,
        model: 'text-embedding-3-small',
        vectorId: `${testObjectId}_0_multi1`
      });

      embeddingModel.addEmbeddingRecord({
        chunkId: chunk2.id,
        model: 'text-embedding-3-small',
        vectorId: `${testObjectId}_1_multi2`
      });

      embeddingModel.deleteByChunkIds([testChunkId, chunk2.id]);
      
      expect(embeddingModel.getCount()).toBe(0);
    });

    it('should handle empty array gracefully', () => {
      embeddingModel.deleteByChunkIds([]);
      expect(true).toBe(true);
    });
  });

  describe('deleteByObjectIds', () => {
    it('should delete all embeddings for chunks belonging to objects', async () => {
      // Create second object with chunks
      const testObject2 = await objectModel.create({
        objectType: 'webpage',
        sourceUri: 'https://example2.com',
        title: 'Test Object 2',
        status: 'new',
        rawContentRef: null,
        parsedContentJson: null,
        errorInfo: null
      });
      const objectId2 = testObject2.id;

      const chunk2 = await chunkModel.addChunk({
        objectId: objectId2,
        chunkIdx: 0,
        content: 'Object 2 chunk',
        tokenCount: 3
      });

      // Add embeddings for both objects
      embeddingModel.addEmbeddingRecord({
        chunkId: testChunkId,
        model: 'text-embedding-3-small',
        vectorId: `${testObjectId}_0_obj1`
      });

      embeddingModel.addEmbeddingRecord({
        chunkId: chunk2.id,
        model: 'text-embedding-3-small',
        vectorId: `${objectId2}_0_obj2`
      });

      // Delete embeddings for first object only
      embeddingModel.deleteByObjectIds([testObjectId]);
      
      const remaining = embeddingModel.findByChunkId(chunk2.id);
      expect(remaining).toBeTruthy();
      expect(embeddingModel.getCount()).toBe(1);
    });

    it('should handle large batches', async () => {
      const objectIds: string[] = [];
      
      // Create 10 objects with chunks and embeddings
      for (let i = 0; i < 10; i++) {
        const testObj = await objectModel.create({
          objectType: 'webpage',
          sourceUri: `https://example${i}.com`,
          title: `Test Object ${i}`,
          status: 'new',
          rawContentRef: null,
          parsedContentJson: null,
          errorInfo: null
        });
        const objId = testObj.id;
        objectIds.push(objId);

        const chunk = await chunkModel.addChunk({
          objectId: objId,
          chunkIdx: 0,
          content: `Chunk for object ${i}`,
          tokenCount: 4
        });

        embeddingModel.addEmbeddingRecord({
          chunkId: chunk.id,
          model: 'text-embedding-3-small',
          vectorId: `${objId}_0_batch`
        });
      }

      embeddingModel.deleteByObjectIds(objectIds);
      expect(embeddingModel.getCount()).toBe(0);
    });
  });

  describe('getCount', () => {
    it('should return correct count of embeddings', () => {
      expect(embeddingModel.getCount()).toBe(0);

      embeddingModel.addEmbeddingRecord({
        chunkId: testChunkId,
        model: 'text-embedding-3-small',
        vectorId: `${testObjectId}_0_count1`
      });

      expect(embeddingModel.getCount()).toBe(1);

      embeddingModel.addEmbeddingRecord({
        chunkId: testChunkId,
        model: 'text-embedding-3-small',
        vectorId: `${testObjectId}_0_count2`
      });

      expect(embeddingModel.getCount()).toBe(2);
    });
  });

  describe('getDatabase', () => {
    it('should return the database instance', () => {
      const database = embeddingModel.getDatabase();
      expect(database).toBe(db);
    });
  });
});