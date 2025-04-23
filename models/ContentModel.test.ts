import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import runMigrations from './runMigrations'; // Import the migration runner
import { ContentModel, ContentRecordInput, ContentStatus } from './ContentModel'; // Import the model and types
import { ReadabilityParsed } from '../shared/types'; // Import dependent types

// Define a dummy ReadabilityParsed object for testing
const dummyParsedContent: ReadabilityParsed = {
  title: 'Test Title',
  byline: 'Test Author',
  dir: null,
  content: '<p>Test HTML content</p>',
  textContent: 'Test text content',
  length: 17,
  excerpt: 'Test excerpt',
  siteName: 'Test Site',
};

describe('ContentModel', () => {
  let db: Database.Database;
  let contentModel: ContentModel;

  beforeEach(() => {
    // Create a new in-memory database for each test
    db = new Database(':memory:');
    // Apply migrations to the in-memory database
    runMigrations(db);

    // Add a dummy bookmarks table to satisfy the foreign key constraint for ContentModel tests
    // This avoids needing the full BookmarkModel or separate migrations just for this test.
    db.exec(`
      CREATE TABLE bookmarks (
        bookmark_id TEXT PRIMARY KEY NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        added_at INTEGER NOT NULL,
        status TEXT DEFAULT 'pending' -- Add other columns as needed for basic FK satisfaction
      );
    `);

    // Instantiate the model with the test database
    contentModel = new ContentModel(db);
  });

  afterEach(() => {
    // Close the database connection after each test
    db.close();
  });

  it('should initialize the database and model', () => {
    expect(db).toBeDefined();
    expect(contentModel).toBeInstanceOf(ContentModel);
    // Check if the 'content' table exists after migrations
    const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='content';").get();
    expect(tableInfo).toBeDefined();
    expect((tableInfo as any).name).toBe('content');
  });

  it('should upsert new content correctly', () => {
    const input: ContentRecordInput = {
      bookmarkId: 'bookmark-123',
      sourceUrl: 'http://example.com',
      status: 'ok',
      parsedContent: dummyParsedContent,
    };

    const result = contentModel.upsertContent(input);
    expect(result.changes).toBe(1);

    // Verify the data was inserted correctly
    const row = db.prepare('SELECT * FROM content WHERE bookmark_id = ?').get(input.bookmarkId) as any;
    expect(row).toBeDefined();
    expect(row.bookmark_id).toBe(input.bookmarkId);
    expect(row.source_url).toBe(input.sourceUrl);
    expect(row.status).toBe('ok');
    expect(row.title).toBe(dummyParsedContent.title);
    expect(row.byline).toBe(dummyParsedContent.byline);
    expect(row.body).toBe(dummyParsedContent.textContent);
    expect(row.length).toBe(dummyParsedContent.length);
    expect(row.fetched_at).toBeDefined(); // Check that fetched_at was set
    expect(row.error_info).toBeNull();
  });

  it('should upsert (replace) existing content correctly', () => {
    // Initial insert
    const initialInput: ContentRecordInput = {
      bookmarkId: 'bookmark-456',
      sourceUrl: 'http://initial.com',
      status: 'pending',
      parsedContent: null,
    };
    contentModel.upsertContent(initialInput);

    // Update (upsert)
    const updatedInput: ContentRecordInput = {
      bookmarkId: 'bookmark-456', // Same ID
      sourceUrl: 'http://updated.com',
      status: 'ok',
      parsedContent: dummyParsedContent,
      errorInfo: 'Previous error resolved', // Add error info
    };
    const result = contentModel.upsertContent(updatedInput);
    expect(result.changes).toBe(1);

    // Verify the data was updated
    const row = db.prepare('SELECT * FROM content WHERE bookmark_id = ?').get(updatedInput.bookmarkId) as any;
    expect(row).toBeDefined();
    expect(row.source_url).toBe(updatedInput.sourceUrl);
    expect(row.status).toBe('ok');
    expect(row.title).toBe(dummyParsedContent.title);
    expect(row.body).toBe(dummyParsedContent.textContent);
    expect(row.fetched_at).toBeDefined();
    expect(row.error_info).toBe('Previous error resolved');
  });

  it('should update content status correctly', () => {
    // Insert a record first
    const input: ContentRecordInput = {
      bookmarkId: 'bookmark-789',
      sourceUrl: 'http://test-status.com',
      status: 'pending',
    };
    contentModel.upsertContent(input);

    // Update the status
    const newStatus: ContentStatus = 'fetch_error';
    const fetchedAt = new Date(2024, 0, 15); // Specific date
    const result = contentModel.updateContentStatus(input.bookmarkId, newStatus, fetchedAt);
    expect(result.changes).toBe(1);

    // Verify the status and fetched_at were updated
    const row = db.prepare('SELECT status, fetched_at FROM content WHERE bookmark_id = ?').get(input.bookmarkId) as any;
    expect(row.status).toBe(newStatus);
    expect(row.fetched_at).toBe(fetchedAt.toISOString());
  });

  it('should return 0 changes when updating status for non-existent bookmark', () => {
    const result = contentModel.updateContentStatus('non-existent-id', 'ok');
    expect(result.changes).toBe(0);
  });

  it('should find content by statuses', () => {
    // Insert records with various statuses
    contentModel.upsertContent({ bookmarkId: 'b1', sourceUrl: 'url1', status: 'pending' });
    contentModel.upsertContent({ bookmarkId: 'b2', sourceUrl: 'url2', status: 'ok' });
    contentModel.upsertContent({ bookmarkId: 'b3', sourceUrl: 'url3', status: 'fetch_error' });
    contentModel.upsertContent({ bookmarkId: 'b4', sourceUrl: 'url4', status: 'timeout' });
    contentModel.upsertContent({ bookmarkId: 'b5', sourceUrl: 'url5', status: 'pending' });

    // Find records with 'pending' or 'fetch_error' status
    const statusesToFind: ContentStatus[] = ['pending', 'fetch_error'];
    const results = contentModel.findByStatuses(statusesToFind);

    expect(results).toHaveLength(3);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bookmark_id: 'b1', source_url: 'url1' }),
        expect.objectContaining({ bookmark_id: 'b3', source_url: 'url3' }),
        expect.objectContaining({ bookmark_id: 'b5', source_url: 'url5' }),
      ])
    );
  });

  it('should return an empty array when finding by an empty list of statuses', () => {
    contentModel.upsertContent({ bookmarkId: 'b1', sourceUrl: 'url1', status: 'pending' });
    const results = contentModel.findByStatuses([]);
    expect(results).toEqual([]);
  });

  it('should return an empty array when no records match the statuses', () => {
    contentModel.upsertContent({ bookmarkId: 'b1', sourceUrl: 'url1', status: 'ok' });
    const results = contentModel.findByStatuses(['pending', 'timeout']);
    expect(results).toEqual([]);
  });

}); 