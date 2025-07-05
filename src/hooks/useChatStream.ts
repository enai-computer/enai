"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  StructuredChatMessage,
  ContextState,
  ChatMessageSourceMetadata
} from '@/../shared/types'; // Using alias for shared types

// Simple frontend performance tracking
const logTiming = (correlationId: string, event: string, metadata?: unknown) => {
  const timestamp = performance.now();
  console.log(`[Performance] ${correlationId} - Frontend:${event} at ${timestamp.toFixed(2)}ms`, metadata);
};

interface UseChatStreamOptions {
  sessionId: string | null;
  initialMessages?: StructuredChatMessage[];
  debugId?: string; // For distinct logging per instance
  notebookId: string; // Added notebookId
}

interface UseChatStreamReturn {
  messages: StructuredChatMessage[];
  isLoading: boolean;
  error: string | null;
  contextDetailsMap: Record<string, ContextState>;
  startStream: (inputValue: string) => void;
  stopStream: () => void;
  fetchContextForMessage: (messageId: string, sourceChunkIds: number[]) => Promise<void>;
}

export function useChatStream({
  sessionId,
  initialMessages = [],
  debugId = 'ChatStream',
  notebookId, // Destructure notebookId
}: UseChatStreamOptions): UseChatStreamReturn {
  const [messages, setMessages] = useState<StructuredChatMessage[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStreamDisplay, setCurrentStreamDisplay] = useState('');
  const currentStreamRef = useRef<string>('');
  const [error, setError] = useState<string | null>(null);
  const [contextDetailsMap, setContextDetailsMap] = useState<Record<string, ContextState>>({});
  
  // Performance tracking refs
  const streamStartTimeRef = useRef<number>(0);
  const currentCorrelationIdRef = useRef<string>('');
  const firstChunkReceivedRef = useRef<boolean>(false);

  const log = useCallback((level: 'log' | 'warn' | 'error', ...args: unknown[]) => {
    const prefix = `[${debugId}-${notebookId}-${sessionId || 'no-session'}]`; // Added notebookId to log prefix
    if (process.env.NODE_ENV === 'development') {
      console[level](prefix, ...args);
    }
  }, [debugId, sessionId, notebookId]);

  const fetchContextForMessage = useCallback(async (messageId: string, sourceChunkIds: number[]) => {
    if (!sourceChunkIds || sourceChunkIds.length === 0) return;
    
    setContextDetailsMap(prev => {
      if (prev[messageId]?.status === 'loading' || prev[messageId]?.status === 'loaded') {
        return prev;
      }
      log('log', `Fetching context for msg ${messageId} (${sourceChunkIds.length} chunks).`);
      return { ...prev, [messageId]: { status: 'loading', data: null } };
    });

    try {
      const sliceDetails = await window.api.getSliceDetails(sourceChunkIds);
      log('log', `Fetched ${sliceDetails.length} details for msg ${messageId}.`);
      setContextDetailsMap(prev => ({ ...prev, [messageId]: { status: 'loaded', data: sliceDetails } }));
    } catch (err) {
      log('error', `Failed to fetch context for msg ${messageId}:`, err);
      setContextDetailsMap(prev => ({ ...prev, [messageId]: { status: 'error', data: null } }));
    }
  }, [log]);

  // Effect for fetching initial messages when sessionId changes
  useEffect(() => {
    if (!sessionId || !notebookId) { 
      setMessages([]);
      setIsLoading(false);
      setError(null);
      setContextDetailsMap({});
      return;
    }
    
    setIsLoading(true);
    setError(null);
    setMessages([]); 
    log('log', 'Initializing and fetching initial messages.');

    const loadMessages = async () => {
      try {
        const messageLimit = 100;
        const loadedMessages = await window.api.getMessages(sessionId, messageLimit);
        const validMessages = loadedMessages || [];
        setMessages(validMessages);
        log('log', `Loaded ${validMessages.length} messages.`);

        for (const message of validMessages) {
          if (message.role === 'assistant' && message.metadata?.sourceChunkIds?.length) {
            void fetchContextForMessage(message.messageId, message.metadata.sourceChunkIds); // Use messageId
          }
        }
      } catch (fetchError) {
        log('error', 'Failed to load messages:', fetchError);
        const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        setError(`Failed to load chat history: ${errorMessage}`);
        setMessages([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadMessages();
  }, [sessionId, notebookId, fetchContextForMessage, log]);

  // Effect for handling IPC listeners for chat streaming
  useEffect(() => {
    if (!sessionId) return;

    log('log', 'Setting up IPC listeners for chat stream.');
    currentStreamRef.current = ''; // Reset on session change or listener setup

    const handleChunk = (chunk: string) => {
      // Track first chunk timing
      if (!firstChunkReceivedRef.current && currentCorrelationIdRef.current) {
        firstChunkReceivedRef.current = true;
        const elapsed = performance.now() - streamStartTimeRef.current;
        logTiming(currentCorrelationIdRef.current, 'first_chunk_received', { 
          elapsed: `${elapsed.toFixed(2)}ms`,
          chunkLength: chunk.length 
        });
      }
      
      currentStreamRef.current += chunk;
      setCurrentStreamDisplay(currentStreamRef.current);
    };

    const handleEnd = (result: { messageId: string; metadata: ChatMessageSourceMetadata | null }) => {
      log('log', `Stream ended. New message ID: ${result.messageId}`);
      
      // Track stream completion timing
      if (currentCorrelationIdRef.current) {
        const elapsed = performance.now() - streamStartTimeRef.current;
        logTiming(currentCorrelationIdRef.current, 'stream_complete', { 
          elapsed: `${elapsed.toFixed(2)}ms`,
          messageId: result.messageId,
          hasMetadata: !!result.metadata,
          totalLength: currentStreamRef.current.length
        });
      }
      
      setIsLoading(false);
      const finalContentFromStream = currentStreamRef.current;

      setMessages(prevMessages => {
        const updatedMessages = [...prevMessages];
        const tempMessageIndex = updatedMessages.findLastIndex(m => m.messageId.startsWith('streaming-temp-')); // Use messageId
        
        if (tempMessageIndex !== -1) {
          updatedMessages[tempMessageIndex] = {
            ...updatedMessages[tempMessageIndex],
            messageId: result.messageId, // Use messageId
            content: finalContentFromStream,
            metadata: result.metadata,
            timestamp: new Date(), // Use Date object
          };
        } else {
          log('warn', `No temporary streaming message found. Adding new message ${result.messageId}.`);
          updatedMessages.push({
            messageId: result.messageId, // Use messageId
            sessionId: sessionId, // Use sessionId
            role: 'assistant',
            content: finalContentFromStream,
            timestamp: new Date(), // Use Date object
            metadata: result.metadata,
          });
        }
        return updatedMessages;
      });

      if (result.metadata?.sourceChunkIds?.length) {
        void fetchContextForMessage(result.messageId, result.metadata.sourceChunkIds);
      }
      setCurrentStreamDisplay('');
      currentStreamRef.current = '';
    };

    const handleError = (errorMessage: string) => {
      log('error', 'Stream error:', errorMessage);
      setError(`Stream error: ${errorMessage}`);
      setIsLoading(false);
      setCurrentStreamDisplay('');
      currentStreamRef.current = '';
    };

    const removeChunkListener = window.api.onChatChunk(handleChunk);
    const removeEndListener = window.api.onChatStreamEnd(handleEnd);
    const removeErrorListener = window.api.onChatStreamError(handleError);

    return () => {
      log('log', 'Removing IPC listeners for chat stream.');
      removeChunkListener();
      removeEndListener();
      removeErrorListener();
      // If the hook is cleaning up while a stream is active (e.g. component unmount, sessionId change)
      if (isLoading) { // Check current isLoading state of the hook
        log('log', 'Cleanup with active stream. Requesting stream stop.');
        window.api.stopChatStream(); // This doesn't need notebookId to stop by sender
        setIsLoading(false); // Also reset loading state locally
        setCurrentStreamDisplay('');
        currentStreamRef.current = '';
      }
    };
  }, [sessionId, isLoading, fetchContextForMessage, log]); // Added isLoading to dependency array for cleanup logic

  const startStream = useCallback((inputValue: string) => {
    if (!inputValue.trim() || isLoading || !sessionId || !notebookId) return; 

    const userMessage: StructuredChatMessage = {
      messageId: `user-temp-${Date.now()}`, // Use messageId
      sessionId: sessionId, // Use sessionId
      role: 'user',
      content: inputValue,
      timestamp: new Date(), // Use Date object
      metadata: null,
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);
    setCurrentStreamDisplay(''); 
    currentStreamRef.current = '';

    // Generate a simple correlationId for this stream
    const streamCorrelationId = `stream-${Date.now()}`;
    streamStartTimeRef.current = performance.now();
    firstChunkReceivedRef.current = false; // Reset for new stream
    
    log('log', `Starting chat stream with correlationId: ${streamCorrelationId}`);
    logTiming(streamCorrelationId, 'stream_start_requested', { sessionId, notebookId });
    
    // Store correlationId for use in callbacks
    currentCorrelationIdRef.current = streamCorrelationId;
    
    // Pass notebookId, sessionId, and inputValue as a single object payload
    window.api.startChatStream({ notebookId, sessionId, question: inputValue });
  }, [isLoading, sessionId, notebookId, log]);

  const stopStream = useCallback(() => {
    if (isLoading && sessionId) { // No notebookId needed for stop by sender
      log('log', 'User requested stop stream.');
      window.api.stopChatStream();
      // isLoading state will be reset by the stream listeners (onEnd or onError)
    }
  }, [isLoading, sessionId, log]);

  // Memoized messages to include the current streaming display
  const messagesWithStream = useMemo(() => {
    const messageList = [...messages];
    if (isLoading && currentStreamDisplay) {
      const lastAssistantIndex = messageList.findLastIndex(m => m.role === 'assistant');
      if (lastAssistantIndex !== -1 && (messageList[lastAssistantIndex].messageId.startsWith('streaming-temp-') || messageList[lastAssistantIndex].content !== currentStreamRef.current)) { // Use messageId
        messageList[lastAssistantIndex] = {
          ...messageList[lastAssistantIndex],
          content: currentStreamDisplay,
          // timestamp will be updated when stream ends if it's a temp message
        };
      } else if (lastAssistantIndex === -1 || messageList[lastAssistantIndex].content !== currentStreamDisplay) {
        messageList.push({
          messageId: `streaming-temp-${Date.now()}`, // Use messageId
          sessionId: sessionId!, 
          role: 'assistant',
          content: currentStreamDisplay,
          timestamp: new Date(), // Use Date object
          metadata: null,
        });
      }
    }
    return messageList;
  }, [messages, isLoading, currentStreamDisplay, sessionId]);

  return {
    messages: messagesWithStream,
    isLoading,
    error,
    contextDetailsMap,
    startStream,
    stopStream,
    fetchContextForMessage, // Expose this if ChatWindow needs to trigger it for older messages
  };
} 