import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useChatStream } from '../useChatStream';
import type { StructuredChatMessage, ChatMessageSourceMetadata } from '@/../shared/types';
import { createMockWindowApi, createCallbackCapture } from '@/../test-utils/mocks/window';

describe('useChatStream', () => {
  let mockApi: ReturnType<typeof createMockWindowApi>;
  let callbacks: ReturnType<typeof createCallbackCapture>;

  beforeEach(() => {
    // Create fresh mocks for each test
    mockApi = createMockWindowApi();
    callbacks = createCallbackCapture();
    
    // Set up callback capturing
    mockApi.onChatChunk.mockImplementation(callbacks.capture('chunk'));
    mockApi.onChatStreamEnd.mockImplementation(callbacks.capture('end'));
    mockApi.onChatStreamError.mockImplementation(callbacks.capture('error'));
    
    // Stub window.api
    vi.stubGlobal('window', { api: mockApi });
  });

  it('should initialize with a session ID and fetch initial messages', async () => {
    const initialMessages: StructuredChatMessage[] = [
      { 
        messageId: '1', 
        sessionId: 'test-session', 
        role: 'user', 
        content: 'Hello', 
        timestamp: new Date().toISOString(), 
        metadata: null 
      },
    ];
    mockApi.getMessages.mockResolvedValue(initialMessages);

    const { result } = renderHook(() => 
      useChatStream({ sessionId: 'test-session', notebookId: 'test-notebook' })
    );
    
    // Wait for initial load
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    
    expect(mockApi.getMessages).toHaveBeenCalledWith('test-session', 100);
    expect(result.current.messages).toEqual(initialMessages);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle incoming chat chunks and end event', async () => {
    const { result } = renderHook(() => 
      useChatStream({ sessionId: 'test-session-2', notebookId: 'test-notebook' })
    );

    // Wait for initial load
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Start streaming
    act(() => {
      result.current.startStream('Test input');
    });

    expect(result.current.isLoading).toBe(true);
    expect(mockApi.startChatStream).toHaveBeenCalledWith({
      notebookId: 'test-notebook',
      sessionId: 'test-session-2',
      question: 'Test input'
    });
    
    // Verify user message was added
    expect(result.current.messages).toContainEqual(
      expect.objectContaining({
        role: 'user',
        content: 'Test input'
      })
    );

    // Simulate receiving chunks
    act(() => {
      callbacks.trigger('chunk', 'Hello ');
      callbacks.trigger('chunk', 'World');
    });
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Check streaming message
    const streamingMsg = result.current.messages.find(
      m => m.role === 'assistant' && m.content === 'Hello World'
    );
    expect(streamingMsg).toBeDefined();
    expect(streamingMsg?.messageId).toMatch(/^streaming-temp-/);

    // Simulate stream end
    const metadata: ChatMessageSourceMetadata = { sourceChunkIds: [1, 2] };
    act(() => {
      callbacks.trigger('end', { 
        messageId: 'final-assistant-msg-1', 
        metadata 
      });
    });

    // Verify final state
    expect(result.current.isLoading).toBe(false);
    const finalMsg = result.current.messages.find(
      m => m.messageId === 'final-assistant-msg-1'
    );
    expect(finalMsg).toBeDefined();
    expect(finalMsg?.content).toBe('Hello World');
    expect(finalMsg?.metadata).toEqual(metadata);
    expect(mockApi.getSliceDetails).toHaveBeenCalledWith([1, 2]);
  });

  it('should handle stream error', async () => {
    const { result } = renderHook(() => 
      useChatStream({ sessionId: 'test-session-error', notebookId: 'test-notebook' })
    );

    act(() => {
      result.current.startStream('Trigger error');
    });
    
    expect(result.current.isLoading).toBe(true);

    act(() => {
      callbacks.trigger('error', 'Network failure');
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe('Stream error: Network failure');
  });

  it('should stop stream when requested', () => {
    const { result } = renderHook(() => 
      useChatStream({ sessionId: 'test-session-stop', notebookId: 'test-notebook' })
    );

    // Start stream
    act(() => {
      result.current.startStream('Test input for stop');
    });
    expect(result.current.isLoading).toBe(true);

    // Stop stream
    act(() => {
      result.current.stopStream();
    });

    expect(mockApi.stopChatStream).toHaveBeenCalled();
  });

  it('should cleanup on unmount', async () => {
    const unsubscribeMocks = {
      chunk: vi.fn(),
      end: vi.fn(),
      error: vi.fn()
    };

    mockApi.onChatChunk.mockReturnValue(unsubscribeMocks.chunk);
    mockApi.onChatStreamEnd.mockReturnValue(unsubscribeMocks.end);
    mockApi.onChatStreamError.mockReturnValue(unsubscribeMocks.error);

    const { unmount, result } = renderHook(() => 
      useChatStream({ sessionId: 'test-session-unmount', notebookId: 'test-notebook' })
    );

    // Start stream before unmount
    act(() => {
      result.current.startStream('Test before unmount');
    });
    expect(result.current.isLoading).toBe(true);

    // Unmount and verify cleanup
    unmount();

    expect(unsubscribeMocks.chunk).toHaveBeenCalled();
    expect(unsubscribeMocks.end).toHaveBeenCalled();
    expect(unsubscribeMocks.error).toHaveBeenCalled();
    expect(mockApi.stopChatStream).toHaveBeenCalled();
  });
});