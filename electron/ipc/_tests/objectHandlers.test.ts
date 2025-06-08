import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IpcMain, IpcMainInvokeEvent } from 'electron';
import { registerObjectHandlers } from '../objectHandlers';
import { ObjectModel } from '../../../models/ObjectModel';
import { logger } from '../../../utils/logger';
import { OBJECT_GET_BY_ID } from '../../../shared/ipcChannels';
import type { Database } from 'better-sqlite3';

// Mock logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}));

describe('objectHandlers', () => {
  let mockIpcMain: Partial<IpcMain>;
  let mockObjectModel: Partial<ObjectModel>;
  let mockEvent: Partial<IpcMainInvokeEvent>;
  let handlers: Map<string, Function>;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();

    // Initialize handler map
    handlers = new Map();

    // Mock IpcMain
    mockIpcMain = {
      handle: vi.fn((channel: string, handler: Function) => {
        handlers.set(channel, handler);
        return mockIpcMain as IpcMain;
      })
    };

    // Mock ObjectModel
    mockObjectModel = {
      getById: vi.fn()
    };

    // Mock event
    mockEvent = {
      sender: {} as any
    };
  });

  describe('registration', () => {
    it('should register the handler correctly', () => {
      registerObjectHandlers(mockIpcMain as IpcMain, mockObjectModel as ObjectModel);

      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        OBJECT_GET_BY_ID,
        expect.any(Function)
      );
      expect(handlers.has(OBJECT_GET_BY_ID)).toBe(true);
    });
  });

  describe('OBJECT_GET_BY_ID handler', () => {
    it('should handle missing objectId parameter', async () => {
      mockObjectModel.getById = vi.fn().mockReturnValue(null);

      registerObjectHandlers(mockIpcMain as IpcMain, mockObjectModel as ObjectModel);
      const handler = handlers.get(OBJECT_GET_BY_ID)!;

      // Test with various falsy values
      const falsyValues = [undefined, '', null];
      
      for (const value of falsyValues) {
        vi.clearAllMocks();
        const result = await handler(mockEvent, value);
        expect(result).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Object not found'));
      }
    });

    it('should return object when found', async () => {
      const mockObject = {
        id: 'object-123',
        objectType: 'document',
        title: 'Test Document',
        url: 'https://example.com/doc',
        content: 'Document content',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      mockObjectModel.getById = vi.fn().mockReturnValue(mockObject);

      registerObjectHandlers(mockIpcMain as IpcMain, mockObjectModel as ObjectModel);
      const handler = handlers.get(OBJECT_GET_BY_ID)!;

      const result = await handler(mockEvent, 'object-123');

      expect(result).toEqual(mockObject);
      expect(mockObjectModel.getById).toHaveBeenCalledWith('object-123');
      expect(logger.info).toHaveBeenCalledWith(
        '[ObjectHandlers] Getting object by ID: object-123'
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[ObjectHandlers] Found object: Test Document (type: document)'
      );
    });

    it('should return null when object not found', async () => {
      mockObjectModel.getById = vi.fn().mockReturnValue(null);

      registerObjectHandlers(mockIpcMain as IpcMain, mockObjectModel as ObjectModel);
      const handler = handlers.get(OBJECT_GET_BY_ID)!;

      const result = await handler(mockEvent, 'nonexistent');

      expect(result).toBeNull();
      expect(mockObjectModel.getById).toHaveBeenCalledWith('nonexistent');
      expect(logger.warn).toHaveBeenCalledWith(
        '[ObjectHandlers] Object not found: nonexistent'
      );
    });

    it('should handle database errors', async () => {
      mockObjectModel.getById = vi.fn().mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      registerObjectHandlers(mockIpcMain as IpcMain, mockObjectModel as ObjectModel);
      const handler = handlers.get(OBJECT_GET_BY_ID)!;

      await expect(handler(mockEvent, 'object-123'))
        .rejects.toThrow('Database connection failed');

      expect(logger.error).toHaveBeenCalledWith(
        '[ObjectHandlers] Error getting object:',
        expect.any(Error)
      );
    });

    it('should handle objects with missing optional fields', async () => {
      const minimalObject = {
        id: 'object-123',
        objectType: 'bookmark',
        // title and other fields might be null/undefined
        title: null,
        url: null,
        content: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      mockObjectModel.getById = vi.fn().mockReturnValue(minimalObject);

      registerObjectHandlers(mockIpcMain as IpcMain, mockObjectModel as ObjectModel);
      const handler = handlers.get(OBJECT_GET_BY_ID)!;

      const result = await handler(mockEvent, 'object-123');

      expect(result).toEqual(minimalObject);
      expect(logger.info).toHaveBeenCalledWith(
        '[ObjectHandlers] Found object: null (type: bookmark)'
      );
    });

    it('should handle different object types', async () => {
      const testCases = [
        { objectType: 'document', title: 'Document Title' },
        { objectType: 'bookmark', title: 'Bookmark Title' },
        { objectType: 'pdf', title: 'PDF Title' },
        { objectType: 'note', title: 'Note Title' }
      ];

      registerObjectHandlers(mockIpcMain as IpcMain, mockObjectModel as ObjectModel);
      const handler = handlers.get(OBJECT_GET_BY_ID)!;

      for (const testCase of testCases) {
        const mockObject = {
          id: `object-${testCase.objectType}`,
          objectType: testCase.objectType,
          title: testCase.title,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        mockObjectModel.getById = vi.fn().mockReturnValue(mockObject);

        const result = await handler(mockEvent, mockObject.id);

        expect(result).toEqual(mockObject);
        expect(logger.info).toHaveBeenCalledWith(
          `[ObjectHandlers] Found object: ${testCase.title} (type: ${testCase.objectType})`
        );
      }
    });

    it('should handle special characters in objectId', async () => {
      const specialIds = [
        'object-with-dashes',
        'object_with_underscores',
        'object.with.dots',
        'object:with:colons',
        'object/with/slashes'
      ];

      registerObjectHandlers(mockIpcMain as IpcMain, mockObjectModel as ObjectModel);
      const handler = handlers.get(OBJECT_GET_BY_ID)!;

      for (const objectId of specialIds) {
        mockObjectModel.getById = vi.fn().mockReturnValue(null);

        const result = await handler(mockEvent, objectId);

        expect(mockObjectModel.getById).toHaveBeenCalledWith(objectId);
        expect(result).toBeNull();
      }
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      // Simulate an error that might occur during object retrieval
      mockObjectModel.getById = vi.fn().mockImplementation(() => {
        const error = new Error('Unexpected error');
        (error as any).code = 'SQLITE_ERROR';
        throw error;
      });

      registerObjectHandlers(mockIpcMain as IpcMain, mockObjectModel as ObjectModel);
      const handler = handlers.get(OBJECT_GET_BY_ID)!;

      await expect(handler(mockEvent, 'object-123'))
        .rejects.toThrow('Unexpected error');

      expect(logger.error).toHaveBeenCalledWith(
        '[ObjectHandlers] Error getting object:',
        expect.objectContaining({
          message: 'Unexpected error',
          code: 'SQLITE_ERROR'
        })
      );
    });

    it('should handle various parameter types', async () => {
      registerObjectHandlers(mockIpcMain as IpcMain, mockObjectModel as ObjectModel);
      const handler = handlers.get(OBJECT_GET_BY_ID)!;

      // Test with various types - handler will try to use them as IDs
      const inputs = [
        123, // number
        true, // boolean  
        {}, // object
        [], // array
      ];

      for (const input of inputs) {
        mockObjectModel.getById = vi.fn().mockReturnValue(null);
        const result = await handler(mockEvent, input);
        expect(result).toBeNull();
        // The model will be called with whatever was passed
        expect(mockObjectModel.getById).toHaveBeenCalledWith(input);
      }
    });
  });

  describe('integration scenarios', () => {
    it('should handle concurrent requests', async () => {
      let callCount = 0;
      mockObjectModel.getById = vi.fn().mockImplementation((id: string) => {
        callCount++;
        return {
          id,
          objectType: 'document',
          title: `Document ${callCount}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      });

      registerObjectHandlers(mockIpcMain as IpcMain, mockObjectModel as ObjectModel);
      const handler = handlers.get(OBJECT_GET_BY_ID)!;

      // Simulate concurrent requests
      const promises = [
        handler(mockEvent, 'object-1'),
        handler(mockEvent, 'object-2'),
        handler(mockEvent, 'object-3')
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(mockObjectModel.getById).toHaveBeenCalledTimes(3);
      expect(results[0].id).toBe('object-1');
      expect(results[1].id).toBe('object-2');
      expect(results[2].id).toBe('object-3');
    });

    it('should handle rapid successive calls for the same object', async () => {
      const mockObject = {
        id: 'object-123',
        objectType: 'document',
        title: 'Cached Document',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      mockObjectModel.getById = vi.fn().mockReturnValue(mockObject);

      registerObjectHandlers(mockIpcMain as IpcMain, mockObjectModel as ObjectModel);
      const handler = handlers.get(OBJECT_GET_BY_ID)!;

      // Make multiple calls for the same object
      const results = await Promise.all([
        handler(mockEvent, 'object-123'),
        handler(mockEvent, 'object-123'),
        handler(mockEvent, 'object-123')
      ]);

      expect(results).toEqual([mockObject, mockObject, mockObject]);
      expect(mockObjectModel.getById).toHaveBeenCalledTimes(3);
    });
  });
});