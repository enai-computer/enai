import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SliceService } from '../SliceService';
import type { ChunkSqlModel } from '../../models/ChunkModel';
import type { ObjectModel } from '../../models/ObjectModel';
import type { SliceDetail } from '../../shared/types';
import type { Database } from 'better-sqlite3';

// Mock the logger
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

describe('SliceService', () => {
  let mockChunkModel: any;
  let mockObjectModel: any;
  let mockDb: any;
  let sliceService: SliceService;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Create mock database
    mockDb = {} as Database;

    // Create mock implementations
    mockChunkModel = {
      getChunksByIds: vi.fn()
    };

    mockObjectModel = {
      getSourceContentDetailsByIds: vi.fn()
    };

    // Create service instance with mocked dependencies using BaseService pattern
    sliceService = new SliceService({
      db: mockDb,
      chunkSqlModel: mockChunkModel as ChunkSqlModel,
      objectModel: mockObjectModel as ObjectModel
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getDetailsForSlices', () => {
    it('should return empty array when no chunk IDs provided', async () => {
      const result = await sliceService.getDetailsForSlices([]);
      
      expect(result).toEqual([]);
      expect(mockChunkModel.getChunksByIds).not.toHaveBeenCalled();
      expect(mockObjectModel.getSourceContentDetailsByIds).not.toHaveBeenCalled();
    });

    it('should successfully retrieve chunks with full metadata', async () => {
      // Arrange
      const chunkIds = [1, 2, 3];
      const mockChunks = [
        { 
          id: 1, 
          objectId: 'obj-1', 
          content: 'Chunk 1 content',
          summary: 'Summary 1'
        },
        { 
          id: 2, 
          objectId: 'obj-2', 
          content: 'Chunk 2 content',
          summary: 'Summary 2'
        },
        { 
          id: 3, 
          objectId: 'obj-1', 
          content: 'Chunk 3 content',
          summary: null
        }
      ];
      
      const mockSourceDetails = new Map([
        ['obj-1', { 
          title: 'Document 1', 
          sourceUri: 'https://example.com/doc1'
        }],
        ['obj-2', { 
          title: 'Document 2', 
          sourceUri: 'https://example.com/doc2'
        }]
      ]);

      mockChunkModel.getChunksByIds.mockResolvedValue(mockChunks);
      mockObjectModel.getSourceContentDetailsByIds.mockResolvedValue(mockSourceDetails);

      // Act
      const result = await sliceService.getDetailsForSlices(chunkIds);

      // Assert
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        chunkId: 1,
        content: 'Chunk 1 content',
        summary: 'Summary 1',
        sourceObjectId: 'obj-1',
        sourceObjectTitle: 'Document 1',
        sourceObjectUri: 'https://example.com/doc1'
      });
      expect(result[1]).toEqual({
        chunkId: 2,
        content: 'Chunk 2 content',
        summary: 'Summary 2',
        sourceObjectId: 'obj-2',
        sourceObjectTitle: 'Document 2',
        sourceObjectUri: 'https://example.com/doc2'
      });
      expect(result[2]).toEqual({
        chunkId: 3,
        content: 'Chunk 3 content',
        summary: null,
        sourceObjectId: 'obj-1',
        sourceObjectTitle: 'Document 1',
        sourceObjectUri: 'https://example.com/doc1'
      });

      // SliceService converts number IDs to strings
      expect(mockChunkModel.getChunksByIds).toHaveBeenCalledWith(['1', '2', '3']);
      expect(mockObjectModel.getSourceContentDetailsByIds).toHaveBeenCalledWith(['obj-1', 'obj-2']);
    });

    it('should handle non-existent chunk IDs gracefully', async () => {
      // Arrange
      const chunkIds = [999, 1000];
      mockChunkModel.getChunksByIds.mockResolvedValue([]);
      
      // Act
      const result = await sliceService.getDetailsForSlices(chunkIds);

      // Assert
      expect(result).toEqual([]);
      // SliceService converts number IDs to strings
      expect(mockChunkModel.getChunksByIds).toHaveBeenCalledWith(['999', '1000']);
      expect(mockObjectModel.getSourceContentDetailsByIds).not.toHaveBeenCalled();
    });

    it('should handle chunks with missing source object metadata', async () => {
      // Arrange
      const chunkIds = [1, 2];
      const mockChunks = [
        { 
          id: 1, 
          objectId: 'obj-1', 
          content: 'Chunk 1 content',
          summary: 'Summary 1'
        },
        { 
          id: 2, 
          objectId: 'obj-missing', 
          content: 'Chunk 2 content',
          summary: 'Summary 2'
        }
      ];
      
      // Only obj-1 has metadata, obj-missing doesn't exist
      const mockSourceDetails = new Map([
        ['obj-1', { 
          title: 'Document 1', 
          sourceUri: 'https://example.com/doc1'
        }]
      ]);

      mockChunkModel.getChunksByIds.mockResolvedValue(mockChunks);
      mockObjectModel.getSourceContentDetailsByIds.mockResolvedValue(mockSourceDetails);

      // Act
      const result = await sliceService.getDetailsForSlices(chunkIds);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        chunkId: 1,
        content: 'Chunk 1 content',
        summary: 'Summary 1',
        sourceObjectId: 'obj-1',
        sourceObjectTitle: 'Document 1',
        sourceObjectUri: 'https://example.com/doc1'
      });
      expect(result[1]).toEqual({
        chunkId: 2,
        content: 'Chunk 2 content',
        summary: 'Summary 2',
        sourceObjectId: 'obj-missing',
        sourceObjectTitle: null,
        sourceObjectUri: null
      });
    });

    it('should deduplicate object IDs when fetching source details', async () => {
      // Arrange
      const chunkIds = [1, 2, 3, 4];
      const mockChunks = [
        { id: 1, objectId: 'obj-1', content: 'Content 1', summary: null },
        { id: 2, objectId: 'obj-1', content: 'Content 2', summary: null }, // Same object
        { id: 3, objectId: 'obj-2', content: 'Content 3', summary: null },
        { id: 4, objectId: 'obj-1', content: 'Content 4', summary: null }  // Same object again
      ];
      
      const mockSourceDetails = new Map([
        ['obj-1', { title: 'Document 1', sourceUri: 'https://example.com/doc1' }],
        ['obj-2', { title: 'Document 2', sourceUri: 'https://example.com/doc2' }]
      ]);

      mockChunkModel.getChunksByIds.mockResolvedValue(mockChunks);
      mockObjectModel.getSourceContentDetailsByIds.mockResolvedValue(mockSourceDetails);

      // Act
      await sliceService.getDetailsForSlices(chunkIds);

      // Assert
      expect(mockObjectModel.getSourceContentDetailsByIds).toHaveBeenCalledWith(['obj-1', 'obj-2']);
      expect(mockObjectModel.getSourceContentDetailsByIds).toHaveBeenCalledTimes(1);
    });

    it('should handle database errors from ChunkModel', async () => {
      // Arrange
      const chunkIds = [1, 2];
      const error = new Error('Database connection failed');
      mockChunkModel.getChunksByIds.mockRejectedValue(error);

      // Act & Assert
      await expect(sliceService.getDetailsForSlices(chunkIds)).rejects.toThrow('Database connection failed');
      expect(mockObjectModel.getSourceContentDetailsByIds).not.toHaveBeenCalled();
    });

    it('should handle database errors from ObjectModel', async () => {
      // Arrange
      const chunkIds = [1];
      const mockChunks = [
        { id: 1, objectId: 'obj-1', content: 'Content', summary: null }
      ];
      const error = new Error('ObjectModel query failed');
      
      mockChunkModel.getChunksByIds.mockResolvedValue(mockChunks);
      mockObjectModel.getSourceContentDetailsByIds.mockRejectedValue(error);

      // Act & Assert
      await expect(sliceService.getDetailsForSlices(chunkIds)).rejects.toThrow('ObjectModel query failed');
    });

    it('should handle mixed numeric and string chunk IDs', async () => {
      // Arrange - TypeScript would normally prevent this, but testing defensive coding
      const chunkIds = [1, 2, 3] as any[];
      const mockChunks = [
        { id: 1, objectId: 'obj-1', content: 'Content 1', summary: null },
        { id: 2, objectId: 'obj-1', content: 'Content 2', summary: null },
        { id: 3, objectId: 'obj-1', content: 'Content 3', summary: null }
      ];
      
      mockChunkModel.getChunksByIds.mockResolvedValue(mockChunks);
      mockObjectModel.getSourceContentDetailsByIds.mockResolvedValue(new Map([
        ['obj-1', { title: 'Document', sourceUri: 'https://example.com' }]
      ]));

      // Act
      const result = await sliceService.getDetailsForSlices(chunkIds);

      // Assert
      expect(result).toHaveLength(3);
      // SliceService converts number IDs to strings
      expect(mockChunkModel.getChunksByIds).toHaveBeenCalledWith(['1', '2', '3']);
    });

    it('should handle chunks with null or undefined fields gracefully', async () => {
      // Arrange
      const chunkIds = [1, 2];
      const mockChunks = [
        { 
          id: 1, 
          objectId: 'obj-1', 
          content: 'Content 1',
          summary: undefined // undefined summary
        },
        { 
          id: 2, 
          objectId: 'obj-2', 
          content: null, // null content
          summary: 'Summary 2'
        }
      ];
      
      const mockSourceDetails = new Map([
        ['obj-1', { title: null, sourceUri: undefined }], // null/undefined metadata
        ['obj-2', { title: 'Document 2', sourceUri: 'https://example.com/doc2' }]
      ]);

      mockChunkModel.getChunksByIds.mockResolvedValue(mockChunks);
      mockObjectModel.getSourceContentDetailsByIds.mockResolvedValue(mockSourceDetails);

      // Act
      const result = await sliceService.getDetailsForSlices(chunkIds);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        chunkId: 1,
        content: 'Content 1',
        summary: null,
        sourceObjectId: 'obj-1',
        sourceObjectTitle: null,
        sourceObjectUri: null
      });
      expect(result[1]).toEqual({
        chunkId: 2,
        content: null,
        summary: 'Summary 2',
        sourceObjectId: 'obj-2',
        sourceObjectTitle: 'Document 2',
        sourceObjectUri: 'https://example.com/doc2'
      });
    });
  });
});