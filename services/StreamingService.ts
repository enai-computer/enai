import { WebContents } from 'electron';

export interface StreamingEvents {
  chunk: string;
  end: string;
  error: string;
}

interface StreamState {
  controller: AbortController;
  buffer: string;
  timeoutId: NodeJS.Timeout | null;
}

export type StreamStartFn<T> = (
  onChunk: (chunk: string) => void,
  onEnd: (result: T) => void,
  onError: (err: Error | unknown) => void,
  signal: AbortSignal
) => Promise<void>;

export class StreamingService {
  private activeStreams = new Map<number, StreamState>();
  private throttleMs: number;

  constructor(throttleMs = 10) {
    this.throttleMs = throttleMs;
  }

  async startStream<T>(
    sender: WebContents,
    events: StreamingEvents,
    startFn: StreamStartFn<T>,
    onEndPayload: (result: T) => Promise<any> | any
  ) {
    const id = sender.id;
    if (this.activeStreams.has(id)) {
      this.stopStream(id);
    }

    const controller = new AbortController();
    const state: StreamState = { controller, buffer: '', timeoutId: null };
    this.activeStreams.set(id, state);

    const flush = () => {
      if (state.buffer.length > 0 && !sender.isDestroyed()) {
        sender.send(events.chunk, state.buffer);
        state.buffer = '';
      }
      if (state.timeoutId) {
        clearTimeout(state.timeoutId);
        state.timeoutId = null;
      }
    };

    const onChunk = (chunk: string) => {
      if (sender.isDestroyed()) {
        this.stopStream(id);
        return;
      }
      state.buffer += chunk;
      if (state.timeoutId) clearTimeout(state.timeoutId);
      state.timeoutId = setTimeout(flush, this.throttleMs);
    };

    const onEnd = async (result: T) => {
      flush();
      if (!sender.isDestroyed()) {
        sender.send(events.end, await onEndPayload(result));
      }
      this.activeStreams.delete(id);
    };

    const onError = (err: Error | unknown) => {
      flush();
      if (!sender.isDestroyed()) {
        sender.send(events.error, err instanceof Error ? err.message : String(err));
      }
      this.activeStreams.delete(id);
    };

    try {
      await startFn(onChunk, onEnd, onError, controller.signal);
    } catch (e) {
      onError(e);
    }
  }

  stopStream(senderId: number) {
    const state = this.activeStreams.get(senderId);
    if (state) {
      state.controller.abort();
      if (state.timeoutId) clearTimeout(state.timeoutId);
      this.activeStreams.delete(senderId);
    }
  }
}
