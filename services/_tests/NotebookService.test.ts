import { describe, beforeEach, expect, it, vi, afterEach } from 'vitest';
import runMigrations from '../../models/runMigrations';
import { ObjectModelCore } from '../../models/ObjectModelCore';
import { ObjectCognitiveModel } from '../../models/ObjectCognitiveModel';
import { ObjectAssociationModel } from '../../models/ObjectAssociationModel';
import { ChunkModel } from '../../models/ChunkModel';
import { ChatModel } from '../../models/ChatModel';
import { NotebookModel } from '../../models/NotebookModel';
import { ActivityLogModel } from '../../models/ActivityLogModel';
import { ActivityLogService } from '../ActivityLogService';
import { NotebookService } from '../NotebookService';
import { JeffersObject, NotebookRecord, IChatSession, ObjectChunk } from '../../shared/types';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { logger } from '../../utils/logger';

// Mock logger to prevent console output during tests
vi.mock('../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('NotebookService with BaseService', () => {
  let db: Database.Database;
  let objectModelCore: ObjectModelCore;
  let objectCognitive: ObjectCognitiveModel;
  let objectAssociation: ObjectAssociationModel;
  let chunkModel: ChunkModel;
  let chatModel: ChatModel;
  let notebookModel: NotebookModel;
  let activityLogModel: ActivityLogModel;
  let activityLogService: ActivityLogService;
  let notebookService: NotebookService;

  beforeEach(async () => {
    // Create in-memory database
    db = new Database(':memory:');
    await runMigrations(db);

    // Initialize models
    objectModelCore = new ObjectModelCore(db);
    objectCognitive = new ObjectCognitiveModel(objectModelCore);
    objectAssociation = new ObjectAssociationModel(db);
    chunkModel = new ChunkModel(db);
    chatModel = new ChatModel(db);
    notebookModel = new NotebookModel(db);
    activityLogModel = new ActivityLogModel(db);
    
    // Create mock ActivityLogService
    activityLogService = {
      logNotebookVisit: vi.fn().mockResolvedValue(undefined),
      logActivity: vi.fn().mockResolvedValue(undefined),
    } as any;
    
    // Create service with dependency injection
    notebookService = new NotebookService({
      db,
      notebookModel,
      objectModelCore,
      objectCognitive,
      objectAssociation,
      chunkModel,
      chatModel,
      activityLogService,
      activityLogModel
    });
    
    // Initialize service
    await notebookService.initialize();
  });

  afterEach(async () => {
    // Cleanup service
    await notebookService.cleanup();
    
    if (db && db.open) {
      db.close();
    }
    
    vi.clearAllMocks();
  });

  describe('createNotebook', () => {
    it('should create a NotebookRecord and a corresponding JeffersObject', async () => {
      const title = 'Test Notebook';
      const description = 'This is a test description.';

      const notebookRecord = await notebookService.createNotebook(title, description);

      // Verify NotebookRecord
      expect(notebookRecord).toBeDefined();
      expect(notebookRecord.id).toEqual(expect.any(String));
      expect(notebookRecord.title).toBe(title);
      expect(notebookRecord.description).toBe(description);
      expect(notebookRecord.createdAt).toBe(notebookRecord.updatedAt);

      // Verify JeffersObject
      const expectedSourceUri = `enai://notebook/${notebookRecord.id}`;
      const jeffersObject = await objectModelCore.getBySourceUri(expectedSourceUri);

      expect(jeffersObject).toBeDefined();
      expect(jeffersObject?.objectType).toBe('notebook');
      expect(jeffersObject?.title).toBe(title);
      expect(jeffersObject?.cleanedText).toBe(`${title}\n${description}`);
      expect(jeffersObject?.status).toBe('parsed');
    });

    it('should handle null description', async () => {
      const title = 'Test Notebook No Description';
      const notebookRecord = await notebookService.createNotebook(title, null);

      expect(notebookRecord.description).toBeNull();
      
      const jeffersObject = await objectModelCore.getBySourceUri(`enai://notebook/${notebookRecord.id}`);
      expect(jeffersObject?.cleanedText).toBe(title);
    });

    it('should rollback on transaction failure', async () => {
      const title = 'Fail Object Notebook';
      const createObjectSpy = vi.spyOn(objectModelCore, 'create').mockImplementationOnce(async () => {
        throw new Error('Simulated ObjectModel.create failure');
      });

      await expect(notebookService.createNotebook(title, 'description'))
        .rejects
        .toThrow('Simulated ObjectModel.create failure');

      const allNotebooks = await notebookModel.getAll();
      expect(allNotebooks.find(nb => nb.title === title)).toBeUndefined();
      
      createObjectSpy.mockRestore();
    });
  });

  describe('getNotebookById', () => {
    it('should retrieve existing notebook or return null', async () => {
      const createdNotebook = await notebookService.createNotebook('GetMe', 'Description');
      
      const fetchedNotebook = await notebookService.getNotebookById(createdNotebook.id);
      expect(fetchedNotebook?.id).toBe(createdNotebook.id);
      
      const nonExistent = await notebookService.getNotebookById(randomUUID());
      expect(nonExistent).toBeNull();
    });
  });

  describe('getAllNotebooks', () => {
    it('should retrieve all notebooks in order', async () => {
      await notebookService.createNotebook('NB1', 'Desc1');
      await notebookService.createNotebook('NB2', 'Desc2');
      
      const allNotebooks = await notebookService.getAllNotebooks();
      expect(allNotebooks.length).toBe(3); // 2 created + 1 default cover
      expect(allNotebooks[0].title).toBe('Homepage Conversations');
      expect(allNotebooks[1].title).toBe('NB1');
      expect(allNotebooks[2].title).toBe('NB2');
    });
  });

  describe('updateNotebook', () => {
    let notebook: NotebookRecord;

    beforeEach(async () => {
      notebook = await notebookService.createNotebook('Original Title', 'Original Description');
    });

    it('should update notebook and corresponding JeffersObject', async () => {
      const updates = { title: 'Updated Title', description: 'Updated Description' };
      const updatedNotebook = await notebookService.updateNotebook(notebook.id, updates);

      expect(updatedNotebook?.title).toBe(updates.title);
      expect(updatedNotebook?.description).toBe(updates.description);

      const jeffersObject = await objectModelCore.getBySourceUri(`enai://notebook/${notebook.id}`);
      expect(jeffersObject?.title).toBe(updates.title);
      expect(jeffersObject?.cleanedText).toBe(`${updates.title}\n${updates.description}`);
    });

    it('should update partial fields and handle null description', async () => {
      // Update only title
      await notebookService.updateNotebook(notebook.id, { title: 'New Title Only' });
      const afterTitleUpdate = await notebookModel.getById(notebook.id);
      expect(afterTitleUpdate?.title).toBe('New Title Only');
      expect(afterTitleUpdate?.description).toBe('Original Description');

      // Update description to null
      await notebookService.updateNotebook(notebook.id, { description: null });
      const afterNullDesc = await notebookModel.getById(notebook.id);
      expect(afterNullDesc?.description).toBeNull();
      
      const jeffersObject = await objectModelCore.getBySourceUri(`enai://notebook/${notebook.id}`);
      expect(jeffersObject?.cleanedText).toBe('New Title Only');
    });

    it('should return null for non-existent notebook', async () => {
      const result = await notebookService.updateNotebook(randomUUID(), { title: 'No Such Notebook' });
      expect(result).toBeNull();
    });

    it('should rollback on transaction failure', async () => {
      const originalNotebook = await notebookModel.getById(notebook.id);
      const updateObjectSpy = vi.spyOn(objectModelCore, 'update').mockImplementationOnce(async () => {
        throw new Error('Simulated ObjectModel.update failure');
      });

      await expect(notebookService.updateNotebook(notebook.id, { title: 'Failed Update' }))
        .rejects
        .toThrow('Simulated ObjectModel.update failure');

      const notebookAfterFailure = await notebookModel.getById(notebook.id);
      expect(notebookAfterFailure?.title).toBe(originalNotebook?.title);

      updateObjectSpy.mockRestore();
    });
  });

  describe('deleteNotebook', () => {
    let notebook: NotebookRecord;
    let chatSession: IChatSession;
    let chunk: ObjectChunk;
    let independentObject: JeffersObject;

    beforeEach(async () => {
      notebook = await notebookService.createNotebook('ToDelete', 'Delete Desc');
      
      // Create independent object for chunk
      independentObject = await objectModelCore.create({
        objectType: 'webpage',
        sourceUri: `test://source/${randomUUID()}`,
        title: 'Independent Object',
        status: 'parsed',
        cleanedText: 'Content',
        rawContentRef: null,
        parsedContentJson: null,
        errorInfo: null,
        parsedAt: new Date().toISOString(),
      });
      
      chatSession = await chatModel.createSession(notebook.id, randomUUID(), 'Chat in ToDelete');
      
      // Create chunk linked to independent object but assigned to notebook
      const createdChunk = await chunkModel.addChunk({
        objectId: independentObject.id, 
        chunkIdx: 0,
        content: 'Test chunk content',
      });
      await chunkModel.assignToNotebook(createdChunk.id, notebook.id);
      chunk = await chunkModel.getById(createdChunk.id)!;
    });

    it('should delete notebook, cascade delete sessions, and nullify chunk assignments', async () => {
      const deleteResult = await notebookService.deleteNotebook(notebook.id);
      expect(deleteResult).toBe(true);

      // Verify deletions and nullifications
      expect(await notebookModel.getById(notebook.id)).toBeNull();
      expect(await objectModelCore.getBySourceUri(`enai://notebook/${notebook.id}`)).toBeNull();
      expect(await chatModel.listSessionsForNotebook(notebook.id)).toHaveLength(0);
      
      const updatedChunk = await chunkModel.getById(chunk.id);
      expect(updatedChunk?.notebookId).toBeNull();
    });

    it('should handle non-existent notebook', async () => {
      const deleteResult = await notebookService.deleteNotebook(randomUUID());
      expect(deleteResult).toBe(false);
    });

    it('should rollback on transaction failure', async () => {
      const deleteObjectSpy = vi.spyOn(objectModelCore, 'deleteById').mockImplementationOnce(() => {
        throw new Error('Simulated delete failure');
      });

      await expect(notebookService.deleteNotebook(notebook.id))
        .rejects
        .toThrow('Simulated delete failure');

      // Verify nothing was deleted
      expect(await notebookModel.getById(notebook.id)).toBeDefined();
      expect(await objectModelCore.getBySourceUri(`enai://notebook/${notebook.id}`)).toBeDefined();

      deleteObjectSpy.mockRestore();
    });
  });

  describe('Chat management', () => {
    let notebook: NotebookRecord;

    beforeEach(async () => {
      notebook = await notebookService.createNotebook('NotebookForChat', 'Test Desc');
    });

    it('should create and list chats in notebook', async () => {
      // Create chats with various title scenarios
      const chat1 = await notebookService.createChatInNotebook(notebook.id, 'My Test Chat');
      expect(chat1.title).toBe('My Test Chat');
      
      const chat2 = await notebookService.createChatInNotebook(notebook.id, null);
      expect(chat2.title).toBeNull();
      
      const chat3 = await notebookService.createChatInNotebook(notebook.id);
      expect(chat3.title).toBeNull();

      // List chats
      const chats = await notebookService.listChatsForNotebook(notebook.id);
      expect(chats).toHaveLength(3);
      expect(chats.every(c => c.notebookId === notebook.id)).toBe(true);
    });

    it('should throw error for non-existent notebook', async () => {
      const nonExistentId = randomUUID();
      
      await expect(notebookService.createChatInNotebook(nonExistentId, 'Chat Title'))
        .rejects
        .toThrow(`Notebook not found with ID: ${nonExistentId}`);
        
      await expect(notebookService.listChatsForNotebook(nonExistentId))
        .rejects
        .toThrow(`Notebook not found with ID: ${nonExistentId}`);
    });
  });

  describe('transferChatToNotebook', () => {
    let notebook1: NotebookRecord;
    let notebook2: NotebookRecord;
    let chatSession: IChatSession;

    beforeEach(async () => {
      notebook1 = await notebookService.createNotebook('SourceNotebook', 'SrcDesc');
      notebook2 = await notebookService.createNotebook('TargetNotebook', 'TgtDesc');
      chatSession = await chatModel.createSession(notebook1.id, randomUUID(), 'ChatToTransfer');
    });

    it('should transfer chat between notebooks', async () => {
      const result = await notebookService.transferChatToNotebook(chatSession.sessionId, notebook2.id);
      expect(result).toBe(true);
      
      const updatedSession = await chatModel.getSessionById(chatSession.sessionId);
      expect(updatedSession?.notebookId).toBe(notebook2.id);
    });

    it('should handle transfer to same notebook', async () => {
      const result = await notebookService.transferChatToNotebook(chatSession.sessionId, notebook1.id);
      expect(result).toBe(true);
      
      const session = await chatModel.getSessionById(chatSession.sessionId);
      expect(session?.notebookId).toBe(notebook1.id);
    });

    it('should throw errors for invalid transfers', async () => {
      const nonExistentSessionId = randomUUID();
      const nonExistentNotebookId = randomUUID();
      
      await expect(notebookService.transferChatToNotebook(nonExistentSessionId, notebook2.id))
        .rejects
        .toThrow(`Chat session not found with ID: ${nonExistentSessionId}`);
        
      await expect(notebookService.transferChatToNotebook(chatSession.sessionId, nonExistentNotebookId))
        .rejects
        .toThrow(`Target notebook not found with ID: ${nonExistentNotebookId}`);
    });
  });

  describe('Chunk management', () => {
    let notebook: NotebookRecord;
    let chunk: ObjectChunk;
    let jeffersObj: JeffersObject;

    beforeEach(async () => {
      notebook = await notebookService.createNotebook('NotebookForChunk', 'Desc');
      jeffersObj = (await objectModelCore.getBySourceUri(`enai://notebook/${notebook.id}`))!;
      
      const createdChunk = await chunkModel.addChunk({
        objectId: jeffersObj.id, 
        chunkIdx: 0,
        content: 'Test chunk for assignment',
      });
      chunk = createdChunk;
    });

    it('should assign and unassign chunks to notebook', async () => {
      // Assign chunk
      expect(await notebookService.assignChunkToNotebook(chunk.id, notebook.id)).toBe(true);
      let updatedChunk = await chunkModel.getById(chunk.id);
      expect(updatedChunk?.notebookId).toBe(notebook.id);

      // Unassign chunk
      expect(await notebookService.assignChunkToNotebook(chunk.id, null)).toBe(true);
      updatedChunk = await chunkModel.getById(chunk.id);
      expect(updatedChunk?.notebookId).toBeNull();
    });

    it('should handle invalid chunk assignments', async () => {
      const nonExistentNotebookId = randomUUID();
      await expect(notebookService.assignChunkToNotebook(chunk.id, nonExistentNotebookId))
        .rejects
        .toThrow(`Target notebook not found with ID: ${nonExistentNotebookId}`);

      // Non-existent chunk
      const result = await notebookService.assignChunkToNotebook(999999, notebook.id);
      expect(result).toBe(false);
    });

    it('should retrieve chunks for notebook', async () => {
      const notebook2 = await notebookService.createNotebook('NBWithoutChunks', 'Desc2');
      
      // Assign some chunks to notebook
      await chunkModel.assignToNotebook(chunk.id, notebook.id);
      const chunk2 = await chunkModel.addChunk({ objectId: jeffersObj.id, chunkIdx: 1, content: 'c2' });
      await chunkModel.assignToNotebook(chunk2.id, notebook.id);

      const chunks = await notebookService.getChunksForNotebook(notebook.id);
      expect(chunks).toHaveLength(2);
      
      const emptyChunks = await notebookService.getChunksForNotebook(notebook2.id);
      expect(emptyChunks).toHaveLength(0);
      
      await expect(notebookService.getChunksForNotebook(randomUUID()))
        .rejects
        .toThrow(/Notebook not found with ID:/);
    });
  });

  describe('BaseService integration', () => {
    it('should initialize with proper dependencies and inherit BaseService functionality', async () => {
      expect(notebookService).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith('NotebookService initialized');
      
      // Test execute wrapper
      const notebooks = await notebookService.getAllNotebooks();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[NotebookService] getAllNotebooks started')
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[NotebookService] getAllNotebooks completed')
      );
    });

    it('should handle lifecycle methods', async () => {
      const newService = new NotebookService({
        db,
        notebookModel,
        objectModelCore,
        objectCognitive,
        objectAssociation,
        chunkModel,
        chatModel,
        activityLogService,
        activityLogModel
      });
      
      await expect(newService.initialize()).resolves.toBeUndefined();
      await expect(newService.cleanup()).resolves.toBeUndefined();
      expect(await newService.healthCheck()).toBe(true);
    });

    it('should use execute wrapper for error handling', async () => {
      vi.spyOn(notebookModel, 'getAll').mockImplementation(() => {
        throw new Error('Database connection lost');
      });

      await expect(notebookService.getAllNotebooks()).rejects.toThrow('Database connection lost');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[NotebookService] getAllNotebooks failed'),
        expect.any(Error)
      );
    });

    it('should perform transactional operations correctly', async () => {
      // NotebookService uses manual transaction management with db.exec('BEGIN')
      // due to async model methods, so we spy on exec instead of transaction
      const execSpy = vi.spyOn(db, 'exec');
      const notebook = await notebookService.createNotebook('Transactional Test', 'Testing integrity');
      
      // Verify transaction was started and committed
      expect(execSpy).toHaveBeenCalledWith('BEGIN');
      expect(execSpy).toHaveBeenCalledWith('COMMIT');
      expect(notebook.id).toBeDefined();
      expect(notebook.objectId).toBeDefined();
      
      // Verify both entities exist
      const object = await objectModelCore.getById(notebook.objectId!);
      expect(object?.sourceUri).toBe(`enai://notebook/${notebook.id}`);
    });
  });

  describe('Object-Notebook Association with Cognitive Features', () => {
    let testObject: JeffersObject;
    let testNotebook: NotebookRecord;

    beforeEach(async () => {
      // Create test object and notebook using ObjectModel.create to ensure cognitive fields are initialized
      testObject = await objectModelCore.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com/test',
        title: 'Test Page',
        status: 'new',
        rawContentRef: null,
        cleanedText: null,
        parsedContentJson: null,
        errorInfo: null,
        parsedAt: null
      });
      
      testNotebook = await notebookService.createNotebook('Test Notebook', 'For association tests');
    });

    describe('assignObjectToNotebook', () => {
      it('should assign object to notebook with cognitive features', async () => {
        // Act
        await notebookService.assignObjectToNotebook(testObject.id, testNotebook.id, 0.85);

        // Assert - Check junction table
        const notebookIds = objectAssociation.getNotebookIdsForObject(testObject.id);
        expect(notebookIds).toContain(testNotebook.id);

        // Assert - Check relationships
        const updated = await objectModelCore.getById(testObject.id);
        expect(updated).toBeDefined();
        expect(updated!.objectRelationships).toBeDefined();
        const relationships = JSON.parse(updated!.objectRelationships!);
        const notebookRel = relationships.related.find((r: any) => r.to === testNotebook.id);
        
        expect(notebookRel).toBeDefined();
        expect(notebookRel.nature).toBe('notebook-membership');
        expect(notebookRel.topicAffinity).toBe(0.85);
        expect(notebookRel.strength).toBe(1.0);

        // Assert - Check biography event
        expect(updated!.objectBio).toBeDefined();
        const bio = JSON.parse(updated!.objectBio!);
        const addEvent = bio.events.find((e: any) => e.what === 'added-to-notebook');
        expect(addEvent).toBeDefined();
        expect(addEvent.withWhom).toContain(testNotebook.id);
        expect(addEvent.resulted).toBe(`Added to notebook ${testNotebook.id}`);

        // Assert - Check activity log was called
        expect(activityLogService.logActivity).toHaveBeenCalledWith({
          activityType: 'object_notebook_assignment',
          details: {
            objectId: testObject.id,
            notebookId: testNotebook.id,
            affinity: 0.85
          }
        });
      });

      it('should use default affinity if not provided', async () => {
        // Act
        await notebookService.assignObjectToNotebook(testObject.id, testNotebook.id);

        // Assert
        const updated = await objectModelCore.getById(testObject.id);
        const relationships = JSON.parse(updated!.objectRelationships!);
        const notebookRel = relationships.related.find((r: any) => r.to === testNotebook.id);
        
        expect(notebookRel.topicAffinity).toBe(0.5); // Default affinity
      });

      it('should throw if object does not exist', async () => {
        // Act & Assert
        await expect(notebookService.assignObjectToNotebook('non-existent', testNotebook.id))
          .rejects.toThrow('Object non-existent not found');
      });

      it('should throw if notebook does not exist', async () => {
        // Act & Assert
        await expect(notebookService.assignObjectToNotebook(testObject.id, 'non-existent'))
          .rejects.toThrow('Notebook non-existent not found');
      });
    });

    describe('removeObjectFromNotebook', () => {
      beforeEach(async () => {
        // Assign object to notebook first
        await notebookService.assignObjectToNotebook(testObject.id, testNotebook.id);
      });

      it('should remove object from notebook with cognitive cleanup', async () => {
        // Act
        await notebookService.removeObjectFromNotebook(testObject.id, testNotebook.id);

        // Assert - Check junction table
        const notebookIds = objectAssociation.getNotebookIdsForObject(testObject.id);
        expect(notebookIds).not.toContain(testNotebook.id);

        // Assert - Check relationships removed
        const updated = await objectModelCore.getById(testObject.id);
        const relationships = JSON.parse(updated!.objectRelationships!);
        const notebookRel = relationships.related.find((r: any) => r.to === testNotebook.id);
        expect(notebookRel).toBeUndefined();

        // Assert - Check biography event
        const bio = JSON.parse(updated!.objectBio!);
        const removeEvent = bio.events.find((e: any) => e.what === 'removed-from-notebook');
        expect(removeEvent).toBeDefined();
        expect(removeEvent.withWhom).toContain(testNotebook.id);
        expect(removeEvent.resulted).toBe(`Removed from notebook ${testNotebook.id}`);
      });

      it('should handle removing non-existent association gracefully', async () => {
        // Remove first
        await notebookService.removeObjectFromNotebook(testObject.id, testNotebook.id);

        // Remove again - should not throw
        await expect(notebookService.removeObjectFromNotebook(testObject.id, testNotebook.id))
          .resolves.not.toThrow();
      });
    });

    describe('Integration tests', () => {
      it('should handle complex object-notebook lifecycle', async () => {
        const notebook1 = await notebookService.createNotebook('Notebook 1');
        const notebook2 = await notebookService.createNotebook('Notebook 2');
        
        // Assign to multiple notebooks
        await notebookService.assignObjectToNotebook(testObject.id, notebook1.id, 0.7);
        await notebookService.assignObjectToNotebook(testObject.id, notebook2.id, 0.9);

        // Verify both associations exist
        const notebookIds = objectAssociation.getNotebookIdsForObject(testObject.id);
        expect(notebookIds).toHaveLength(2); // Just the 2 new ones
        expect(notebookIds).toContain(notebook1.id);
        expect(notebookIds).toContain(notebook2.id);

        // Verify relationships
        const obj = await objectModelCore.getById(testObject.id);
        const relationships = JSON.parse(obj!.objectRelationships!);
        expect(relationships.related).toHaveLength(2);

        // Remove from one notebook
        await notebookService.removeObjectFromNotebook(testObject.id, notebook1.id);

        // Verify only one association removed
        const updatedNotebookIds = objectAssociation.getNotebookIdsForObject(testObject.id);
        expect(updatedNotebookIds).toHaveLength(1);
        expect(updatedNotebookIds).not.toContain(notebook1.id);
        expect(updatedNotebookIds).toContain(notebook2.id);

        // Verify biography has all events
        const finalObj = await objectModelCore.getById(testObject.id);
        const bio = JSON.parse(finalObj!.objectBio!);
        const addEvents = bio.events.filter((e: any) => e.what === 'added-to-notebook');
        const removeEvents = bio.events.filter((e: any) => e.what === 'removed-from-notebook');
        
        expect(addEvents).toHaveLength(2);
        expect(removeEvents).toHaveLength(1);
      });
    });
  });
});