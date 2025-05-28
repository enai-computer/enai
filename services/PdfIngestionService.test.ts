import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import runMigrations from '../models/runMigrations';
import { ObjectModel } from '../models/ObjectModel';
import { ChunkSqlModel } from '../models/ChunkModel';
import { EmbeddingSqlModel } from '../models/EmbeddingModel';
import { PdfIngestionService } from './PdfIngestionService';
import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Set NODE_ENV to test before any imports
process.env.NODE_ENV = 'test';

// Mock Electron app first
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-user-data'
  }
}));

// Mock pdf-parse - need to mock the require since it's dynamically imported
vi.mock('pdf-parse', () => {
  return {
    default: vi.fn((buffer) => Promise.resolve({
      text: 'Sample PDF content for testing',
      numpages: 5,
      info: {
        Title: 'Test PDF',
        Author: 'Test Author'
      },
      metadata: {},
      version: '1.10.100'
    }))
  };
});

// Also mock require for dynamic import in the service
const mockPdfParse = vi.fn((buffer) => Promise.resolve({
  text: 'Sample PDF content for testing',
  numpages: 5,
  info: {
    Title: 'Test PDF',
    Author: 'Test Author'
  },
  metadata: {},
  version: '1.10.100'
}));

vi.stubGlobal('require', (module: string) => {
  if (module === 'pdf-parse') {
    return mockPdfParse;
  }
  return vi.requireActual(module);
});

// Mock OpenAI
vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        title: 'Test PDF Analysis',
        summary: 'This is a comprehensive summary of the test PDF content.',
        tags: ['test', 'pdf', 'analysis']
      })
    })
  })),
  OpenAIEmbeddings: vi.fn().mockImplementation(() => ({
    embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
  }))
}));

// Mock ChromaVectorModel
const mockChromaVectorModel = {
  addDocuments: vi.fn().mockResolvedValue(['mock-id-1']),
  deleteDocuments: vi.fn().mockResolvedValue(true),
  similaritySearch: vi.fn().mockResolvedValue([])
};

