import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import runMigrations from '../../../models/runMigrations';
import { PdfIngestionService } from '../PdfIngestionService';
import { LLMService } from '../../LLMService';
import { IngestionAiService } from '../IngestionAIService';
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
  // Use the global require for other modules
  return require(module);
});

// Mock LLMService
const mockLLMService = {
  generateChatResponse: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      title: 'Test PDF Analysis',
      summary: 'This is a comprehensive summary of the test PDF content.',
      tags: ['test', 'pdf', 'analysis'],
      propositions: [
        { type: 'main', content: 'Main proposition' },
        { type: 'supporting', content: 'Supporting detail' }
      ]
    })
  })
};

// Mock IngestionAiService
vi.mock('../IngestionAIService', () => ({
  IngestionAiService: vi.fn().mockImplementation(() => ({
    generateObjectSummary: vi.fn().mockResolvedValue({
      title: 'Test PDF Analysis',
      summary: 'This is a comprehensive summary of the test PDF content.',
      tags: ['test', 'pdf', 'analysis'],
      propositions: [
        { type: 'main', content: 'Main proposition' },
        { type: 'supporting', content: 'Supporting detail' }
      ]
    })
  }))
}));

describe('PdfIngestionService', () => {
  let service: PdfIngestionService;
  let testPdfPath: string;

  beforeEach(async () => {
    // Create service with only LLMService
    service = new PdfIngestionService(mockLLMService as any);

    // Create test PDF file
    testPdfPath = path.join('/tmp', `test-${uuidv4()}.pdf`);
    await fs.writeFile(testPdfPath, Buffer.from('Mock PDF content'));
  });

  afterEach(async () => {
    // Clean up test file
    try {
      await fs.unlink(testPdfPath);
    } catch (e) {
      // Ignore if file doesn't exist
    }
    
    vi.clearAllMocks();
  });

  describe('extractTextAndGenerateAiSummary', () => {
    it('should successfully extract text and generate AI summary', async () => {
      const objectId = uuidv4();
      
      const result = await service.extractTextAndGenerateAiSummary(testPdfPath, objectId);
      
      expect(result).toBeDefined();
      expect(result.rawText).toBe('Sample PDF content for testing');
      expect(result.aiContent).toBeDefined();
      expect(result.aiContent.title).toBe('Test PDF Analysis');
      expect(result.aiContent.summary).toBe('This is a comprehensive summary of the test PDF content.');
      expect(result.aiContent.tags).toEqual(['test', 'pdf', 'analysis']);
      expect(result.pdfMetadata).toBeDefined();
      expect(result.pdfMetadata.numpages).toBe(5);
    });

    it('should handle invalid AI response gracefully', async () => {
      // Mock invalid AI response
      vi.mocked(IngestionAiService).mockImplementationOnce(() => ({
        generateObjectSummary: vi.fn().mockRejectedValue(new Error('AI_PROCESSING_FAILED'))
      }) as any);

      // Create a new service instance with the mocked IngestionAiService
      const newService = new PdfIngestionService(mockLLMService as any);
      const objectId = uuidv4();

      await expect(newService.extractTextAndGenerateAiSummary(testPdfPath, objectId))
        .rejects.toThrow('AI_PROCESSING_FAILED');
    }, 10000);

    it('should validate PDF metadata extraction', async () => {
      const objectId = uuidv4();
      
      const result = await service.extractTextAndGenerateAiSummary(testPdfPath, objectId);
      
      expect(result.pdfMetadata).toBeDefined();
      expect(result.pdfMetadata.numpages).toBe(5);
      expect(result.pdfMetadata.info?.Title).toBe('Test PDF');
      expect(result.pdfMetadata.info?.Author).toBe('Test Author');
    });

    it('should handle empty PDF content', async () => {
      // Mock pdf-parse to return empty text
      mockPdfParse.mockResolvedValueOnce({
        text: '',
        numpages: 0,
        info: {
          Title: '',
          Author: ''
        },
        metadata: {},
        version: '1.10.100'
      });

      const objectId = uuidv4();
      
      await expect(service.extractTextAndGenerateAiSummary(testPdfPath, objectId))
        .rejects.toThrow('TEXT_EXTRACTION_FAILED');
    });
  });

  describe('progress callback', () => {
    it('should send progress updates via callback', async () => {
      const progressCallback = vi.fn();
      service.setProgressCallback(progressCallback);
      
      service['sendProgress']({
        fileName: 'test.pdf',
        status: 'parsing_text'
      });
      
      expect(progressCallback).toHaveBeenCalledWith({
        fileName: 'test.pdf',
        status: 'parsing_text'
      });
    });

    it('should not send progress when callback is null', () => {
      service.setProgressCallback(null);
      
      // This should not throw
      expect(() => {
        service['sendProgress']({
          fileName: 'test.pdf',
          status: 'complete'
        });
      }).not.toThrow();
    });
  });
});