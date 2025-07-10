import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDb, cleanTestDb } from './testUtils';
import { ObjectModel } from '../ObjectModel';
import { JeffersObject, ObjectStatus } from '../../shared/types';
import { 
  BiographyEvent, 
  Relationship,
  createDefaultObjectBio,
  createDefaultObjectRelationships 
} from '../../shared/schemas/objectSchemas';

let testDb: Database.Database;
let testObjectModel: ObjectModel;

const sampleData1: Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'> = {
    objectType: 'webpage',
    sourceUri: 'https://example.com/test1',
    title: 'Test Bookmark 1',
    status: 'new',
    rawContentRef: null,
    parsedContentJson: null,
    errorInfo: null,
};

const sampleData2: Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'> = {
    objectType: 'note',
    sourceUri: 'https://example.com/note1',
    title: 'Test Note 1',
    status: 'new',
    rawContentRef: 'local/ref',
    parsedContentJson: null,
    errorInfo: null,
};

describe('ObjectModel', () => {
    beforeAll(() => {
        testDb = setupTestDb();
        testObjectModel = new ObjectModel(testDb);
    });

    afterAll(() => {
        testDb.close();
    });

    beforeEach(() => {
        cleanTestDb(testDb);
        testObjectModel = new ObjectModel(testDb);
    });

    describe('create', () => {
        it('should create a new object with default status', async () => {
            const data = { ...sampleData1 };
            // @ts-expect-error - Testing default status assignment
            delete data.status; 
            const createdObject = await testObjectModel.create(data);

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
            const firstObject = await testObjectModel.create({ ...sampleData1, sourceUri: uri });
            const secondObject = await testObjectModel.create({ ...sampleData2, sourceUri: uri });

            expect(secondObject.id).toBe(firstObject.id);
            expect(secondObject.title).toBe(firstObject.title);
            expect(secondObject.objectType).toBe(firstObject.objectType);
        });
    });

    describe('get operations', () => {
        it('should get an object by ID', async () => {
            const created = await testObjectModel.create({ ...sampleData1, title: 'Get By ID Test' });
            const fetched = await testObjectModel.getById(created.id);

            expect(fetched?.id).toBe(created.id);
            expect(fetched?.title).toBe('Get By ID Test');
        });

        it('should get an object by source URI', async () => {
            const uri = 'https://example.com/getByUri';
            const created = await testObjectModel.create({ ...sampleData2, sourceUri: uri });
            const fetched = await testObjectModel.getBySourceUri(uri);

            expect(fetched?.id).toBe(created.id);
            expect(fetched?.sourceUri).toBe(uri);
        });

        it('should return null for non-existent entries', async () => {
            expect(await testObjectModel.getById('00000000-0000-0000-0000-000000000000')).toBeNull();
            expect(await testObjectModel.getBySourceUri('https://example.com/not-here')).toBeNull();
        });
    });

    describe('updateStatus', () => {
        it('should update status and parsedAt', async () => {
            const created = await testObjectModel.create({ ...sampleData1, status: 'fetched' });
            const parsedAt = new Date();
            
            await testObjectModel.updateStatus(created.id, 'parsed', parsedAt);

            const updated = await testObjectModel.getById(created.id);
            expect(updated?.status).toBe('parsed');
            expect(updated?.parsedAt?.toISOString().slice(0, -4)).toBe(parsedAt.toISOString().slice(0, -4));
            expect(updated?.errorInfo).toBeNull();
        });

        it('should update status with errorInfo', async () => {
            const created = await testObjectModel.create(sampleData1);
            const errorMsg = 'Fetch failed: 404';
            
            await testObjectModel.updateStatus(created.id, 'error', undefined, errorMsg);

            const updated = await testObjectModel.getById(created.id);
            expect(updated?.status).toBe('error');
            expect(updated?.errorInfo).toBe(errorMsg);
        });

        it('should clear errorInfo when updating to non-error status', async () => {
            const created = await testObjectModel.create({ ...sampleData1, status: 'error', errorInfo: 'Previous error' });
            
            await testObjectModel.updateStatus(created.id, 'fetched');

            const updated = await testObjectModel.getById(created.id);
            expect(updated?.status).toBe('fetched');
            expect(updated?.errorInfo).toBeNull();
        });
    });

    describe('update', () => {
        it('should update multiple fields', async () => {
            const created = await testObjectModel.create(sampleData1);
            const updates = {
                title: 'Updated Title',
                status: 'parsed' as ObjectStatus,
                parsedContentJson: '{"title": "Parsed"}',
                parsedAt: new Date(),
            };

            await testObjectModel.update(created.id, updates);
            const updated = await testObjectModel.getById(created.id);

            expect(updated?.title).toBe(updates.title);
            expect(updated?.status).toBe(updates.status);
            expect(updated?.parsedContentJson).toBe(updates.parsedContentJson);
            expect(updated?.parsedAt?.toISOString().slice(0, -4)).toBe(updates.parsedAt.toISOString().slice(0, -4));
        });
    });

    describe('findByStatus', () => {
        it('should find objects by status', async () => {
            const o1 = await testObjectModel.create({ ...sampleData1, status: 'fetched' });
            const o2 = await testObjectModel.create({ ...sampleData2, status: 'fetched' });
            await testObjectModel.create({ ...sampleData1, sourceUri: 'uri3', status: 'new' });

            const fetched = await testObjectModel.findByStatus(['fetched']);
            expect(fetched).toHaveLength(2);
            expect(fetched.map(o => o.id)).toEqual(expect.arrayContaining([o1.id, o2.id]));
        });

        it('should find objects by multiple statuses', async () => {
            const o1 = await testObjectModel.create({ ...sampleData1, status: 'new' });
            const o2 = await testObjectModel.create({ ...sampleData2, status: 'error', errorInfo: 'err' });
            await testObjectModel.create({ ...sampleData1, sourceUri: 'uri3', status: 'parsed' });

            const fetched = await testObjectModel.findByStatus(['new', 'error']);
            expect(fetched).toHaveLength(2);
            expect(fetched.map(o => o.id)).toEqual(expect.arrayContaining([o1.id, o2.id]));
        });
    });

    describe('getProcessableObjects', () => {
        it('should get objects with status = parsed', async () => {
            await testObjectModel.create({ ...sampleData1, sourceUri: 'p1', status: 'parsed', parsedContentJson: '{"a": 1}' });
            await testObjectModel.create({ ...sampleData2, sourceUri: 'p2', status: 'parsed' });
            await testObjectModel.create({ ...sampleData1, sourceUri: 'n1', status: 'new' });
            await testObjectModel.create({ ...sampleData2, sourceUri: 'e1', status: 'embedded' });

            const processable = await testObjectModel.getProcessableObjects(5);

            expect(processable).toHaveLength(2);
            expect(processable.map(o => o.sourceUri)).toEqual(expect.arrayContaining(['p1', 'p2']));
            expect(processable.every(o => o.status === 'parsed')).toBe(true);
        });
    });

    describe('deleteById', () => {
        it('should delete an object by ID', async () => {
            const created = await testObjectModel.create({ ...sampleData1, sourceUri: 'https://delete.me' });
            
            await testObjectModel.deleteById(created.id);

            expect(await testObjectModel.getById(created.id)).toBeNull();
        });
    });

    describe('Cognitive Features', () => {
        describe('objectBio validation', () => {
            it('should create object with default biography', async () => {
                const created = await testObjectModel.create(sampleData1);
                expect(created.objectBio).toBeDefined();
                
                const bio = JSON.parse(created.objectBio!);
                expect(bio.createdAt).toBeDefined();
                expect(bio.events).toEqual([]);
            });

            it('should validate objectBio on create', async () => {
                const dataWithInvalidBio = {
                    ...sampleData1,
                    objectBio: JSON.stringify({ invalid: 'structure' })
                };

                await expect(testObjectModel.create(dataWithInvalidBio)).rejects.toThrow('Invalid objectBio');
            });

            it('should validate objectBio on update', async () => {
                const created = await testObjectModel.create(sampleData1);
                
                await expect(testObjectModel.update(created.id, {
                    objectBio: JSON.stringify({ invalid: 'structure' })
                })).rejects.toThrow('Invalid objectBio');
            });
        });

        describe('objectRelationships validation', () => {
            it('should create object with default relationships', async () => {
                const created = await testObjectModel.create(sampleData1);
                expect(created.objectRelationships).toBeDefined();
                
                const relationships = JSON.parse(created.objectRelationships!);
                expect(relationships.related).toEqual([]);
            });

            it('should validate objectRelationships on create', async () => {
                const dataWithInvalidRels = {
                    ...sampleData1,
                    objectRelationships: JSON.stringify({ invalid: 'structure' })
                };

                await expect(testObjectModel.create(dataWithInvalidRels)).rejects.toThrow('Invalid objectRelationships');
            });

            it('should validate objectRelationships on update', async () => {
                const created = await testObjectModel.create(sampleData1);
                
                await expect(testObjectModel.update(created.id, {
                    objectRelationships: JSON.stringify({ invalid: 'structure' })
                })).rejects.toThrow('Invalid objectRelationships');
            });
        });

        describe('addBiographyEvent', () => {
            it('should add event to existing biography', async () => {
                const created = await testObjectModel.create(sampleData1);
                
                const event: BiographyEvent = {
                    when: new Date().toISOString(),
                    what: 'viewed',
                    withWhom: ['user-123'],
                    resulted: 'User viewed the object'
                };

                await testObjectModel.addBiographyEvent(created.id, event);
                
                const updated = await testObjectModel.getById(created.id);
                const bio = JSON.parse(updated!.objectBio!);
                
                expect(bio.events).toHaveLength(1);
                expect(bio.events[0]).toMatchObject(event);
            });

            it('should throw if object not found', async () => {
                await expect(testObjectModel.addBiographyEvent('non-existent', {
                    when: new Date().toISOString(),
                    what: 'viewed'
                })).rejects.toThrow('Object non-existent not found');
            });
        });

        describe('addRelationship', () => {
            it('should add new relationship', async () => {
                const created = await testObjectModel.create(sampleData1);
                
                const relationship: Relationship = {
                    to: 'notebook-123',
                    nature: 'notebook-membership',
                    strength: 0.8,
                    formed: new Date().toISOString(),
                    topicAffinity: 0.9
                };

                await testObjectModel.addRelationship(created.id, relationship);
                
                const updated = await testObjectModel.getById(created.id);
                const rels = JSON.parse(updated!.objectRelationships!);
                
                expect(rels.related).toHaveLength(1);
                expect(rels.related[0]).toMatchObject(relationship);
            });

            it('should update existing relationship to same target', async () => {
                const created = await testObjectModel.create(sampleData1);
                
                const relationship1: Relationship = {
                    to: 'notebook-123',
                    nature: 'notebook-membership',
                    strength: 0.5,
                    formed: new Date().toISOString()
                };

                await testObjectModel.addRelationship(created.id, relationship1);
                
                const relationship2: Relationship = {
                    ...relationship1,
                    strength: 0.9
                };

                await testObjectModel.addRelationship(created.id, relationship2);
                
                const updated = await testObjectModel.getById(created.id);
                const rels = JSON.parse(updated!.objectRelationships!);
                
                expect(rels.related).toHaveLength(1);
                expect(rels.related[0].strength).toBe(0.9);
            });
        });

        describe('removeRelationship', () => {
            it('should remove existing relationship', async () => {
                const created = await testObjectModel.create(sampleData1);
                
                await testObjectModel.addRelationship(created.id, {
                    to: 'notebook-123',
                    nature: 'notebook-membership',
                    strength: 1.0,
                    formed: new Date().toISOString()
                });

                await testObjectModel.removeRelationship(created.id, 'notebook-123');
                
                const updated = await testObjectModel.getById(created.id);
                const rels = JSON.parse(updated!.objectRelationships!);
                
                expect(rels.related).toHaveLength(0);
            });

            it('should not throw if relationship does not exist', async () => {
                const created = await testObjectModel.create(sampleData1);
                
                // Should not throw
                await testObjectModel.removeRelationship(created.id, 'non-existent');
            });
        });

        describe('notebook associations', () => {
            it('should add object to notebook with junction table and relationships', async () => {
                const created = await testObjectModel.create(sampleData1);
                const notebookId = 'notebook-test-123';
                
                // Create the notebook first to satisfy foreign key constraint
                testDb.prepare(`
                    INSERT INTO notebooks (id, title, object_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                `).run(notebookId, 'Test Notebook', null, Date.now(), Date.now());
                
                await testObjectModel.addToNotebook(created.id, notebookId, 0.85);
                
                // Check junction table
                const notebookIds = testObjectModel.getNotebookIdsForObject(created.id);
                expect(notebookIds).toContain(notebookId);
                
                // Check relationships
                const updated = await testObjectModel.getById(created.id);
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
                const created = await testObjectModel.create(sampleData1);
                const notebookId = 'notebook-test-123';
                
                // Create the notebook first to satisfy foreign key constraint
                testDb.prepare(`
                    INSERT INTO notebooks (id, title, object_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                `).run(notebookId, 'Test Notebook', null, Date.now(), Date.now());
                
                await testObjectModel.addToNotebook(created.id, notebookId);
                await testObjectModel.removeFromNotebook(created.id, notebookId);
                
                // Check junction table
                const notebookIds = testObjectModel.getNotebookIdsForObject(created.id);
                expect(notebookIds).not.toContain(notebookId);
                
                // Check relationships removed
                const updated = await testObjectModel.getById(created.id);
                const rels = JSON.parse(updated!.objectRelationships!);
                const notebookRel = rels.related.find((r: Relationship) => r.to === notebookId);
                expect(notebookRel).toBeUndefined();
                
                // Check biography event
                const bio = JSON.parse(updated!.objectBio!);
                const removeEvent = bio.events.find((e: BiographyEvent) => e.what === 'removed-from-notebook');
                expect(removeEvent).toBeDefined();
            });
        });
    });
});