describe('PdfIngestionService', () => {
  let db: Database.Database;
  let service: PdfIngestionService;
  let testPdfPath: string;

  beforeEach(async () => {
    // Create in-memory database
    db = new Database(':memory:');
    await runMigrations(db);

    // Create models
    const objectModel = new ObjectModel(db);
    const chunkModel = new ChunkSqlModel(db);
    const embeddingModel = new EmbeddingSqlModel(db);

    // Create service
    service = new PdfIngestionService(
      objectModel,
      chunkModel,
      mockChromaVectorModel as any,
      embeddingModel
    );

    // Create test PDF file
    testPdfPath = path.join('/tmp', `test-${uuidv4()}.pdf`);
    await fs.writeFile(testPdfPath, Buffer.from('Mock PDF content'));
    
    // Ensure PDF storage directory exists
    await fs.mkdir('/tmp/test-user-data/pdfs', { recursive: true });
  });

  afterEach(async () => {
    // Clean up test file
    try {
      await fs.unlink(testPdfPath);
    } catch (e) {
      // Ignore if file doesn't exist
    }
    
    // Clean up
    db.close();
    vi.clearAllMocks();
  });

  describe('processPdf', () => {
    it('should successfully process a valid PDF with validated AI response', async () => {
      const result = await service.processPdf(testPdfPath, 'test.pdf');
      
      expect(result.success).toBe(true);
      expect(result.objectId).toBeDefined();
      expect(result.chunkId).toBeDefined();
      
      // Verify object was created
      const objectModel = new ObjectModel(db);
      const object = objectModel.getById(result.objectId!);
      expect(object).toBeDefined();
      expect(object?.title).toBe('Test PDF Analysis');
      expect(object?.type).toBe('pdf');
      expect(object?.filePath).toContain('.pdf');
      expect(object?.tags).toEqual(['test', 'pdf', 'analysis']);
      
      // Verify chunk was created
      const chunkModel = new ChunkSqlModel(db);
      const chunks = chunkModel.getByObjectId(result.objectId!);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('Sample PDF content for testing');
    });

    it('should handle invalid AI response gracefully', async () => {
      // Mock invalid AI response - directly mock the ChatOpenAI constructor
      vi.mocked(await import('@langchain/openai')).ChatOpenAI.mockImplementationOnce(() => ({
        invoke: vi.fn().mockResolvedValue({
          content: 'Not valid JSON'
        })
      }) as any);

      // Create a new service instance with the mocked ChatOpenAI
      const newService = new PdfIngestionService(
        new ObjectModel(db),
        new ChunkSqlModel(db),
        mockChromaVectorModel as any,
        new EmbeddingSqlModel(db)
      );

      await expect(newService.processPdf(testPdfPath, 'test.pdf')).rejects.toThrow();
    }, 10000);

    it('should handle transaction failure atomically', async () => {
      const objectModel = new ObjectModel(db);
      vi.spyOn(objectModel, 'createSync').mockImplementationOnce(() => {
        throw new Error('DATABASE_ERROR');
      });

      service = new PdfIngestionService(
        objectModel,
        new ChunkSqlModel(db),
        mockChromaVectorModel as any,
        new EmbeddingSqlModel(db)
      );

      await expect(service.processPdf(testPdfPath, 'test.pdf')).rejects.toThrow('DATABASE_ERROR');
      
      // Verify no records were created
      const objects = objectModel.getByType('pdf');
      expect(objects).toHaveLength(0);
    });

    it('should handle ChromaDB failure and mark status as embedding_failed', async () => {
      // Make ChromaDB fail
      mockChromaVectorModel.addDocuments.mockRejectedValueOnce(new Error('ChromaDB Error'));

      const result = await service.processPdf(testPdfPath, 'test.pdf');
      
      expect(result.success).toBe(true);
      expect(result.objectId).toBeDefined();
      
      // Check embedding status
      const embeddingModel = new EmbeddingSqlModel(db);
      const embeddings = embeddingModel.getByObjectId(result.objectId!);
      expect(embeddings[0].status).toBe('failed');
    });

    it('should detect and handle duplicate PDFs', async () => {
      // Process the same PDF twice
      const result1 = await service.processPdf(testPdfPath, 'test.pdf');
      expect(result1.success).toBe(true);

      const result2 = await service.processPdf(testPdfPath, 'test.pdf');
      expect(result2.success).toBe(true);
      expect(result2.objectId).toBe(result1.objectId); // Should return same object
    });

    it('should validate PDF metadata extraction', async () => {
      const result = await service.processPdf(testPdfPath, 'test.pdf');
      
      expect(result.success).toBe(true);
      
      const objectModel = new ObjectModel(db);
      const object = objectModel.getById(result.objectId!);
      
      // Check PDF-specific fields
      expect(object?.pdfPageCount).toBe(5);
      expect(object?.pdfTitle).toBe('Test PDF');
      expect(object?.pdfAuthor).toBe('Test Author');
    });
  });
});

// Also test the transaction rollback for chunk creation failure
describe('PdfIngestionService - Chunk Transaction Failure', () => {
  let db: Database.Database;
  let service: PdfIngestionService;
  let testPdfPath: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    await runMigrations(db);
    
    // Create test PDF file
    testPdfPath = path.join('/tmp', `test-${uuidv4()}.pdf`);
    await fs.writeFile(testPdfPath, Buffer.from('Mock PDF content'));
    
    // Ensure PDF storage directory exists
    await fs.mkdir('/tmp/test-user-data/pdfs', { recursive: true });
  });

  afterEach(async () => {
    // Clean up test file
    try {
      await fs.unlink(testPdfPath);
    } catch (e) {
      // Ignore if file doesn't exist
    }
    
    db.close();
  });

  it('should rollback transaction when chunk creation fails', async () => {
    const objectModel = new ObjectModel(db);
    const chunkModel = new ChunkSqlModel(db);
    const embeddingModel = new EmbeddingSqlModel(db);
    
    // Make chunk creation fail
    vi.spyOn(chunkModel, 'addChunkSync').mockImplementationOnce(() => {
      throw new Error('CHUNK_ERROR');
    });

    service = new PdfIngestionService(
      objectModel,
      chunkModel,
      mockChromaVectorModel as any,
      embeddingModel
    );
    
    await expect(service.processPdf(testPdfPath, 'test.pdf')).rejects.toThrow('CHUNK_ERROR');
    
    // Verify no records were created
    const objects = objectModel.getByType('pdf');
    expect(objects).toHaveLength(0);
    
    const chunks = chunkModel.getAll();
    expect(chunks).toHaveLength(0);
  });
});