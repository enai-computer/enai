import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../runMigrations';
import { ChunkModel } from '../ChunkModel';
import { v4 as uuidv4 } from 'uuid';

describe('ChunkModel', () => {
  let db: Database.Database;
  let chunkModel: ChunkModel;
  let testObjectId: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    await runMigrations(db);
    chunkModel = new ChunkModel(db);
    
    // Create a test object that chunks can reference
    testObjectId = uuidv4();
    const stmt = db.prepare(`
      INSERT INTO objects (id, object_type, created_at) 
      VALUES ($id, $objectType, $createdAt)
    `);
    stmt.run({
      id: testObjectId,
      objectType: 'webpage',
      createdAt: new Date().toISOString()
    });
  });

  afterEach(() => {
    db.close();
  });

  describe('addChunk', () => {
    it('should create a new chunk', async () => {
      const chunkData = {
        objectId: testObjectId,
        chunkIdx: 0,
        content: 'This is test content',
        summary: 'Test summary',
        tagsJson: JSON.stringify(['test', 'chunk']),
        propositionsJson: JSON.stringify(['Proposition 1', 'Proposition 2']),
        tokenCount: 5
      };

      const result = await chunkModel.addChunk(chunkData);

      expect(result.id).toBeDefined();
      expect(result.objectId).toBe(testObjectId);
      expect(result.chunkIdx).toBe(0);
      expect(result.content).toBe('This is test content');
      expect(result.summary).toBe('Test summary');
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should handle chunks without optional fields', async () => {
      const chunkData = {
        objectId: testObjectId,
        chunkIdx: 0,
        content: 'Minimal chunk content'
      };

      const result = await chunkModel.addChunk(chunkData);

      expect(result.id).toBeDefined();
      expect(result.content).toBe('Minimal chunk content');
      expect(result.summary).toBeNull();
      expect(result.tagsJson).toBeNull();
      expect(result.propositionsJson).toBeNull();
      expect(result.tokenCount).toBeNull();
    });

    it('should enforce unique constraint on object_id and chunk_idx', async () => {
      const chunkData = {
        objectId: testObjectId,
        chunkIdx: 0,
        content: 'First chunk'
      };

      await chunkModel.addChunk(chunkData);
      
      await expect(chunkModel.addChunk(chunkData)).rejects.toThrow();
    });
  });

  describe('addChunkSync', () => {
    it('should create a chunk synchronously', () => {
      const chunkData = {
        objectId: testObjectId,
        chunkIdx: 0,
        content: 'Sync chunk content'
      };

      const result = chunkModel.addChunkSync(chunkData);

      expect(result.id).toBeDefined();
      expect(result.content).toBe('Sync chunk content');
      expect(result.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('addChunksBulk', () => {
    it('should add multiple chunks in a single transaction', async () => {
      const chunks = [
        {
          objectId: testObjectId,
          chunkIdx: 0,
          content: 'First chunk'
        },
        {
          objectId: testObjectId,
          chunkIdx: 1,
          content: 'Second chunk'
        },
        {
          objectId: testObjectId,
          chunkIdx: 2,
          content: 'Third chunk'
        }
      ];

      const ids = await chunkModel.addChunksBulk(chunks);

      expect(ids).toHaveLength(3);
      ids.forEach(id => expect(typeof id).toBe('number'));
      
      const storedChunks = chunkModel.listByObjectId(testObjectId);
      expect(storedChunks).toHaveLength(3);
    });

    it('should return empty array for empty input', async () => {
      const ids = await chunkModel.addChunksBulk([]);
      expect(ids).toEqual([]);
    });
  });

  describe('addChunksBulkSync', () => {
    it('should add multiple chunks synchronously', () => {
      const chunks = [
        {
          objectId: testObjectId,
          chunkIdx: 0,
          content: 'Sync chunk 1'
        },
        {
          objectId: testObjectId,
          chunkIdx: 1,
          content: 'Sync chunk 2'
        }
      ];

      const ids = chunkModel.addChunksBulkSync(chunks);

      expect(ids).toHaveLength(2);
      ids.forEach(id => expect(typeof id).toBe('number'));
    });
  });

  describe('getById', () => {
    it('should retrieve a chunk by its ID', async () => {
      const created = await chunkModel.addChunk({
        objectId: testObjectId,
        chunkIdx: 0,
        content: 'Test content'
      });

      const retrieved = chunkModel.getById(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.content).toBe('Test content');
    });

    it('should return null for non-existent ID', () => {
      const result = chunkModel.getById(99999);
      expect(result).toBeNull();
    });
  });

  describe('listByObjectId', () => {
    it('should retrieve all chunks for an object ordered by chunk_idx', async () => {
      await chunkModel.addChunksBulk([
        { objectId: testObjectId, chunkIdx: 2, content: 'Third' },
        { objectId: testObjectId, chunkIdx: 0, content: 'First' },
        { objectId: testObjectId, chunkIdx: 1, content: 'Second' }
      ]);

      const chunks = chunkModel.listByObjectId(testObjectId);

      expect(chunks).toHaveLength(3);
      expect(chunks[0].content).toBe('First');
      expect(chunks[1].content).toBe('Second');
      expect(chunks[2].content).toBe('Third');
    });

    it('should return empty array for object with no chunks', () => {
      const chunks = chunkModel.listByObjectId(uuidv4());
      expect(chunks).toEqual([]);
    });
  });

  describe('listByNotebookId', () => {
    it('should retrieve chunks by notebook ID', async () => {
      const notebookId = uuidv4();
      
      // Create notebook first
      db.prepare(`
        INSERT INTO notebooks (id, title, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        notebookId,
        'Test Notebook',
        'Test Description',
        Date.now(),
        Date.now()
      );
      
      await chunkModel.addChunksBulk([
        { objectId: testObjectId, notebookId, chunkIdx: 0, content: 'Notebook chunk 1' },
        { objectId: testObjectId, notebookId, chunkIdx: 1, content: 'Notebook chunk 2' },
        { objectId: testObjectId, chunkIdx: 2, content: 'No notebook chunk' }
      ]);

      const chunks = await chunkModel.listByNotebookId(notebookId);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].content).toBe('Notebook chunk 1');
      expect(chunks[1].content).toBe('Notebook chunk 2');
    });
  });

  describe('listUnembedded', () => {
    it('should return chunks without embeddings', async () => {
      await chunkModel.addChunksBulk([
        { objectId: testObjectId, chunkIdx: 0, content: 'Chunk 1' },
        { objectId: testObjectId, chunkIdx: 1, content: 'Chunk 2' }
      ]);

      const unembedded = chunkModel.listUnembedded();

      expect(unembedded).toHaveLength(2);
    });

    it('should exclude chunks with embeddings', async () => {
      const chunk = await chunkModel.addChunk({
        objectId: testObjectId,
        chunkIdx: 0,
        content: 'Embedded chunk'
      });

      // Add an embedding for this chunk
      const stmt = db.prepare(`
        INSERT INTO embeddings (chunk_id, model, vector_id, created_at)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(chunk.id, 'test-model', uuidv4(), new Date().toISOString());

      const unembedded = chunkModel.listUnembedded();
      expect(unembedded).toHaveLength(0);
    });

    it('should respect the limit parameter', async () => {
      const chunks = Array.from({ length: 10 }, (_, i) => ({
        objectId: testObjectId,
        chunkIdx: i,
        content: `Chunk ${i}`
      }));
      await chunkModel.addChunksBulk(chunks);

      const limited = chunkModel.listUnembedded(5);
      expect(limited).toHaveLength(5);
    });
  });

  describe('getChunksByIds', () => {
    it('should retrieve multiple chunks by their IDs', async () => {
      const created = await chunkModel.addChunksBulk([
        { objectId: testObjectId, chunkIdx: 0, content: 'Chunk 1' },
        { objectId: testObjectId, chunkIdx: 1, content: 'Chunk 2' },
        { objectId: testObjectId, chunkIdx: 2, content: 'Chunk 3' }
      ]);

      const chunks = chunkModel.getChunksByIds(created.map(id => id.toString()));

      expect(chunks).toHaveLength(3);
      expect(chunks.map(c => c.content)).toContain('Chunk 1');
      expect(chunks.map(c => c.content)).toContain('Chunk 2');
      expect(chunks.map(c => c.content)).toContain('Chunk 3');
    });

    it('should handle invalid ID strings gracefully', () => {
      const chunks = chunkModel.getChunksByIds(['not-a-number', 'also-invalid']);
      expect(chunks).toEqual([]);
    });

    it('should return empty array for empty input', () => {
      const chunks = chunkModel.getChunksByIds([]);
      expect(chunks).toEqual([]);
    });

    it('should skip non-existent IDs', async () => {
      const created = await chunkModel.addChunk({
        objectId: testObjectId,
        chunkIdx: 0,
        content: 'Existing chunk'
      });

      const chunks = chunkModel.getChunksByIds([
        created.id.toString(),
        '99999'
      ]);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('Existing chunk');
    });
  });

  describe('assignToNotebook', () => {
    it('should assign a chunk to a notebook', async () => {
      const chunk = await chunkModel.addChunk({
        objectId: testObjectId,
        chunkIdx: 0,
        content: 'Test chunk'
      });
      const notebookId = uuidv4();

      // Create notebook first
      db.prepare(`
        INSERT INTO notebooks (id, title, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        notebookId,
        'Test Notebook',
        'Test Description',
        Date.now(),
        Date.now()
      );

      const success = await chunkModel.assignToNotebook(chunk.id, notebookId);

      expect(success).toBe(true);
      
      const updated = chunkModel.getById(chunk.id);
      expect(updated?.notebookId).toBe(notebookId);
    });

    it('should allow setting notebook_id to null', async () => {
      const notebookId = uuidv4();
      
      // Create notebook first
      db.prepare(`
        INSERT INTO notebooks (id, title, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        notebookId,
        'Test Notebook',
        'Test Description',
        Date.now(),
        Date.now()
      );
      
      const chunk = await chunkModel.addChunk({
        objectId: testObjectId,
        notebookId,
        chunkIdx: 0,
        content: 'Test chunk'
      });

      const success = await chunkModel.assignToNotebook(chunk.id, null);

      expect(success).toBe(true);
      
      const updated = chunkModel.getById(chunk.id);
      expect(updated?.notebookId).toBeNull();
    });

    it('should return false for non-existent chunk', async () => {
      const success = await chunkModel.assignToNotebook(99999, uuidv4());
      expect(success).toBe(false);
    });
  });

  describe('getChunksByObjectId', () => {
    it('should retrieve chunks ordered by chunk_idx', async () => {
      await chunkModel.addChunksBulk([
        { objectId: testObjectId, chunkIdx: 1, content: 'Second' },
        { objectId: testObjectId, chunkIdx: 0, content: 'First' },
        { objectId: testObjectId, chunkIdx: 2, content: 'Third' }
      ]);

      const chunks = chunkModel.getChunksByObjectId(testObjectId);

      expect(chunks).toHaveLength(3);
      expect(chunks[0].chunkIdx).toBe(0);
      expect(chunks[1].chunkIdx).toBe(1);
      expect(chunks[2].chunkIdx).toBe(2);
    });
  });

  describe('getChunkIdsByObjectIds', () => {
    it('should retrieve chunk IDs for multiple objects', async () => {
      const objectId2 = uuidv4();
      db.prepare('INSERT INTO objects (id, object_type, created_at) VALUES (?, ?, ?)').run(
        objectId2,
        'pdf',
        new Date().toISOString()
      );

      await chunkModel.addChunksBulk([
        { objectId: testObjectId, chunkIdx: 0, content: 'Obj1 Chunk1' },
        { objectId: testObjectId, chunkIdx: 1, content: 'Obj1 Chunk2' },
        { objectId: objectId2, chunkIdx: 0, content: 'Obj2 Chunk1' }
      ]);

      const chunkIds = await chunkModel.getChunkIdsByObjectIds([testObjectId, objectId2]);

      expect(chunkIds).toHaveLength(3);
      chunkIds.forEach(id => expect(typeof id).toBe('string'));
    });

    it('should handle large batches', async () => {
      // Create many objects
      const objectIds = Array.from({ length: 1000 }, () => uuidv4());
      const insertStmt = db.prepare('INSERT INTO objects (id, object_type, created_at) VALUES (?, ?, ?)');
      const insertMany = db.transaction((objs: string[]) => {
        for (const id of objs) {
          insertStmt.run(id, 'webpage', new Date().toISOString());
        }
      });
      insertMany(objectIds);

      // Add one chunk per object
      const chunks = objectIds.map((id, idx) => ({
        objectId: id,
        chunkIdx: 0,
        content: `Chunk for ${id}`
      }));
      
      // Add in batches to avoid SQL variable limit
      for (let i = 0; i < chunks.length; i += 100) {
        await chunkModel.addChunksBulk(chunks.slice(i, i + 100));
      }

      const chunkIds = await chunkModel.getChunkIdsByObjectIds(objectIds);
      expect(chunkIds).toHaveLength(1000);
    });

    it('should return empty array for empty input', async () => {
      const chunkIds = await chunkModel.getChunkIdsByObjectIds([]);
      expect(chunkIds).toEqual([]);
    });
  });

  describe('deleteByObjectIds', () => {
    it('should delete all chunks for specified objects', async () => {
      const objectId2 = uuidv4();
      db.prepare('INSERT INTO objects (id, object_type, created_at) VALUES (?, ?, ?)').run(
        objectId2,
        'pdf',
        new Date().toISOString()
      );

      await chunkModel.addChunksBulk([
        { objectId: testObjectId, chunkIdx: 0, content: 'Delete me 1' },
        { objectId: testObjectId, chunkIdx: 1, content: 'Delete me 2' },
        { objectId: objectId2, chunkIdx: 0, content: 'Keep me' }
      ]);

      chunkModel.deleteByObjectIds([testObjectId]);

      const deletedChunks = chunkModel.listByObjectId(testObjectId);
      expect(deletedChunks).toHaveLength(0);

      const keptChunks = chunkModel.listByObjectId(objectId2);
      expect(keptChunks).toHaveLength(1);
    });

    it('should handle empty input gracefully', () => {
      expect(() => chunkModel.deleteByObjectIds([])).not.toThrow();
    });
  });

  describe('deleteByIds', () => {
    it('should delete chunks by their IDs', async () => {
      const created = await chunkModel.addChunksBulk([
        { objectId: testObjectId, chunkIdx: 0, content: 'Delete me' },
        { objectId: testObjectId, chunkIdx: 1, content: 'Keep me' }
      ]);

      chunkModel.deleteByIds([created[0]]);

      const remaining = chunkModel.listByObjectId(testObjectId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].content).toBe('Keep me');
    });

    it('should handle empty input gracefully', () => {
      expect(() => chunkModel.deleteByIds([])).not.toThrow();
    });
  });

  describe('getDatabase', () => {
    it('should return the database instance', () => {
      const dbInstance = chunkModel.getDatabase();
      expect(dbInstance).toBe(db);
    });
  });
});