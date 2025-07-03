import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDb, cleanTestDb } from './testUtils';
import { ObjectModel } from '../ObjectModel';
import { JeffersObject, ObjectStatus } from '../../shared/types';

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
});