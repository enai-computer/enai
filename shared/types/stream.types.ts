export interface StreamEndPayload {
  [key: string]: any;
}

export interface StreamEvents {
  onStart: string;
  onChunk: string;
  onEnd: string;
  onError: string;
}

export interface StreamStartEvent {
  streamId: string;
}

export interface StreamChunkEvent {
  streamId: string;
  chunk: string;
}

export interface StreamEndEvent {
  streamId: string;
  payload: StreamEndPayload;
}

export interface StreamErrorEvent {
  streamId: string;
  error: string;
}