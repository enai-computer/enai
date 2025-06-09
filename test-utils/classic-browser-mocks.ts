import { vi } from 'vitest';
import type { ClassicBrowserState, ClassicBrowserTab } from '../shared/types';

export const createMockClassicBrowserTab = (overrides: Partial<ClassicBrowserTab> = {}): ClassicBrowserTab => ({
  id: 'tab-1',
  url: 'https://example.com',
  title: 'Example',
  faviconUrl: null,
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  ...overrides
});

export const createMockClassicBrowserPayload = (overrides: Partial<ClassicBrowserState> = {}): ClassicBrowserState => ({
  initialUrl: 'https://example.com',
  tabs: [createMockClassicBrowserTab()],
  activeTabId: 'tab-1',
  ...overrides
});

export const createMockWindowMeta = (overrides: any = {}) => ({
  id: 'window-1',
  type: 'classic-browser',
  title: 'Browser Window',
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  zIndex: 1,
  isFocused: true,
  payload: createMockClassicBrowserPayload(),
  ...overrides
});

export const createMockBrowserStateUpdate = (windowId: string, tabUpdate: Partial<ClassicBrowserTab>) => ({
  windowId,
  update: {
    tab: tabUpdate
  }
});

export const setupClassicBrowserMocks = () => {
  const mocks = {
    classicBrowserCreate: vi.fn().mockResolvedValue({ success: true }),
    classicBrowserDestroy: vi.fn().mockResolvedValue(undefined),
    classicBrowserGetState: vi.fn().mockResolvedValue(null),
    classicBrowserSetBounds: vi.fn().mockResolvedValue(undefined),
    classicBrowserLoadUrl: vi.fn().mockResolvedValue(undefined),
    classicBrowserNavigate: vi.fn().mockResolvedValue(undefined),
    classicBrowserSetVisibility: vi.fn().mockResolvedValue(undefined),
    classicBrowserRequestFocus: vi.fn().mockResolvedValue(undefined),
    onClassicBrowserState: vi.fn((callback) => {
      // Store callback for test access
      mocks.onClassicBrowserState._callbacks.push(callback);
      // Return unsubscribe function
      return () => {
        const index = mocks.onClassicBrowserState._callbacks.indexOf(callback);
        if (index > -1) {
          mocks.onClassicBrowserState._callbacks.splice(index, 1);
        }
      };
    }),
    onClassicBrowserNavigate: vi.fn((callback) => {
      mocks.onClassicBrowserNavigate._callbacks.push(callback);
      return () => {
        const index = mocks.onClassicBrowserNavigate._callbacks.indexOf(callback);
        if (index > -1) {
          mocks.onClassicBrowserNavigate._callbacks.splice(index, 1);
        }
      };
    })
  };

  // Add callback storage for testing
  mocks.onClassicBrowserState._callbacks = [] as any[];
  mocks.onClassicBrowserNavigate._callbacks = [] as any[];

  // Helper to trigger state updates in tests
  mocks.onClassicBrowserState.triggerUpdate = (update: any) => {
    mocks.onClassicBrowserState._callbacks.forEach(cb => cb(update));
  };

  mocks.onClassicBrowserNavigate.triggerUpdate = (update: any) => {
    mocks.onClassicBrowserNavigate._callbacks.forEach(cb => cb(update));
  };

  return mocks;
};

export const resetClassicBrowserMocks = (mocks: ReturnType<typeof setupClassicBrowserMocks>) => {
  Object.values(mocks).forEach(mock => {
    if (typeof mock === 'function' && 'mockClear' in mock) {
      mock.mockClear();
    }
  });
  mocks.onClassicBrowserState._callbacks = [];
  mocks.onClassicBrowserNavigate._callbacks = [];
};