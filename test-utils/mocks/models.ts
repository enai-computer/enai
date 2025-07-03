import { vi } from 'vitest';
import type { JeffersObject } from '../../shared/types/object.types';
import type { JeffersChunk } from '../../shared/types/chunk.types';

/**
 * Creates a minimal JeffersObject for testing
 */
export const createTestObject = (overrides: Partial<JeffersObject> = {}): JeffersObject => ({
  id: 'test-object-id',
  mediaType: 'webpage',
  url: 'https://example.com',
  title: 'Test Object',
  summary: 'Test summary',
  content: 'Test content',
  sourceType: 'webpage',
  sourceMetadata: {},
  status: 'pending',
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

/**
 * Creates a minimal JeffersChunk for testing
 */
export const createTestChunk = (overrides: Partial<JeffersChunk> = {}): JeffersChunk => ({
  id: 'test-chunk-id',
  objectId: 'test-object-id',
  content: 'Test chunk content',
  summary: 'Test chunk summary',
  metadata: {},
  chunkIndex: 0,
  size: 100,
  layer: 'lom',
  processingDepth: 'chunk',
  createdAt: new Date().toISOString(),
  ...overrides,
});

/**
 * Creates a mock model with common database methods
 */
export const createMockModel = <T>(modelName: string) => ({
  create: vi.fn(),
  findById: vi.fn(),
  findByStatus: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getAll: vi.fn().mockReturnValue([]),
});

/**
 * Creates a partial mock that only includes specified methods
 * Useful for creating minimal mocks that only have what's needed
 */
export function createPartialMock<T>(methods: Partial<T>): T {
  return methods as T;
}