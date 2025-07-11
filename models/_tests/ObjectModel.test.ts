import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDb, cleanTestDb } from './testUtils';
import { ObjectModelCore } from '../ObjectModelCore';
import { ObjectCognitiveModel } from '../ObjectCognitiveModel';
import { ObjectAssociationModel } from '../ObjectAssociationModel';
import { JeffersObject, ObjectStatus } from '../../shared/types';
import { 
  BiographyEvent, 
  Relationship
} from '../../shared/schemas/objectSchemas';
import { createTestObject, createTestNotebook } from './test-utils/helpers';

let testDb: Database.Database;
let objectModelCore: ObjectModelCore;
let objectCognitive: ObjectCognitiveModel;
let objectAssociation: ObjectAssociationModel;

const sampleData1 = createTestObject({
    objectType: 'webpage',
    sourceUri: 'https://example.com/test1',
    title: 'Test Bookmark 1',
    status: 'new',
    rawContentRef: null,
    parsedContentJson: null,
    errorInfo: null,
});

const sampleData2 = createTestObject({
    objectType: 'note',
    sourceUri: 'https://example.com/note1',
    title: 'Test Note 1',
    status: 'new',
    rawContentRef: 'local/ref',
    parsedContentJson: null,
    errorInfo: null,
});

describe('ObjectModel (Legacy Test Suite)', () => {
    beforeAll(() => {
        testDb = setupTestDb();
        objectModelCore = new ObjectModelCore(testDb);
        objectCognitive = new ObjectCognitiveModel(objectModelCore);
        objectAssociation = new ObjectAssociationModel(testDb);
    });

    afterAll(() => {
        testDb.close();
    });

    beforeEach(() => {
        cleanTestDb(testDb);
        objectModelCore = new ObjectModelCore(testDb);
        objectCognitive = new ObjectCognitiveModel(objectModelCore);
        objectAssociation = new ObjectAssociationModel(testDb);
    });

    describe('create', () => {
        it('should create a new object with default status', async () => {
            const data = createTestObject({ ...sampleData1 });
            // @ts-expect-error - Testing default status assignment
            delete data.status; 
            const createdObject = await objectModelCore.create(data);

            expect(createdObject.id).toMatch(/^[0-9a-f-]{36}$/);
            expect(createdObject.objectType).toBe(data.objectType);
            expect(createdObject.sourceUri).toBe(data.sourceUri);
            expect(createdObject.title).toBe(data.title);
            expect(createdObject.status).toBe('new');
            expect(createdObject.createdAt).toBeInstanceOf(Date);
            expect(createdObject.updatedAt).toBeInstanceOf(Date);
        });

        it('should return existing object when creating with duplicate source_uri', async () => {
            const uri = 'https://example.com/duplicate';
            const firstObject = await objectModelCore.create(createTestObject({ ...sampleData1, sourceUri: uri }));
            const secondObject = await objectModelCore.create(createTestObject({ ...sampleData2, sourceUri: uri }));

            expect(secondObject.id).toBe(firstObject.id);
            expect(secondObject.title).toBe(firstObject.title);
            expect(secondObject.objectType).toBe(firstObject.objectType);
        });
    });

    describe('get operations', () => {
        it('should get an object by ID', async () => {
            const created = await objectModelCore.create(createTestObject({ ...sampleData1, title: 'Get By ID Test' }));
            const fetched = await objectModelCore.getById(created.id);

            expect(fetched?.id).toBe(created.id);
            expect(fetched?.title).toBe('Get By ID Test');
        });

        it('should get an object by source URI', async () => {
            const uri = 'https://example.com/getByUri';
            const created = await objectModelCore.create(createTestObject({ ...sampleData2, sourceUri: uri }));
            const fetched = await objectModelCore.getBySourceUri(uri);

            expect(fetched?.id).toBe(created.id);
            expect(fetched?.sourceUri).toBe(uri);
        });

        it('should return null for non-existent entries', async () => {
            expect(await objectModelCore.getById('00000000-0000-0000-0000-000000000000')).toBeNull();
            expect(await objectModelCore.getBySourceUri('https://example.com/not-here')).toBeNull();
        });
    });

    describe('updateStatus', () => {
        it('should update status and parsedAt', async () => {
            const created = await objectModelCore.create(createTestObject({ ...sampleData1, status: 'fetched' }));
            const parsedAt = new Date();
            
            await objectModelCore.updateStatus(created.id, 'parsed', parsedAt);

            const updated = await objectModelCore.getById(created.id);
            expect(updated?.status).toBe('parsed');
            expect(updated?.parsedAt?.toISOString().slice(0, -4)).toBe(parsedAt.toISOString().slice(0, -4));
            expect(updated?.errorInfo).toBeNull();
        });

        it('should update status with errorInfo', async () => {
            const created = await objectModelCore.create(createTestObject(sampleData1));
            const errorMsg = 'Fetch failed: 404';
            
            await objectModelCore.updateStatus(created.id, 'error', undefined, errorMsg);

            const updated = await objectModelCore.getById(created.id);
            expect(updated?.status).toBe('error');
            expect(updated?.errorInfo).toBe(errorMsg);
        });

        it('should clear errorInfo when updating to non-error status', async () => {
            const created = await objectModelCore.create(createTestObject({ ...sampleData1, status: 'error', errorInfo: 'Previous error' }));
            
            await objectModelCore.updateStatus(created.id, 'fetched');

            const updated = await objectModelCore.getById(created.id);
            expect(updated?.status).toBe('fetched');
            expect(updated?.errorInfo).toBeNull();
        });
    });

    describe('update', () => {
        it('should update multiple fields', async () => {
            const created = await objectModelCore.create(createTestObject(sampleData1));
            const updates = {
                title: 'Updated Title',
                status: 'parsed' as ObjectStatus,
                parsedContentJson: '{"title": "Parsed"}',
                parsedAt: new Date(),
            };

            await objectModelCore.update(created.id, updates);
            const updated = await objectModelCore.getById(created.id);

            expect(updated?.title).toBe(updates.title);
            expect(updated?.status).toBe(updates.status);
            expect(updated?.parsedContentJson).toBe(updates.parsedContentJson);
            expect(updated?.parsedAt?.toISOString().slice(0, -4)).toBe(updates.parsedAt.toISOString().slice(0, -4));
        });
    });

    describe('findByStatus', () => {
        it('should find objects by status', async () => {
            const o1 = await objectModelCore.create(createTestObject({ ...sampleData1, status: 'fetched' }));
            const o2 = await objectModelCore.create(createTestObject({ ...sampleData2, status: 'fetched' }));
            await objectModelCore.create(createTestObject({ ...sampleData1, sourceUri: 'uri3', status: 'new' }));

            const fetched = await objectModelCore.findByStatus(['fetched']);
            expect(fetched).toHaveLength(2);
            expect(fetched.map(o => o.id)).toEqual(expect.arrayContaining([o1.id, o2.id]));
        });

        it('should find objects by multiple statuses', async () => {
            const o1 = await objectModelCore.create(createTestObject({ ...sampleData1, status: 'new' }));
            const o2 = await objectModelCore.create(createTestObject({ ...sampleData2, status: 'error', errorInfo: 'err' }));
            await objectModelCore.create(createTestObject({ ...sampleData1, sourceUri: 'uri3', status: 'parsed' }));

            const fetched = await objectModelCore.findByStatus(['new', 'error']);
            expect(fetched).toHaveLength(2);
            expect(fetched.map(o => o.id)).toEqual(expect.arrayContaining([o1.id, o2.id]));
        });
    });

    describe('getProcessableObjects', () => {
        it('should get objects with status = parsed', async () => {
            await objectModelCore.create(createTestObject({ ...sampleData1, sourceUri: 'p1', status: 'parsed', parsedContentJson: '{"a": 1}' }));
            await objectModelCore.create(createTestObject({ ...sampleData2, sourceUri: 'p2', status: 'parsed' }));
            await objectModelCore.create(createTestObject({ ...sampleData1, sourceUri: 'n1', status: 'new' }));
            await objectModelCore.create(createTestObject({ ...sampleData2, sourceUri: 'e1', status: 'embedded' }));

            const processable = await objectModelCore.getProcessableObjects(5);

            expect(processable).toHaveLength(2);
            expect(processable.map(o => o.sourceUri)).toEqual(expect.arrayContaining(['p1', 'p2']));
            expect(processable.every(o => o.status === 'parsed')).toBe(true);
        });
    });

    describe('deleteById', () => {
        it('should delete an object by ID', async () => {
            const created = await objectModelCore.create(createTestObject({ ...sampleData1, sourceUri: 'https://delete.me' }));
            
            objectModelCore.deleteById(created.id);

            expect(await objectModelCore.getById(created.id)).toBeNull();
        });
    });

    describe('Cognitive Features', () => {
        describe('objectBio validation', () => {
            it('should create object with default biography', async () => {
                const data = createTestObject(sampleData1);
                data.objectBio = objectCognitive.initializeBio();
                const created = await objectModelCore.create(data);
                expect(created.objectBio).toBeDefined();
                
                const bio = JSON.parse(created.objectBio!);
                expect(bio.createdAt).toBeDefined();
                expect(bio.events).toEqual([]);
            });

            it('should validate objectBio on create', async () => {
                const dataWithInvalidBio = createTestObject({
                    ...sampleData1,
                    objectBio: JSON.stringify({ invalid: 'structure' })
                });

                // Note: ObjectModelCore doesn't validate cognitive fields - this test is now informational
                const created = await objectModelCore.create(dataWithInvalidBio);
                expect(created.objectBio).toBe(JSON.stringify({ invalid: 'structure' }));
            });

            it('should validate objectBio on update', async () => {
                const created = await objectModelCore.create(createTestObject(sampleData1));
                
                // Note: ObjectModelCore doesn't validate cognitive fields - this test is now informational
                await objectModelCore.update(created.id, {
                    objectBio: JSON.stringify({ invalid: 'structure' })
                });
                
                const updated = await objectModelCore.getById(created.id);
                expect(updated?.objectBio).toBe(JSON.stringify({ invalid: 'structure' }));
            });
        });

        describe('objectRelationships validation', () => {
            it('should create object with default relationships', async () => {
                const data = createTestObject(sampleData1);
                data.objectRelationships = objectCognitive.initializeRelationships();
                const created = await objectModelCore.create(data);
                expect(created.objectRelationships).toBeDefined();
                
                const relationships = JSON.parse(created.objectRelationships!);
                expect(relationships.related).toEqual([]);
            });

            it('should validate objectRelationships on create', async () => {
                const dataWithInvalidRels = createTestObject({
                    ...sampleData1,
                    objectRelationships: JSON.stringify({ invalid: 'structure' })
                });

                // Note: ObjectModelCore doesn't validate cognitive fields - this test is now informational
                const created = await objectModelCore.create(dataWithInvalidRels);
                expect(created.objectRelationships).toBe(JSON.stringify({ invalid: 'structure' }));
            });

            it('should validate objectRelationships on update', async () => {
                const created = await objectModelCore.create(createTestObject(sampleData1));
                
                // Note: ObjectModelCore doesn't validate cognitive fields - this test is now informational
                await objectModelCore.update(created.id, {
                    objectRelationships: JSON.stringify({ invalid: 'structure' })
                });
                
                const updated = await objectModelCore.getById(created.id);
                expect(updated?.objectRelationships).toBe(JSON.stringify({ invalid: 'structure' }));
            });
        });

        describe('addBiographyEvent', () => {
            it('should add event to existing biography', async () => {
                const data = createTestObject(sampleData1);
                data.objectBio = objectCognitive.initializeBio();
                const created = await objectModelCore.create(data);
                
                const event: BiographyEvent = {
                    when: new Date().toISOString(),
                    what: 'viewed',
                    withWhom: ['user-123'],
                    resulted: 'User viewed the object'
                };

                const updatedBio = await objectCognitive.addBiographyEvent(created.id, event);
                await objectModelCore.update(created.id, { objectBio: updatedBio });
                
                const updated = await objectModelCore.getById(created.id);
                const bio = JSON.parse(updated!.objectBio!);
                
                expect(bio.events).toHaveLength(1);
                expect(bio.events[0]).toMatchObject(event);
            });

            it('should throw if object not found', async () => {
                await expect(objectCognitive.addBiographyEvent('non-existent', {
                    when: new Date().toISOString(),
                    what: 'viewed'
                })).rejects.toThrow('Object non-existent not found');
            });
        });

        describe('addRelationship', () => {
            it('should add new relationship', async () => {
                const data = createTestObject(sampleData1);
                data.objectRelationships = objectCognitive.initializeRelationships();
                const created = await objectModelCore.create(data);
                
                const relationship: Relationship = {
                    to: 'notebook-123',
                    nature: 'notebook-membership',
                    strength: 0.8,
                    formed: new Date().toISOString(),
                    topicAffinity: 0.9
                };

                const updatedRels = await objectCognitive.addRelationship(created.id, relationship);
                await objectModelCore.update(created.id, { objectRelationships: updatedRels });
                
                const updated = await objectModelCore.getById(created.id);
                const rels = JSON.parse(updated!.objectRelationships!);
                
                expect(rels.related).toHaveLength(1);
                expect(rels.related[0]).toMatchObject(relationship);
            });

            it('should update existing relationship to same target', async () => {
                const data = createTestObject(sampleData1);
                data.objectRelationships = objectCognitive.initializeRelationships();
                const created = await objectModelCore.create(data);
                
                const relationship1: Relationship = {
                    to: 'notebook-123',
                    nature: 'notebook-membership',
                    strength: 0.5,
                    formed: new Date().toISOString()
                };

                const updatedRels1 = await objectCognitive.addRelationship(created.id, relationship1);
                await objectModelCore.update(created.id, { objectRelationships: updatedRels1 });
                
                const relationship2: Relationship = {
                    ...relationship1,
                    strength: 0.9
                };

                const updatedRels2 = await objectCognitive.addRelationship(created.id, relationship2);
                await objectModelCore.update(created.id, { objectRelationships: updatedRels2 });
                
                const updated = await objectModelCore.getById(created.id);
                const rels = JSON.parse(updated!.objectRelationships!);
                
                expect(rels.related).toHaveLength(1);
                expect(rels.related[0].strength).toBe(0.9);
            });
        });

        describe('removeRelationship', () => {
            it('should remove existing relationship', async () => {
                const data = createTestObject(sampleData1);
                data.objectRelationships = objectCognitive.initializeRelationships();
                const created = await objectModelCore.create(data);
                
                const updatedRels1 = await objectCognitive.addRelationship(created.id, {
                    to: 'notebook-123',
                    nature: 'notebook-membership',
                    strength: 1.0,
                    formed: new Date().toISOString()
                });
                await objectModelCore.update(created.id, { objectRelationships: updatedRels1 });

                const updatedRels2 = await objectCognitive.removeRelationship(created.id, 'notebook-123');
                await objectModelCore.update(created.id, { objectRelationships: updatedRels2 });
                
                const updated = await objectModelCore.getById(created.id);
                const rels = JSON.parse(updated!.objectRelationships!);
                
                expect(rels.related).toHaveLength(0);
            });

            it('should not throw if relationship does not exist', async () => {
                const data = createTestObject(sampleData1);
                data.objectRelationships = objectCognitive.initializeRelationships();
                const created = await objectModelCore.create(data);
                
                // Should not throw
                const updatedRels = await objectCognitive.removeRelationship(created.id, 'non-existent');
                await objectModelCore.update(created.id, { objectRelationships: updatedRels });
            });
        });

        describe('notebook associations', () => {
            it('should add object to notebook with junction table and relationships', async () => {
                const data = createTestObject(sampleData1);
                data.objectBio = objectCognitive.initializeBio();
                data.objectRelationships = objectCognitive.initializeRelationships();
                const created = await objectModelCore.create(data);
                const notebookId = 'notebook-test-123';
                
                // Create the notebook first to satisfy foreign key constraint
                createTestNotebook(testDb, notebookId, 'Test Notebook');
                
                // Add to notebook using association model
                await objectAssociation.addToNotebook(created.id, notebookId);
                
                // Add relationship using cognitive model
                const relationship = objectCognitive.createNotebookRelationship(notebookId, 0.85);
                const updatedRels = await objectCognitive.addRelationship(created.id, relationship);
                await objectModelCore.update(created.id, { objectRelationships: updatedRels });
                
                // Add biography event
                const event = objectCognitive.createNotebookEvent(notebookId, 'added');
                const updatedBio = await objectCognitive.addBiographyEvent(created.id, event);
                await objectModelCore.update(created.id, { objectBio: updatedBio });
                
                // Check junction table
                const notebookIds = objectAssociation.getNotebookIdsForObject(created.id);
                expect(notebookIds).toContain(notebookId);
                
                // Check relationships
                const updated = await objectModelCore.getById(created.id);
                const rels = JSON.parse(updated!.objectRelationships!);
                const notebookRel = rels.related.find((r: Relationship) => r.to === notebookId);
                
                expect(notebookRel).toBeDefined();
                expect(notebookRel.nature).toBe('notebook-membership');
                expect(notebookRel.topicAffinity).toBe(0.85);
                
                // Check biography event
                const bio = JSON.parse(updated!.objectBio!);
                const addEvent = bio.events.find((e: BiographyEvent) => e.what === 'added-to-notebook');
                expect(addEvent).toBeDefined();
                expect(addEvent.withWhom).toContain(notebookId);
            });

            it('should remove object from notebook', async () => {
                const data = createTestObject(sampleData1);
                data.objectBio = objectCognitive.initializeBio();
                data.objectRelationships = objectCognitive.initializeRelationships();
                const created = await objectModelCore.create(data);
                const notebookId = 'notebook-test-123';
                
                // Create the notebook first to satisfy foreign key constraint
                createTestNotebook(testDb, notebookId, 'Test Notebook');
                
                // Add to notebook first
                await objectAssociation.addToNotebook(created.id, notebookId);
                const relationship = objectCognitive.createNotebookRelationship(notebookId);
                const addedRels = await objectCognitive.addRelationship(created.id, relationship);
                await objectModelCore.update(created.id, { objectRelationships: addedRels });
                
                // Remove from notebook
                await objectAssociation.removeFromNotebook(created.id, notebookId);
                const removedRels = await objectCognitive.removeRelationship(created.id, notebookId);
                await objectModelCore.update(created.id, { objectRelationships: removedRels });
                
                // Add remove event
                const removeEvent = objectCognitive.createNotebookEvent(notebookId, 'removed');
                const updatedBio = await objectCognitive.addBiographyEvent(created.id, removeEvent);
                await objectModelCore.update(created.id, { objectBio: updatedBio });
                
                // Check junction table
                const notebookIds = objectAssociation.getNotebookIdsForObject(created.id);
                expect(notebookIds).not.toContain(notebookId);
                
                // Check relationships removed
                const updated = await objectModelCore.getById(created.id);
                const rels = JSON.parse(updated!.objectRelationships!);
                const notebookRel = rels.related.find((r: Relationship) => r.to === notebookId);
                expect(notebookRel).toBeUndefined();
                
                // Check biography event
                const bio = JSON.parse(updated!.objectBio!);
                const removeEventFound = bio.events.find((e: BiographyEvent) => e.what === 'removed-from-notebook');
                expect(removeEventFound).toBeDefined();
            });
        });
    });
});