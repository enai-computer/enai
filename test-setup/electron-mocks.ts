import { vi } from 'vitest';
import { setupClassicBrowserMocks } from '../test-utils/classic-browser-mocks';

// Setup global window.api mock
const classicBrowserMocks = setupClassicBrowserMocks();

global.window = global.window || {};
global.window.api = {
  // Classic Browser API
  classicBrowserCreate: classicBrowserMocks.classicBrowserCreate,
  classicBrowserDestroy: classicBrowserMocks.classicBrowserDestroy,
  classicBrowserGetState: classicBrowserMocks.classicBrowserGetState,
  classicBrowserSetBounds: classicBrowserMocks.classicBrowserSetBounds,
  classicBrowserLoadUrl: classicBrowserMocks.classicBrowserLoadUrl,
  classicBrowserNavigate: classicBrowserMocks.classicBrowserNavigate,
  classicBrowserSetVisibility: classicBrowserMocks.classicBrowserSetVisibility,
  classicBrowserRequestFocus: classicBrowserMocks.classicBrowserRequestFocus,
  onClassicBrowserState: classicBrowserMocks.onClassicBrowserState,

  // Other commonly used APIs (add as needed)
  chat: {
    send: vi.fn().mockResolvedValue({ id: 'msg-1', content: 'response' }),
    stream: vi.fn(),
    getHistory: vi.fn().mockResolvedValue([])
  },
  objects: {
    search: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'obj-1' })
  },
  notebooks: {
    create: vi.fn().mockResolvedValue({ id: 'nb-1' }),
    update: vi.fn().mockResolvedValue({ id: 'nb-1' }),
    delete: vi.fn().mockResolvedValue(undefined)
  },
  // Note-related APIs
  getNotesForNotebook: vi.fn().mockResolvedValue([]),
  createNote: vi.fn().mockResolvedValue({ id: 'note-1' }),
  updateNote: vi.fn().mockResolvedValue(undefined),
  storage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
  },
  profile: {
    get: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(undefined)
  },
  activityLog: {
    record: vi.fn().mockResolvedValue(undefined)
  }
} as any;

// Export mocks for test access
export { classicBrowserMocks };

// Helper to reset all mocks between tests
export const resetAllMocks = () => {
  Object.values(global.window.api).forEach(api => {
    if (typeof api === 'object') {
      Object.values(api).forEach(method => {
        if (typeof method === 'function' && 'mockClear' in method) {
          (method as any).mockClear();
        }
      });
    } else if (typeof api === 'function' && 'mockClear' in api) {
      (api as any).mockClear();
    }
  });
  
  // Reset classic browser mock callbacks
  if (classicBrowserMocks.onClassicBrowserState._callbacks) {
    classicBrowserMocks.onClassicBrowserState._callbacks = [];
  }
};