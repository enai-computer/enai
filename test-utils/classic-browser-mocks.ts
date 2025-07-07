import { vi } from 'vitest';
import type { ClassicBrowserPayload, TabState, ClassicBrowserStateUpdate } from '../shared/types';

export const createMockClassicBrowserTab = (overrides: Partial<TabState> = {}): TabState => ({
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

export const createMockClassicBrowserPayload = (overrides: Partial<ClassicBrowserPayload> = {}): ClassicBrowserPayload => ({
  tabs: [createMockClassicBrowserTab()],
  activeTabId: 'tab-1',
  freezeState: { type: 'ACTIVE' },
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

export const createMockBrowserStateUpdate = (windowId: string, tabUpdate: Partial<TabState> & { id: string }): ClassicBrowserStateUpdate => ({
  windowId,
  update: {
    tab: { ...tabUpdate, id: tabUpdate.id || 'tab-1' }
  }
});

// Extended mock type with test helpers
interface ExtendedMock<T extends (...args: any[]) => any> extends ReturnType<typeof vi.fn<T>> {
  _callbacks: Parameters<T>[0][];
  triggerUpdate: (update: any) => void;
}

export const setupClassicBrowserMocks = () => {
  // Create base mocks
  const onClassicBrowserStateMock = vi.fn((callback: any) => {
    onClassicBrowserStateMock._callbacks.push(callback);
    return () => {
      const index = onClassicBrowserStateMock._callbacks.indexOf(callback);
      if (index > -1) {
        onClassicBrowserStateMock._callbacks.splice(index, 1);
      }
    };
  }) as ExtendedMock<(callback: any) => () => void>;

  // Initialize callback arrays
  onClassicBrowserStateMock._callbacks = [];

  // Add trigger helpers
  onClassicBrowserStateMock.triggerUpdate = (update: any) => {
    onClassicBrowserStateMock._callbacks.forEach(cb => cb(update));
  };

  const mocks = {
    classicBrowserCreate: vi.fn().mockResolvedValue({ success: true }),
    classicBrowserDestroy: vi.fn().mockResolvedValue(undefined),
    classicBrowserGetState: vi.fn().mockResolvedValue(null),
    classicBrowserSetBounds: vi.fn().mockResolvedValue(undefined),
    classicBrowserLoadUrl: vi.fn().mockResolvedValue(undefined),
    classicBrowserNavigate: vi.fn().mockResolvedValue(undefined),
    classicBrowserSetVisibility: vi.fn().mockResolvedValue(undefined),
    classicBrowserRequestFocus: vi.fn().mockResolvedValue(undefined),
    onClassicBrowserState: onClassicBrowserStateMock
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
};