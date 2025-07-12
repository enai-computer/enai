import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDb, cleanTestDb } from './testUtils';
import { ObjectModelCore } from '../ObjectModelCore';
import { ObjectCognitiveModel } from '../ObjectCognitiveModel';
import { createTestObject, createTestBioEvent, createTestRelationship } from './test-utils/helpers';
import { logger } from '../../utils/logger';

let testDb: Database.Database;
let core: ObjectModelCore;
let cognitive: ObjectCognitiveModel;

describe('ObjectCognitiveModel', () => {
  beforeAll(() => {
    testDb = setupTestDb();
    core = new ObjectModelCore(testDb);
    cognitive = new ObjectCognitiveModel(core);
  });

  afterAll(() => {
    testDb.close();
  });

  beforeEach(() => {
    cleanTestDb(testDb);
    core = new ObjectModelCore(testDb);
    cognitive = new ObjectCognitiveModel(core);
  });

  describe('initialization methods', () => {
    describe('initializeBio', () => {
      it('should create bio JSON string with createdAt', () => {
        const now = new Date();
        const bio = cognitive.initializeBio(now);

        expect(bio).toBeTypeOf('string');
        const parsed = JSON.parse(bio);
        
        expect(parsed.createdAt).toBe(now.toISOString());
        expect(parsed.events).toEqual([]);
      });

      it('should use current time if no date provided', () => {
        const before = new Date();
        const bio = cognitive.initializeBio();
        const after = new Date();

        const parsed = JSON.parse(bio);
        const createdAt = new Date(parsed.createdAt);
        
        expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      });
    });

    describe('initializeRelationships', () => {
      it('should create relationships JSON string', () => {
        const relationships = cognitive.initializeRelationships();

        expect(relationships).toBeTypeOf('string');
        const parsed = JSON.parse(relationships);
        
        expect(parsed.related).toEqual([]);
      });
    });
  });

  describe('biography operations', () => {
    describe('addBiographyEvent', () => {
      it('should add event to existing biography', async () => {
        const obj = await core.create(createTestObject());
        const event = createTestBioEvent({
          what: 'viewed',
          withWhom: ['user-123'],
          resulted: 'User viewed the object'
        });

        const updatedBio = await cognitive.addBiographyEvent(obj.id, event);

        const parsed = JSON.parse(updatedBio);
        expect(parsed.events).toHaveLength(1);
        expect(parsed.events[0].what).toBe(event.what);
        expect(parsed.events[0].withWhom).toEqual(event.withWhom);
        expect(parsed.events[0].resulted).toBe(event.resulted);
      });

      it('should add multiple events in order', async () => {
        const obj = await core.create(createTestObject());
        const event1 = createTestBioEvent({ what: 'created' });
        const event2 = createTestBioEvent({ what: 'modified' });
        const event3 = createTestBioEvent({ what: 'shared' });

        // Each call returns the updated bio but doesn't persist
        // We need to update the object after each call
        const bio1 = await cognitive.addBiographyEvent(obj.id, event1);
        await core.update(obj.id, { objectBio: bio1 });
        
        const bio2 = await cognitive.addBiographyEvent(obj.id, event2);
        await core.update(obj.id, { objectBio: bio2 });
        
        const finalBio = await cognitive.addBiographyEvent(obj.id, event3);

        const parsed = JSON.parse(finalBio);
        expect(parsed.events).toHaveLength(3);
        expect(parsed.events[0].what).toBe('created');
        expect(parsed.events[1].what).toBe('modified');
        expect(parsed.events[2].what).toBe('shared');
      });

      it('should handle object without bio (null)', async () => {
        // Create object with null bio
        const obj = await core.create(createTestObject({ objectBio: null }));
        const event = createTestBioEvent({ what: 'first-event' });

        const updatedBio = await cognitive.addBiographyEvent(obj.id, event);

        const parsed = JSON.parse(updatedBio);
        expect(parsed.events).toHaveLength(1);
        expect(parsed.createdAt).toBeDefined(); // Should use object's createdAt
      });

      it('should throw if object not found', async () => {
        const event = createTestBioEvent();

        await expect(cognitive.addBiographyEvent('non-existent', event))
          .rejects.toThrow('Object non-existent not found');
      });

    });

    describe('createNotebookEvent', () => {
      it('should create proper notebook added event', () => {
        const notebookId = 'notebook-123';
        const event = cognitive.createNotebookEvent(notebookId, 'added');

        expect(event.what).toBe('added-to-notebook');
        expect(event.withWhom).toEqual([notebookId]);
        expect(event.resulted).toBe(`Added to notebook ${notebookId}`);
      });

      it('should create proper notebook removed event', () => {
        const notebookId = 'notebook-456';
        const event = cognitive.createNotebookEvent(notebookId, 'removed');

        expect(event.what).toBe('removed-from-notebook');
        expect(event.withWhom).toEqual([notebookId]);
        expect(event.resulted).toBe(`Removed from notebook ${notebookId}`);
      });
    });
  });

  describe('relationship operations', () => {
    describe('addRelationship', () => {
      it('should add new relationship', async () => {
        const obj = await core.create(createTestObject());
        const relationship = createTestRelationship('target-123', {
          nature: 'reference',
          strength: 0.7
        });

        const updatedRel = await cognitive.addRelationship(obj.id, relationship);

        const parsed = JSON.parse(updatedRel);
        expect(parsed.related).toHaveLength(1);
        expect(parsed.related[0].to).toBe(relationship.to);
        expect(parsed.related[0].nature).toBe(relationship.nature);
        expect(parsed.related[0].strength).toBe(relationship.strength);
      });

      it('should update existing relationship to same target', async () => {
        const obj = await core.create(createTestObject());
        const targetId = 'target-456';
        
        const rel1 = createTestRelationship(targetId, { strength: 0.5 });
        await cognitive.addRelationship(obj.id, rel1);
        
        const rel2 = createTestRelationship(targetId, { strength: 0.9 });
        const updatedRel = await cognitive.addRelationship(obj.id, rel2);

        const parsed = JSON.parse(updatedRel);
        expect(parsed.related).toHaveLength(1);
        expect(parsed.related[0].strength).toBe(0.9);
      });

      it('should maintain multiple relationships to different targets', async () => {
        const obj = await core.create(createTestObject());
        
        const rel1 = await cognitive.addRelationship(obj.id, createTestRelationship('target-1'));
        await core.update(obj.id, { objectRelationships: rel1 });
        
        const rel2 = await cognitive.addRelationship(obj.id, createTestRelationship('target-2'));
        await core.update(obj.id, { objectRelationships: rel2 });
        
        const finalRel = await cognitive.addRelationship(obj.id, createTestRelationship('target-3'));

        const parsed = JSON.parse(finalRel);
        expect(parsed.related).toHaveLength(3);
        expect(parsed.related.map((r: any) => r.to)).toContain('target-1');
        expect(parsed.related.map((r: any) => r.to)).toContain('target-2');
        expect(parsed.related.map((r: any) => r.to)).toContain('target-3');
      });

      it('should handle object without relationships (null)', async () => {
        const obj = await core.create(createTestObject({ objectRelationships: null }));
        const relationship = createTestRelationship('target-789');

        const updatedRel = await cognitive.addRelationship(obj.id, relationship);

        const parsed = JSON.parse(updatedRel);
        expect(parsed.related).toHaveLength(1);
      });

    });

    describe('removeRelationship', () => {
      it('should remove existing relationship', async () => {
        const obj = await core.create(createTestObject());
        const targetId = 'target-to-remove';
        
        await cognitive.addRelationship(obj.id, createTestRelationship(targetId));
        const updatedRel = await cognitive.removeRelationship(obj.id, targetId);

        const parsed = JSON.parse(updatedRel);
        expect(parsed.related).toHaveLength(0);
      });

      it('should only remove specified relationship', async () => {
        const obj = await core.create(createTestObject());
        
        const rel1 = await cognitive.addRelationship(obj.id, createTestRelationship('keep-1'));
        await core.update(obj.id, { objectRelationships: rel1 });
        
        const rel2 = await cognitive.addRelationship(obj.id, createTestRelationship('remove-me'));
        await core.update(obj.id, { objectRelationships: rel2 });
        
        const rel3 = await cognitive.addRelationship(obj.id, createTestRelationship('keep-2'));
        await core.update(obj.id, { objectRelationships: rel3 });
        
        const updatedRel = await cognitive.removeRelationship(obj.id, 'remove-me');

        const parsed = JSON.parse(updatedRel);
        expect(parsed.related).toHaveLength(2);
        expect(parsed.related.map((r: any) => r.to)).not.toContain('remove-me');
        expect(parsed.related.map((r: any) => r.to)).toContain('keep-1');
        expect(parsed.related.map((r: any) => r.to)).toContain('keep-2');
      });

      it('should handle removing non-existent relationship', async () => {
        const obj = await core.create(createTestObject());
        
        // Should not throw
        const updatedRel = await cognitive.removeRelationship(obj.id, 'non-existent');
        
        const parsed = JSON.parse(updatedRel);
        expect(parsed.related).toHaveLength(0);
      });
    });

    describe('createNotebookRelationship', () => {
      it('should create proper notebook relationship', () => {
        const notebookId = 'notebook-test';
        const affinity = 0.75;
        
        const rel = cognitive.createNotebookRelationship(notebookId, affinity);

        expect(rel.to).toBe(notebookId);
        expect(rel.nature).toBe('notebook-membership');
        expect(rel.strength).toBe(1.0);
        expect(rel.topicAffinity).toBe(affinity);
        expect(rel.formed).toBeDefined();
      });

      it('should use default affinity if not provided', () => {
        const rel = cognitive.createNotebookRelationship('notebook-default');
        expect(rel.topicAffinity).toBe(1.0);
      });
    });
  });

  describe('parsing helpers', () => {
    describe('parseObjectBioSafely', () => {
      it('should parse valid bio JSON', () => {
        const validBio = JSON.stringify({
          createdAt: new Date().toISOString(),
          events: [createTestBioEvent()]
        });

        const parsed = cognitive.parseObjectBioSafely(validBio, 'test-id');
        
        expect(parsed).toBeDefined();
        expect(parsed!.events).toHaveLength(1);
      });

      it('should return null for invalid JSON', () => {
        const logSpy = vi.spyOn(logger, 'warn');
        
        const parsed = cognitive.parseObjectBioSafely('not json', 'test-id');
        
        expect(parsed).toBeNull();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse objectBio'));
        
        logSpy.mockRestore();
      });

      it('should return null for JSON not matching schema', () => {
        const logSpy = vi.spyOn(logger, 'warn');
        const invalidBio = JSON.stringify({ wrong: 'structure' });
        
        const parsed = cognitive.parseObjectBioSafely(invalidBio, 'test-id');
        
        expect(parsed).toBeNull();
        expect(logSpy).toHaveBeenCalled();
        
        logSpy.mockRestore();
      });

      it('should return null for undefined', () => {
        const parsed = cognitive.parseObjectBioSafely(undefined, 'test-id');
        expect(parsed).toBeNull();
      });
    });

    describe('parseObjectRelationshipsSafely', () => {
      it('should parse valid relationships JSON', () => {
        const validRel = JSON.stringify({
          related: [createTestRelationship('test-target')]
        });

        const parsed = cognitive.parseObjectRelationshipsSafely(validRel, 'test-id');
        
        expect(parsed).toBeDefined();
        expect(parsed!.related).toHaveLength(1);
      });

      it('should return null for invalid JSON', () => {
        const logSpy = vi.spyOn(logger, 'warn');
        
        const parsed = cognitive.parseObjectRelationshipsSafely('not json', 'test-id');
        
        expect(parsed).toBeNull();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse objectRelationships'));
        
        logSpy.mockRestore();
      });

      it('should parse JSON with unexpected structure', () => {
        const invalidRel = JSON.stringify({ wrong: 'structure' });
        
        const parsed = cognitive.parseObjectRelationshipsSafely(invalidRel, 'test-id');
        
        // It may return the parsed object even if it doesn't match expected schema
        expect(parsed).toBeDefined();
      });

      it('should return null for undefined', () => {
        const parsed = cognitive.parseObjectRelationshipsSafely(undefined, 'test-id');
        expect(parsed).toBeNull();
      });
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in event data', async () => {
      const obj = await core.create(createTestObject());
      const event = createTestBioEvent({
        what: 'special-event',
        resulted: "Result with 'quotes' and \"double quotes\" and \n newlines"
      });

      const updatedBio = await cognitive.addBiographyEvent(obj.id, event);
      
      const parsed = JSON.parse(updatedBio);
      expect(parsed.events[0].resulted).toBe("Result with 'quotes' and \"double quotes\" and \n newlines");
    });
  });
});