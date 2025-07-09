import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StreamManager } from '../StreamManager';
import { WebContents } from 'electron';

// Type for sent messages
interface SentMessage {
  channel: string;
  data: {
    streamId?: string;
    chunk?: string;
    error?: string;
    payload?: Record<string, unknown>;
  };
}

// Mock WebContents with proper typing
class MockWebContents {
  id: number;
  destroyed = false;
  sentMessages: SentMessage[] = [];

  constructor(id: number) {
    this.id = id;
  }

  send(channel: string, data: SentMessage['data']) {
    if (!this.destroyed) {
      this.sentMessages.push({ channel, data });
    }
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
  }
}

// Helper to cast WebContents to MockWebContents for testing
function asMock(sender: WebContents): MockWebContents {
  return sender as unknown as MockWebContents;
}

describe('StreamManager', () => {
  let streamManager: StreamManager;

  beforeEach(() => {
    streamManager = StreamManager.getInstance();
  });

  describe('startStream', () => {
    it('should send start, chunk, and end events for successful stream', async () => {
      // Arrange
      const sender = new MockWebContents(1) as unknown as WebContents;
      const chunks = ['Hello', ' ', 'World'];
      async function* generator() {
        for (const chunk of chunks) {
          yield chunk;
        }
        return 'completed';
      }
      const channels = {
        onStart: 'stream:start',
        onChunk: 'stream:chunk',
        onEnd: 'stream:end',
        onError: 'stream:error'
      };

      // Act
      const result = await streamManager.startStream(
        sender,
        generator(),
        channels
      );

      // Assert
      expect(result).toBe('completed');
      const mock = asMock(sender);
      expect(mock.sentMessages[0].channel).toBe('stream:start');
      expect(mock.sentMessages[1].channel).toBe('stream:chunk');
      expect(mock.sentMessages[1].data.chunk).toBe('Hello World');
      expect(mock.sentMessages[2].channel).toBe('stream:end');
    });

    it('should handle generator errors', async () => {
      // Arrange
      const sender = new MockWebContents(2) as unknown as WebContents;
      async function* errorGenerator() {
        yield 'start';
        throw new Error('Stream failed');
      }
      const channels = {
        onStart: 'stream:start',
        onChunk: 'stream:chunk',
        onEnd: 'stream:end',
        onError: 'stream:error'
      };

      // Act & Assert
      await expect(
        streamManager.startStream(sender, errorGenerator(), channels)
      ).rejects.toThrow('Stream failed');
      
      const mock = asMock(sender);
      const errorMessage = mock.sentMessages.find(
        (msg) => msg.channel === 'stream:error'
      );
      expect(errorMessage).toBeDefined();
      expect(errorMessage?.data.error).toBe('Stream failed');
    });

    it('should return null when stream is aborted', async () => {
      // Arrange
      const sender = new MockWebContents(3) as unknown as WebContents;
      let yieldCount = 0;
      async function* longGenerator() {
        while (true) {
          yield `chunk ${yieldCount++}`;
          // Allow stopStream to be called
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      const channels = {
        onStart: 'stream:start',
        onChunk: 'stream:chunk',
        onEnd: 'stream:end',
        onError: 'stream:error'
      };

      // Act
      const streamPromise = streamManager.startStream(
        sender,
        longGenerator(),
        channels
      );
      
      // Wait for stream to start
      await new Promise(resolve => setTimeout(resolve, 50));
      streamManager.stopStream(sender.id);
      
      const result = await streamPromise;

      // Assert
      expect(result).toBeNull();
    });

    it('should stop existing stream when starting new one for same sender', async () => {
      // Arrange
      const sender = new MockWebContents(4) as unknown as WebContents;
      async function* generator1() {
        yield 'stream1';
        await new Promise(resolve => setTimeout(resolve, 100));
        yield 'should not appear';
      }
      async function* generator2() {
        yield 'stream2';
        return 'second';
      }
      const channels = {
        onStart: 'stream:start',
        onChunk: 'stream:chunk',
        onEnd: 'stream:end',
        onError: 'stream:error'
      };

      // Act
      const promise1 = streamManager.startStream(sender, generator1(), channels);
      await new Promise(resolve => setTimeout(resolve, 10));
      const promise2 = streamManager.startStream(sender, generator2(), channels);
      
      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Assert
      expect(result1).toBeNull();
      expect(result2).toBe('second');
    });

    it('should handle destroyed WebContents gracefully', async () => {
      // Arrange
      const sender = new MockWebContents(5) as unknown as WebContents;
      async function* generator() {
        yield 'chunk1';
        // Wait for chunk to be buffered before destroying
        await new Promise(resolve => setTimeout(resolve, 60));
        asMock(sender).destroy();
        yield 'chunk2';
      }
      const channels = {
        onStart: 'stream:start',
        onChunk: 'stream:chunk',
        onEnd: 'stream:end',
        onError: 'stream:error'
      };

      // Act
      const result = await streamManager.startStream(sender, generator(), channels);

      // Assert
      expect(result).toBeNull();
      expect(asMock(sender).sentMessages.length).toBe(2); // start + first chunk only
    });

    it('should include custom end payload', async () => {
      // Arrange
      const sender = new MockWebContents(6) as unknown as WebContents;
      async function* generator() {
        yield 'data';
      }
      const channels = {
        onStart: 'stream:start',
        onChunk: 'stream:chunk',
        onEnd: 'stream:end',
        onError: 'stream:error'
      };
      const endPayload = { summary: 'test complete', count: 42 };

      // Act
      await streamManager.startStream(sender, generator(), channels, endPayload);

      // Assert
      const mock = asMock(sender);
      const endMessage = mock.sentMessages.find(
        (msg) => msg.channel === 'stream:end'
      );
      expect(endMessage?.data.payload).toEqual(endPayload);
    });
  });

  describe('stopStream', () => {
    it('should abort active stream', async () => {
      // Arrange
      const sender = new MockWebContents(7) as unknown as WebContents;
      let streamCount = 0;
      async function* generator() {
        while (streamCount < 10) {
          yield `chunk ${streamCount++}`;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      const channels = {
        onStart: 'stream:start',
        onChunk: 'stream:chunk',
        onEnd: 'stream:end',
        onError: 'stream:error'
      };

      // Act
      const streamPromise = streamManager.startStream(sender, generator(), channels);
      await new Promise(resolve => setTimeout(resolve, 50));
      streamManager.stopStream(sender.id);
      const result = await streamPromise;

      // Assert
      expect(result).toBeNull();
      expect(streamCount).toBeLessThan(10);
    });

    it('should do nothing if no active stream exists', () => {
      // Act & Assert - should not throw
      expect(() => streamManager.stopStream(999)).not.toThrow();
    });
  });

  describe('getActiveStreamCount', () => {
    it('should return count of active streams', async () => {
      // Arrange
      const sender1 = new MockWebContents(8) as unknown as WebContents;
      const sender2 = new MockWebContents(9) as unknown as WebContents;
      async function* generator() {
        yield 'data';
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const channels = {
        onStart: 'stream:start',
        onChunk: 'stream:chunk',
        onEnd: 'stream:end',
        onError: 'stream:error'
      };

      // Act & Assert
      expect(streamManager.getActiveStreamCount()).toBe(0);
      
      const promise1 = streamManager.startStream(sender1, generator(), channels);
      const promise2 = streamManager.startStream(sender2, generator(), channels);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(streamManager.getActiveStreamCount()).toBe(2);
      
      await Promise.all([promise1, promise2]);
      expect(streamManager.getActiveStreamCount()).toBe(0);
    });
  });

  describe('hasActiveStream', () => {
    it('should return true for active stream', async () => {
      // Arrange
      const sender = new MockWebContents(10) as unknown as WebContents;
      async function* generator() {
        yield 'data';
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const channels = {
        onStart: 'stream:start',
        onChunk: 'stream:chunk',
        onEnd: 'stream:end',
        onError: 'stream:error'
      };

      // Act
      const promise = streamManager.startStream(sender, generator(), channels);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Assert
      expect(streamManager.hasActiveStream(sender.id)).toBe(true);
      expect(streamManager.hasActiveStream(999)).toBe(false);
      
      await promise;
      expect(streamManager.hasActiveStream(sender.id)).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should stop all active streams', async () => {
      // Arrange
      const sender1 = new MockWebContents(11) as unknown as WebContents;
      const sender2 = new MockWebContents(12) as unknown as WebContents;
      async function* generator() {
        while (true) {
          yield 'continuous';
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      const channels = {
        onStart: 'stream:start',
        onChunk: 'stream:chunk',
        onEnd: 'stream:end',
        onError: 'stream:error'
      };

      // Act
      streamManager.startStream(sender1, generator(), channels);
      streamManager.startStream(sender2, generator(), channels);
      
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(streamManager.getActiveStreamCount()).toBe(2);
      
      await streamManager.cleanup();

      // Assert
      expect(streamManager.getActiveStreamCount()).toBe(0);
    });
  });

  describe('healthCheck', () => {
    it('should return true', async () => {
      // Act & Assert
      expect(await streamManager.healthCheck()).toBe(true);
    });
  });
});