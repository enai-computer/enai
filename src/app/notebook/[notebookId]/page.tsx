"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { BookmarkUploadDialog } from "@/components/BookmarkUploadDialog";
import { Chat } from "@/components/ui/chat";
import { IChatMessage, SliceDetail, ChatMessageSourceMetadata, ContextState, StructuredChatMessage } from '../../../../shared/types'; // Adjusted import path

/**
 * Page for displaying the chat interface within a specific notebook.
 * Includes a menu for Settings and Upload Data.
 */
export default function NotebookPage() { // Renamed component
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  // --- Chat State ---
  const [messages, setMessages] = useState<StructuredChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStreamDisplay, setCurrentStreamDisplay] = useState('');
  const currentStreamRef = useRef<string>('');
  const [error, setError] = useState<string | null>(null);
  
  // TODO: This will need to come from route params
  const currentSessionId = 'static-session-id-notebook-page'; // Placeholder

  // --- Context Slice State ---
  const [contextDetailsMap, setContextDetailsMap] = useState<Record<string, ContextState>>({});

  // --- Helper to Fetch Context --- 
  const fetchContextForMessage = useCallback(async (messageId: string, sourceChunkIds: number[]) => {
    setContextDetailsMap(prev => {
      if (!sourceChunkIds || sourceChunkIds.length === 0 || prev[messageId]?.status === 'loading' || prev[messageId]?.status === 'loaded') {
        return prev;
      }
      console.log(`[fetchContextForMessage] Fetching context for message ${messageId} with ${sourceChunkIds.length} chunk IDs.`);
      return { ...prev, [messageId]: { status: 'loading', data: null } };
    });

    try {
      const sliceDetails = await window.api.getSliceDetails(sourceChunkIds);
      console.log(`[fetchContextForMessage] Successfully fetched ${sliceDetails.length} details for message ${messageId}.`);
      setContextDetailsMap(prev => ({ ...prev, [messageId]: { status: 'loaded', data: sliceDetails } }));
    } catch (err) {
      console.error(`[fetchContextForMessage] Failed to fetch context for message ${messageId}:`, err);
      setContextDetailsMap(prev => ({ ...prev, [messageId]: { status: 'error', data: null } }));
    }
  }, [setContextDetailsMap]);

  // Fetch initial messages
  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setMessages([]); 

    const loadMessages = async () => {
        try {
            const messageLimit = 50;
            console.log(`[Effect LoadMessages] Fetching up to ${messageLimit} messages for session: ${currentSessionId}`);
            const loadedMessages = await window.api.getMessages(currentSessionId, messageLimit);
            setMessages(loadedMessages || []);
            console.log(`[Effect LoadMessages] Loaded ${loadedMessages?.length || 0} messages.`);

            if (loadedMessages) {
                for (const message of loadedMessages) {
                    if (message.role === 'assistant' && message.metadata && message.metadata.sourceChunkIds && message.metadata.sourceChunkIds.length > 0) {
                        void fetchContextForMessage(message.message_id, message.metadata.sourceChunkIds);
                    }
                }
            }
        } catch (fetchError: any) {
            console.error("[Effect LoadMessages] Failed to load messages:", fetchError);
            setError(`Failed to load chat history: ${fetchError.message || 'Unknown error'}`);
            setMessages([]);
        } finally {
            setIsLoading(false);
        }
    };

    if (currentSessionId) { // Only load if sessionId is available
        loadMessages();
    } else {
        setIsLoading(false); // No session ID, so not loading
    }
  }, [currentSessionId, fetchContextForMessage]); // Added fetchContextForMessage to dependencies

  // --- Chat Logic ---
  const messagesWithStream = useMemo(() => {
    let messageList = [...messages];
    if (isLoading && currentStreamDisplay) {
      const lastAssistantIndex = messageList.findLastIndex(m => m.role === 'assistant');
      if (lastAssistantIndex !== -1 && messageList[lastAssistantIndex].message_id.startsWith('streaming-')) {
        messageList[lastAssistantIndex] = {
          ...messageList[lastAssistantIndex],
          content: currentStreamDisplay,
        };
      } else {
        messageList.push({
          message_id: 'streaming-temp',
          session_id: currentSessionId,
          role: 'assistant',
          content: currentStreamDisplay,
          timestamp: new Date().toISOString(),
          metadata: null,
        });
      }
    }
    return messageList;
  }, [messages, isLoading, currentStreamDisplay, currentSessionId]);

  useEffect(() => {
    if (!currentSessionId) return; // Don't set up listeners if no session

    console.log(`[Effect] Setting up IPC listeners for session: ${currentSessionId}`);
    currentStreamRef.current = '';

    const handleChunk = (chunk: string) => {
      currentStreamRef.current += chunk;
      setCurrentStreamDisplay(prev => prev + chunk);
    };

    const handleEnd = (result: { messageId: string; metadata: ChatMessageSourceMetadata | null }) => {
      console.log(`[End Listener] Stream ended. Final message ID: ${result.messageId}`);
      setIsLoading(false);
      const finalContentFromStream = currentStreamRef.current;

      setMessages(prevMessages => {
        const updatedMessages = [...prevMessages];
        const lastIndex = updatedMessages.length - 1;
        if (lastIndex >= 0 && updatedMessages[lastIndex].message_id === 'streaming-temp') {
          updatedMessages[lastIndex] = {
            ...updatedMessages[lastIndex],
            message_id: result.messageId,
            content: finalContentFromStream,
            metadata: result.metadata,
          };
        } else {
          console.warn(`[End Listener] No temporary streaming message found, adding final message ${result.messageId} directly.`);
          updatedMessages.push({
            message_id: result.messageId,
            session_id: currentSessionId,
            role: 'assistant',
            content: finalContentFromStream,
            timestamp: new Date().toISOString(),
            metadata: result.metadata,
          });
        }
        return updatedMessages;
      });

      if (result.metadata?.sourceChunkIds && result.metadata.sourceChunkIds.length > 0) {
          console.log(`[End Listener] Triggering context fetch for new message ${result.messageId}`);
          void fetchContextForMessage(result.messageId, result.metadata.sourceChunkIds);
      }

      currentStreamRef.current = '';
      setCurrentStreamDisplay('');
    };

    const handleError = (errorMessage: string) => {
      console.error("[Error Listener] Stream error:", errorMessage);
      setError(`Stream error: ${errorMessage}`);
      setIsLoading(false);
      currentStreamRef.current = '';
      setCurrentStreamDisplay('');
    };

    const removeChunkListener = window.api.onChatChunk(handleChunk);
    const removeEndListener = window.api.onChatStreamEnd(handleEnd);
    const removeErrorListener = window.api.onChatStreamError(handleError);

    return () => {
      console.log(`[Effect Cleanup] Removing IPC listeners for session: ${currentSessionId}`);
      removeChunkListener();
      removeEndListener();
      removeErrorListener();
      if (isLoading) {
        console.log("[Effect Cleanup] Stopping active stream due to session change/unmount.");
        window.api.stopChatStream();
        setIsLoading(false);
        setCurrentStreamDisplay('');
        currentStreamRef.current = '';
      }
    };
  }, [currentSessionId, isLoading, fetchContextForMessage]); // Added fetchContextForMessage

  const handleSubmit = useCallback((
    inputValue: string,
    options?: { experimental_attachments?: FileList }
  ) => {
    if (!inputValue.trim() || isLoading || !currentSessionId) return;

    const userMessage: StructuredChatMessage = {
      message_id: `temp-${Date.now()}`,
      session_id: currentSessionId,
      role: 'user',
      content: inputValue,
      timestamp: new Date().toISOString(),
      metadata: null,
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);
    setCurrentStreamDisplay('');
    currentStreamRef.current = '';

    console.log(`[handleSubmit] Starting stream for session: ${currentSessionId}`);
    window.api.startChatStream(currentSessionId, inputValue);
  }, [isLoading, currentSessionId]);

  const handleStop = useCallback(() => {
    if (isLoading) {
      console.log("[handleStop] Stopping stream...");
      window.api.stopChatStream();
    }
  }, [isLoading]);

  // Conditional rendering if no session ID (e.g. if route param isn't ready)
  if (!currentSessionId) {
      return <div className="p-4">Loading notebook...</div>; 
  }

  return (
    <div className="relative h-screen flex flex-col">
      {/* Menu can be kept or modified if needed for notebook view specifically */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="fixed left-2 top-2 text-xl z-10"
            aria-label="Main menu"
          >
            ⋮
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent sideOffset={8} align="start">
          <DropdownMenuItem asChild>
            <a href="/settings">Settings</a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setIsUploadDialogOpen(true)}>
            Upload data (Notebook specific context?)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-grow flex flex-col w-1/3 overflow-hidden pl-2 pt-0 pb-1"> {/* Consider full width for notebook view */}
        {error && <div className="text-red-500 p-2 text-center">{error}</div>}
        <Chat
          messages={messagesWithStream.map(msg => ({
            id: msg.message_id,
            role: msg.role,
            content: msg.content,
          }))}
          handleSubmit={handleSubmit}
          isGenerating={isLoading}
          stop={handleStop}
          contextDetailsMap={contextDetailsMap}
        />
      </div>

      <BookmarkUploadDialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen} />
    </div>
  );
} 