"use client";

import { useEffect, useRef, useState } from "react";

interface UseIntentStreamOptions {
  onStart?: (id: string) => void;
  onEnd?: (final: string, data: { streamId: string; messageId?: string }) => void;
  onError?: (error: string) => void;
}

export function useIntentStream(options: UseIntentStreamOptions = {}) {
  const [streamingMessage, setStreamingMessage] = useState("");
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const messageRef = useRef("");

  useEffect(() => {
    if (!window.api) return;
    const unsub: (() => void)[] = [];

    if (window.api.onIntentStreamStart) {
      unsub.push(
        window.api.onIntentStreamStart(({ streamId }) => {
          setActiveStreamId(streamId);
          setStreamingMessage("");
          messageRef.current = "";
          options.onStart?.(streamId);
        })
      );
    }

    if (window.api.onIntentStreamChunk) {
      unsub.push(
        window.api.onIntentStreamChunk(({ streamId, chunk }) => {
          if (streamId === activeStreamId) {
            messageRef.current += chunk;
            setStreamingMessage(messageRef.current);
          }
        })
      );
    }

    if (window.api.onIntentStreamEnd) {
      unsub.push(
        window.api.onIntentStreamEnd((data) => {
          if (data.streamId === activeStreamId) {
            options.onEnd?.(messageRef.current, data);
            setActiveStreamId(null);
            setStreamingMessage("");
            messageRef.current = "";
          }
        })
      );
    }

    if (window.api.onIntentStreamError) {
      unsub.push(
        window.api.onIntentStreamError((data) => {
          if (!data.streamId || data.streamId === activeStreamId) {
            options.onError?.(data.error);
            setActiveStreamId(null);
            setStreamingMessage("");
            messageRef.current = "";
          }
        })
      );
    }

    return () => {
      unsub.forEach((fn) => fn());
    };
  }, [activeStreamId, options]);

  return { streamingMessage, activeStreamId };
}
