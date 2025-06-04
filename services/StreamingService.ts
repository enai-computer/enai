import { WebContents } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import {
  STREAMING_CHUNK,
  STREAMING_END,
  STREAMING_ERROR,
  STREAMING_ABORTED,
} from '../shared/ipcChannels';
import { logger } from '../utils/logger';
import { performanceTracker } from '../utils/performanceTracker';

export interface StreamRequestOptions<ResultType = any> {
  start: (
    onChunk: (chunk: string) => void,
    onEnd: (result: ResultType) => void,
    onError: (error: unknown) => void,
    signal: AbortSignal
  ) => Promise<void>;
  correlationId?: string;
}

const THROTTLE_INTERVAL_MS = 10;

class StreamingService {
  private activeStreams: Map<
    number,
    {
      controller: AbortController;
      buffer: string;
      timeoutId: NodeJS.Timeout | null;
      correlationId: string;
      firstChunkReceived: boolean;
    }
  > = new Map();

  async initiateStream<ResultType = any>(
    options: StreamRequestOptions<ResultType>,
    sender: WebContents
  ): Promise<void> {
    const { start, correlationId: providedId } = options;
    const webContentsId = sender.id;

    if (this.activeStreams.has(webContentsId)) {
      logger.warn(
        `[StreamingService] Sender ${webContentsId} already has an active stream. Aborting previous one.`
      );
      this.cancelStream(webContentsId);
    }

    const correlationId = providedId || uuidv4();
    const controller = new AbortController();
    const streamData = {
      controller,
      buffer: '',
      timeoutId: null as NodeJS.Timeout | null,
      correlationId,
      firstChunkReceived: false,
    };
    this.activeStreams.set(webContentsId, streamData);

    performanceTracker.startStream(correlationId, 'StreamingService');
    logger.info(
      `[StreamingService] Starting stream for sender ${webContentsId} with correlationId ${correlationId}`
    );

    const flushBuffer = () => {
      try {
        if (streamData.buffer.length > 0 && !sender.isDestroyed()) {
          sender.send(STREAMING_CHUNK, streamData.buffer);
          streamData.buffer = '';
        }
      } catch (err) {
        logger.error(
          `[StreamingService] Error sending chunk to sender ${webContentsId}:`,
          err
        );
        this.cancelStream(webContentsId);
      }
      if (streamData.timeoutId) {
        clearTimeout(streamData.timeoutId);
        streamData.timeoutId = null;
      }
    };

    const onChunk = (chunk: string) => {
      if (sender.isDestroyed()) {
        logger.warn(
          `[StreamingService] Sender ${webContentsId} destroyed. Aborting stream.`
        );
        this.cancelStream(webContentsId);
        return;
      }

      if (!streamData.firstChunkReceived) {
        streamData.firstChunkReceived = true;
        performanceTracker.recordEvent(
          correlationId,
          'StreamingService',
          'first_chunk_received',
          { chunkLength: chunk.length }
        );
      }

      streamData.buffer += chunk;
      if (streamData.timeoutId) clearTimeout(streamData.timeoutId);
      streamData.timeoutId = setTimeout(flushBuffer, THROTTLE_INTERVAL_MS);
    };

    const onEnd = (result: ResultType) => {
      logger.info(
        `[StreamingService] Stream ended for sender ${webContentsId}.`
      );
      performanceTracker.recordEvent(
        correlationId,
        'StreamingService',
        'stream_end'
      );
      flushBuffer();
      try {
        if (!sender.isDestroyed()) {
          sender.send(STREAMING_END, result);
        }
      } catch (err) {
        logger.error(
          `[StreamingService] Error sending stream end to sender ${webContentsId}:`,
          err
        );
      }
      this.activeStreams.delete(webContentsId);
      performanceTracker.completeStream(correlationId, 'StreamingService');
    };

    const onError = (error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'An error occurred during streaming';
      logger.error(
        `[StreamingService] Stream error for sender ${webContentsId}:`,
        error
      );
      flushBuffer();
      try {
        if (!sender.isDestroyed()) {
          sender.send(STREAMING_ERROR, message);
        }
      } catch (err) {
        logger.error(
          `[StreamingService] Error sending stream error to sender ${webContentsId}:`,
          err
        );
      }
      this.activeStreams.delete(webContentsId);
    };

    try {
      await start(onChunk, onEnd, onError, controller.signal);
    } catch (err) {
      logger.error(
        `[StreamingService] Failed to initiate stream for sender ${webContentsId}:`,
        err
      );
      onError(err);
    }
  }

  cancelStream(webContentsId: number): void {
    const info = this.activeStreams.get(webContentsId);
    if (info) {
      logger.info(
        `[StreamingService] Cancelling stream for sender ${webContentsId}.`
      );
      info.controller.abort();
      if (info.timeoutId) {
        clearTimeout(info.timeoutId);
      }
      this.activeStreams.delete(webContentsId);
    } else {
      logger.debug(
        `[StreamingService] No active stream found for sender ${webContentsId} to cancel.`
      );
    }
  }
}

export { StreamingService };
export type { StreamRequestOptions };

// Lazy singleton instance for convenience
let _streamingService: StreamingService | null = null;

export function getStreamingService(): StreamingService {
  if (!_streamingService) {
    _streamingService = new StreamingService();
  }
  return _streamingService;
}
