import { vi } from 'vitest';

// Mock better-sqlite3 to avoid native module issues
export const createMockDatabase = () => {
  const stmtMocks = new Map<string, any>();
  
  const mockStmt = {
    run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    iterate: vi.fn().mockReturnValue([]),
    pluck: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
  };

  const mockDb = {
    prepare: vi.fn((sql: string) => {
      if (!stmtMocks.has(sql)) {
        stmtMocks.set(sql, { ...mockStmt });
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

  return mockDb;
};

// Auto-mock for vitest
vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => createMockDatabase()),
}));