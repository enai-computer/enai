import { vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import type { ConversationService } from '../../services/ConversationService';
import type { NotebookService } from '../../services/NotebookService';
import type { ProfileService } from '../../services/ProfileService';

/**
 * Creates a minimal mock for ConversationService with only specified methods
 */
export const createMockConversationService = (
  methods: Partial<ConversationService> = {}
): Partial<ConversationService> => ({
  getSessionId: vi.fn().mockResolvedValue('test-session-id'),
  createSession: vi.fn().mockResolvedValue('new-session-id'),
  updateMessage: vi.fn().mockResolvedValue(undefined),
  loadMessagesFromDatabase: vi.fn().mockResolvedValue([]),
  addMessageToSession: vi.fn().mockResolvedValue(undefined),
  ...methods,
});

/**
 * Creates a minimal mock for NotebookService with only specified methods
 */
export const createMockNotebookService = (
  methods: Partial<NotebookService> = {}
): Partial<NotebookService> => ({
  createNotebook: vi.fn().mockResolvedValue({ id: 'test-notebook-id', name: 'Test Notebook' }),
  ...methods,
});

/**
 * Creates a minimal mock for ProfileService with only specified methods
 */
export const createMockProfileService = (
  methods: Partial<ProfileService> = {}
): Partial<ProfileService> => ({
  getProfile: vi.fn().mockResolvedValue({
    id: 'test-profile-id',
    goals: [],
    expertise: [],
    personality: '',
    communication_style: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }),
  ...methods,
});

/**
 * Creates a minimal database mock for testing
 */
export const createMockDatabase = (): Partial<Database> => ({
  prepare: vi.fn().mockReturnValue({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
  }),
  transaction: vi.fn((fn) => fn()),
  close: vi.fn(),
});