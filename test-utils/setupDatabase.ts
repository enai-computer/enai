import { vi } from 'vitest';
import type { Database } from 'better-sqlite3';

/**
 * Creates a test database setup that works across Node versions
 * This can use either real better-sqlite3 (if available) or mocks
 */
export const setupTestDatabase = async (): Promise<Database> => {
  try {
    // Try to use real better-sqlite3
    const BetterSqlite3 = await import('better-sqlite3');
    const db = new BetterSqlite3.default(':memory:');
    return db;
  } catch (error) {
    // Fall back to mock if native module fails
    console.warn('Using mock database due to:', error);
    return createMockDatabase() as any;
  }
};

const createMockDatabase = () => {
  const stmtMocks = new Map<string, any>();
  
  const createMockStmt = () => ({
    run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    iterate: vi.fn().mockReturnValue([]),
    pluck: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
  });

  return {
    prepare: vi.fn((sql: string) => {
      if (!stmtMocks.has(sql)) {
        stmtMocks.set(sql, createMockStmt());
      }
      return stmtMocks.get(sql);
    }),
    exec: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn((fn: Function) => fn),
    pragma: vi.fn(),
    open: true,
    inTransaction: false,
    name: ':memory:',
    memory: true,
    readonly: false,
  };
};