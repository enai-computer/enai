import { vi } from 'vitest';

/**
 * Creates a mock window.api object for testing IPC communication
 * @param overrides Specific methods to override with custom implementations
 */
export const createMockWindowApi = (overrides: Partial<any> = {}) => ({
  // Chat methods
  getMessages: vi.fn().mockResolvedValue([]),
  startChatStream: vi.fn(),
  stopChatStream: vi.fn(),
  onChatChunk: vi.fn().mockReturnValue(vi.fn()), // Returns unsubscribe function
  onChatStreamEnd: vi.fn().mockReturnValue(vi.fn()),
  onChatStreamError: vi.fn().mockReturnValue(vi.fn()),
  getSliceDetails: vi.fn(),
  
  // Add other commonly mocked IPC methods here as needed
  ...overrides
});

/**
 * Helper to capture event callbacks from IPC listeners
 * Usage:
 * const callbacks = createCallbackCapture();
 * mockApi.onChatChunk.mockImplementation(callbacks.capture('chunk'));
 * // Later: callbacks.trigger('chunk', 'data');
 */
export const createCallbackCapture = () => {
  const callbacks: Record<string, Function> = {};
  
  return {
    capture: (name: string) => (cb: Function) => {
      callbacks[name] = cb;
      return vi.fn(); // Return mock unsubscribe
    },
    trigger: (name: string, ...args: any[]) => {
      if (callbacks[name]) {
        callbacks[name](...args);
      }
    },
    has: (name: string) => !!callbacks[name]
  };
};