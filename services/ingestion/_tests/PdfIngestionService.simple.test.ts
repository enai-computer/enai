import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import runMigrations from '../../../models/runMigrations';
import { PdfIngestionService } from '../PdfIngestionService';
import { AiGeneratedContentSchema } from '../../../shared/schemas/aiSchemas';

describe('PdfIngestionService - Validation Tests', () => {
  let db: Database.Database;

  beforeEach(async () => {
    // Create in-memory database
    db = new Database(':memory:');
    await runMigrations(db);
  });

  describe('AI Response Validation', () => {
    it('should validate correct AI response structure', () => {
      const validResponse = {
        title: 'Test Document',
        summary: 'This is a comprehensive test summary of the document.',
        tags: ['test', 'document', 'validation']
      };

      const result = AiGeneratedContentSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Test Document');
        expect(result.data.tags).toHaveLength(3);
      }
    });

    it('should reject AI response missing required fields', () => {
      const invalidResponse = {
        title: 'Test Document',
        // missing summary
        tags: ['test']
      };

      const result = AiGeneratedContentSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });

    it('should reject AI response with empty title', () => {
      const invalidResponse = {
        title: '',
        summary: 'Summary text',
        tags: ['test']
      };

      const result = AiGeneratedContentSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });

    it('should reject AI response with empty tags array', () => {
      const invalidResponse = {
        title: 'Test',
        summary: 'Summary text',
        tags: []
      };

      const result = AiGeneratedContentSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });
  });

  describe('PDF Metadata Validation', () => {
    it('should validate PDF metadata structure', async () => {
      const { PdfDocumentSchema } = await import('../../../shared/schemas/pdfSchemas');
      
      const validDoc = {
        pageContent: 'This is the extracted text content',
        metadata: {
          numpages: 10,
          info: {
            Title: 'Sample PDF',
            Author: 'Test Author'
          },
          version: '1.7'
        }
      };

      const result = PdfDocumentSchema.safeParse(validDoc);
      expect(result.success).toBe(true);
    });

    it('should allow PDF documents without metadata', async () => {
      const { PdfDocumentSchema } = await import('../../../shared/schemas/pdfSchemas');
      
      const validDoc = {
        pageContent: 'This is the extracted text content'
      };

      const result = PdfDocumentSchema.safeParse(validDoc);
      expect(result.success).toBe(true);
    });
  });
});