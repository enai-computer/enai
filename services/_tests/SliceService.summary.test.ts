import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SliceService } from '../SliceService';
import { ChunkModel } from '../../models/ChunkModel';
import { ObjectModel } from '../../models/ObjectModel';
import runMigrations from '../../models/runMigrations';
import { v4 as uuidv4 } from 'uuid';

describe('SliceService - Summary Field', () => {
  let db: Database.Database;
  let sliceService: SliceService;
  let chunkModel: ChunkModel;
  let objectModel: ObjectModel;

  beforeEach(async () => {
    // Create in-memory database
    db = new Database(':memory:');
    await runMigrations(db);

    // Initialize models and service
    chunkModel = new ChunkModel(db);
    objectModel = new ObjectModel(db);
    sliceService = new SliceService({
      db,
      chunkModel: chunkModel,
      objectModel: objectModel
    });
  });

  afterEach(() => {
    db.close();
  });

  it('should include summary field in slice details', async () => {
    // Create a test object
    const objectId = uuidv4();
    const object = await objectModel.create({
      id: objectId,
      objectType: 'webpage',
      sourceType: 'url',
      sourceUri: 'https://example.com/test',
      title: 'Test Document',
      content: 'Test content',
      cleanedText: 'Test cleaned text'
    });

    // Create a chunk with a summary
    const testSummary = 'This is a test summary of the chunk content';
    const chunk = await chunkModel.addChunk({
      objectId: object.id,
      chunkIdx: 0,
      content: 'This is the full chunk content that is much longer than the summary',
      summary: testSummary,
      tokenCount: 100
    });

    // Get slice details
    const sliceDetails = await sliceService.getDetailsForSlices([chunk.id]);

    // Verify the summary is included
    expect(sliceDetails).toHaveLength(1);
    expect(sliceDetails[0].summary).toBe(testSummary);
    expect(sliceDetails[0].content).toBe(chunk.content);
    expect(sliceDetails[0].chunkId).toBe(chunk.id);
    expect(sliceDetails[0].sourceObjectTitle).toBe(object.title);
  });

  it('should handle null summaries gracefully', async () => {
    // Create a test object
    const objectId = uuidv4();
    const object = await objectModel.create({
      id: objectId,
      objectType: 'webpage',
      sourceType: 'url',
      sourceUri: 'https://example.com/test2',
      title: 'Test Document 2',
      content: 'Test content 2',
      cleanedText: 'Test cleaned text 2'
    });

    // Create a chunk without a summary
    const chunk = await chunkModel.addChunk({
      objectId: object.id,
      chunkIdx: 0,
      content: 'Chunk content without summary',
      summary: null,
      tokenCount: 50
    });

    // Get slice details
    const sliceDetails = await sliceService.getDetailsForSlices([chunk.id]);

    // Verify null summary is handled correctly
    expect(sliceDetails).toHaveLength(1);
    expect(sliceDetails[0].summary).toBeNull();
    expect(sliceDetails[0].content).toBe(chunk.content);
  });
});