import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useChatStream } from './useChatStream';
import type { StructuredChatMessage, ChatMessageSourceMetadata } from '@/../shared/types';

// Mock window.api for IPC calls
const mockApi = {
  getMessages: vi.fn(),
  startChatStream: vi.fn(),
  stopChatStream: vi.fn(),
  onChatChunk: vi.fn(),
  onChatStreamEnd: vi.fn(),
  onChatStreamError: vi.fn(),
  getSliceDetails: vi.fn(), // Mocked, though not directly tested in this micro-test
};

// global.window = {
//   ...global.window,
//   api: mockApi as any, // Cast to any to satisfy TypeScript for the mock
// };

describe('useChatStream', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();
    // Stub window.api for each test
    vi.stubGlobal('window', { api: mockApi }); 

    mockApi.getMessages.mockResolvedValue([]); // Default to no initial messages
    // Ensure IPC listener mocks always return a cleanup function
    mockApi.onChatChunk.mockReturnValue(vi.fn());
    mockApi.onChatStreamEnd.mockReturnValue(vi.fn());
    mockApi.onChatStreamError.mockReturnValue(vi.fn());
  });

  it('should initialize with a session ID and fetch initial messages', async () => {
    const initialMsgs: StructuredChatMessage[] = [
      { message_id: '1', session_id: 'test-session', role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
    ];
    mockApi.getMessages.mockResolvedValue(initialMsgs);

    const { result, rerender } = renderHook(() => useChatStream({ sessionId: 'test-session' }));
    
    // Wait for effects to run (message loading)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0)); // Allow promises in useEffect to resolve
    });
    
    expect(mockApi.getMessages).toHaveBeenCalledWith('test-session', 100);
    expect(result.current.messages).toEqual(initialMsgs);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle incoming chat chunks and end event', async () => {
    let chunkCallback: ((chunk: string) => void) | null = null;
    let endCallback: ((result: { messageId: string; metadata: ChatMessageSourceMetadata | null }) => void) | null = null;

    mockApi.onChatChunk.mockImplementation((cb) => {
      chunkCallback = cb;
      return vi.fn(); // Return a mock unsubscribe function
    });
    mockApi.onChatStreamEnd.mockImplementation((cb) => {
      endCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useChatStream({ sessionId: 'test-session-2' }));

    // Wait for initial message loading to complete and isLoading to be false
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0)); 
    });

    // Simulate starting a stream by calling startStream
    act(() => {
      result.current.startStream('Test input');
    });

    expect(result.current.isLoading).toBe(true);
    expect(mockApi.startChatStream).toHaveBeenCalledWith('test-session-2', 'Test input');
    // Check for the initial user message
    expect(result.current.messages.find(m => m.role === 'user' && m.content === 'Test input')).toBeDefined();

    // Simulate receiving chunks
    act(() => {
      if (chunkCallback) {
        chunkCallback('Hello ');
        chunkCallback('World');
      }
    });
    
    expect(result.current.isLoading).toBe(true);
    // The messages array in the hook should now contain a streaming assistant message
    const streamingMessage = result.current.messages.find(m => m.role === 'assistant' && m.content === 'Hello World');
    expect(streamingMessage).toBeDefined();
    expect(streamingMessage?.message_id.startsWith('streaming-temp-')).toBe(true);

    // Simulate stream end
    act(() => {
      if (endCallback) {
        endCallback({ messageId: 'final-assistant-msg-1', metadata: { sourceChunkIds: [1,2] } });
      }
    });

    expect(result.current.isLoading).toBe(false);
    const finalMessage = result.current.messages.find(m => m.message_id === 'final-assistant-msg-1');
    expect(finalMessage).toBeDefined();
    expect(finalMessage?.content).toBe('Hello World');
    expect(finalMessage?.metadata?.sourceChunkIds).toEqual([1,2]);

    // Ensure context fetching was called if metadata was present
    expect(mockApi.getSliceDetails).toHaveBeenCalledWith([1,2]);
  });

  it('should handle stream error', async () => {
    let errorCallback: ((errorMessage: string) => void) | null = null;
    mockApi.onChatStreamError.mockImplementation((cb) => {
      errorCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useChatStream({ sessionId: 'test-session-error' }));

    act(() => {
      result.current.startStream('Trigger error');
    });
    expect(result.current.isLoading).toBe(true);

    act(() => {
      if (errorCallback) {
        errorCallback('Network failure');
      }
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe('Stream error: Network failure');
  });

   it('should call stopChatStream via API when stopStream is called', () => {
    const { result } = renderHook(() => useChatStream({ sessionId: 'test-session-stop' }));

    // Simulate starting a stream to set isLoading to true
    act(() => {
      result.current.startStream('Test input for stop');
    });
    expect(result.current.isLoading).toBe(true); // Ensure it became loading

    act(() => {
      result.current.stopStream();
    });

    expect(mockApi.stopChatStream).toHaveBeenCalled();
    // Note: isLoading might still be true here, as the actual reset is handled by onEnd/onError listeners
  });

  it('should cleanup listeners and stop stream on unmount if loading', async () => {
    const mockUnsubscribeChunk = vi.fn();
    const mockUnsubscribeEnd = vi.fn();
    const mockUnsubscribeError = vi.fn();

    mockApi.onChatChunk.mockReturnValue(mockUnsubscribeChunk);
    mockApi.onChatStreamEnd.mockReturnValue(mockUnsubscribeEnd);
    mockApi.onChatStreamError.mockReturnValue(mockUnsubscribeError);

    const { unmount, result } = renderHook(() => useChatStream({ sessionId: 'test-session-unmount' }));

    // Simulate starting a stream
    act(() => {
      result.current.startStream('Test before unmount');
    });
    expect(result.current.isLoading).toBe(true);

    unmount();

    expect(mockUnsubscribeChunk).toHaveBeenCalled();
    expect(mockUnsubscribeEnd).toHaveBeenCalled();
    expect(mockUnsubscribeError).toHaveBeenCalled();
    expect(mockApi.stopChatStream).toHaveBeenCalled(); // Critical check for cleanup
  });
}); 