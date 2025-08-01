import { WebContents } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { StreamEvents, StreamEndPayload } from '../shared/types/stream.types';
import { IService } from './interfaces';

interface ActiveStream {
  abortController: AbortController;
  correlationId: string;
}

/**
 * StreamManager provides a unified streaming interface for all services.
 * It handles buffering, error management, and lifecycle control for streaming operations.
 */
export class StreamManager implements IService {
  private static instance: StreamManager;
  private activeStreams = new Map<number, ActiveStream>();
  private readonly BUFFER_FLUSH_MS = 50;

  private constructor() {
    logger.info('[StreamManager] Initialized');
  }

  static getInstance(): StreamManager {
    if (!StreamManager.instance) {
      StreamManager.instance = new StreamManager();
    }
    return StreamManager.instance;
  }

  /**
   * Start streaming data to a WebContents instance.
   * 
   * @param sender - The WebContents to send stream events to
   * @param streamSource - Async generator that yields string chunks
   * @param channels - IPC channel names for stream events
   * @param endPayload - Optional data to include with stream end event
   * @param correlationId - Optional correlation ID for the stream
   * @returns The generator's return value, or null if stream was aborted
   */
  public async startStream<TResult = void>(
    sender: WebContents,
    streamSource: AsyncGenerator<string, TResult, unknown>,
    channels: StreamEvents,
    endPayload: StreamEndPayload = {},
    correlationId: string = uuidv4()
  ): Promise<TResult | null> {
    const webContentsId = sender.id;
    
    // Stop any existing stream for this sender
    this.stopStream(webContentsId);

    const abortController = new AbortController();
    this.activeStreams.set(webContentsId, { abortController, correlationId });

    let buffer = '';
    let flushTimer: NodeJS.Timeout | null = null;

    const flushBuffer = () => {
      if (buffer && !sender.isDestroyed()) {
        sender.send(channels.onChunk, { streamId: correlationId, chunk: buffer });
        buffer = '';
      }
      flushTimer = null;
    };

    let generatorResult: TResult | null = null;

    try {
      logger.debug('[StreamManager] Starting stream', { correlationId, webContentsId });

      // Send start event
      if (!sender.isDestroyed()) {
        sender.send(channels.onStart, { streamId: correlationId });
      }

      // Process stream chunks
      let done = false;
      while (!done) {
        const iteratorResult = await streamSource.next();
        
        if (iteratorResult.done) {
          done = true;
          generatorResult = iteratorResult.value;
        } else {
          const chunk = iteratorResult.value;
          
          // Check if stream was aborted or sender destroyed
          if (sender.isDestroyed() || abortController.signal.aborted) {
            logger.debug('[StreamManager] Stream interrupted', { correlationId, destroyed: sender.isDestroyed(), aborted: abortController.signal.aborted });
            return null; // Return null when aborted
          }

          // Add to buffer
          buffer += chunk;

          // Schedule flush if not already scheduled
          if (!flushTimer) {
            flushTimer = setTimeout(flushBuffer, this.BUFFER_FLUSH_MS);
          }
        }
      }

      // Final flush
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
      flushBuffer();

      // Send end event with payload
      if (!sender.isDestroyed() && !abortController.signal.aborted) {
        sender.send(channels.onEnd, { streamId: correlationId, payload: endPayload });
        logger.debug('[StreamManager] Stream completed successfully', { correlationId });
      }

      return generatorResult;

    } catch (error) {
      logger.error('[StreamManager] Stream error', { correlationId, error });
      
      // Clear any pending flush
      if (flushTimer) {
        clearTimeout(flushTimer);
      }

      // Send error event
      if (!sender.isDestroyed()) {
        sender.send(channels.onError, { 
          streamId: correlationId, 
          error: error instanceof Error ? error.message : 'Unknown streaming error' 
        });
      }

      throw error;
    } finally {
      // Clean up
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
      this.activeStreams.delete(webContentsId);
    }
  }

  /**
   * Stop any active stream for a given WebContents ID.
   * 
   * @param webContentsId - The ID of the WebContents to stop streaming to
   */
  public stopStream(webContentsId: number): void {
    const activeStream = this.activeStreams.get(webContentsId);
    if (activeStream) {
      logger.debug('[StreamManager] Stopping stream', { 
        correlationId: activeStream.correlationId, 
        webContentsId 
      });
      activeStream.abortController.abort();
      this.activeStreams.delete(webContentsId);
    }
  }

  /**
   * Get the number of active streams.
   */
  public getActiveStreamCount(): number {
    return this.activeStreams.size;
  }

  /**
   * Check if a WebContents has an active stream.
   */
  public hasActiveStream(webContentsId: number): boolean {
    return this.activeStreams.has(webContentsId);
  }

  /**
   * Initialize the service (required by IService interface)
   */
  async initialize(): Promise<void> {
    logger.info('[StreamManager] Service initialized');
  }

  /**
   * Cleanup resources (required by IService interface)
   */
  async cleanup(): Promise<void> {
    logger.info('[StreamManager] Cleaning up - stopping all active streams');
    
    // Stop all active streams
    const activeCount = this.activeStreams.size;
    for (const [webContentsId] of this.activeStreams) {
      this.stopStream(webContentsId);
    }
    
    logger.info(`[StreamManager] Cleanup complete - stopped ${activeCount} streams`);
  }

  /**
   * Check service health (required by IService interface)
   */
  async healthCheck(): Promise<boolean> {
    // Service is healthy if it can track streams
    return true;
  }
}