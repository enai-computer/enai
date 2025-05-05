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
import { IChatMessage, SliceDetail, ChatMessageSourceMetadata, ContextState, StructuredChatMessage } from '../../shared/types';

/**
 * Root page, now primarily displaying the chat interface.
 * Includes a menu for Settings and Upload Data.
 */
export default function Home() {
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  // --- Chat State ---
  const [messages, setMessages] = useState<StructuredChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStreamDisplay, setCurrentStreamDisplay] = useState('');
  const currentStreamRef = useRef<string>('');
  const [error, setError] = useState<string | null>(null);
  const currentSessionId = 'static-session-id-homepage';

  // --- Context Slice State ---
  const [contextDetailsMap, setContextDetailsMap] = useState<Record<string, ContextState>>({});

  // --- Helper to Fetch Context --- 
  const fetchContextForMessage = useCallback(async (messageId: string, sourceChunkIds: number[]) => {
    // Use functional update form for setContextDetailsMap
    setContextDetailsMap(prev => {
      // Check if already loading/loaded or no IDs within the updater
      if (!sourceChunkIds || sourceChunkIds.length === 0 || prev[messageId]?.status === 'loading' || prev[messageId]?.status === 'loaded') {
        return prev; // Return previous state if no fetch needed
      }
      
      console.log(`[fetchContextForMessage] Fetching context for message ${messageId} with ${sourceChunkIds.length} chunk IDs.`);
      // Return the new state with the message marked as loading
      return { ...prev, [messageId]: { status: 'loading', data: null } };
    });

    // Check *again* after setting loading state, in case the check above raced?
    // Or rather, the check inside the updater is sufficient. Proceed if we set to loading.
    // A check like this is redundant if the updater logic is correct.
    // if (contextDetailsMap[messageId]?.status !== 'loading') return; 

    try {
      const sliceDetails = await window.api.getSliceDetails(sourceChunkIds);
      console.log(`[fetchContextForMessage] Successfully fetched ${sliceDetails.length} details for message ${messageId}.`);
      // Use functional update form for success
      setContextDetailsMap(prev => ({ ...prev, [messageId]: { status: 'loaded', data: sliceDetails } }));
    } catch (err) {
      console.error(`[fetchContextForMessage] Failed to fetch context for message ${messageId}:`, err);
      // Use functional update form for error
      setContextDetailsMap(prev => ({ ...prev, [messageId]: { status: 'error', data: null } }));
    }
  // Remove contextDetailsMap dependency, rely on functional updates.
  // Add setContextDetailsMap as a dependency if linting requires, but it's stable.
  }, [setContextDetailsMap]);

  // Fetch initial messages
  useEffect(() => {
    // console.log("Placeholder: Would fetch messages for session:", currentSessionId);
    // Set loading state
    setIsLoading(true);
    setError(null);
    setMessages([]); // Clear existing messages when session changes

    const loadMessages = async () => {
        try {
            // Define a limit for initial load, e.g., last 50 messages
            const messageLimit = 50;
            console.log(`[Effect LoadMessages] Fetching up to ${messageLimit} messages for session: ${currentSessionId}`);
            // Call the backend API function
            const loadedMessages = await window.api.getMessages(currentSessionId, messageLimit);
            setMessages(loadedMessages || []); // Set state with fetched messages
            console.log(`[Effect LoadMessages] Loaded ${loadedMessages?.length || 0} messages.`);

            // --- Trigger context fetching for loaded messages ---
            if (loadedMessages) {
                for (const message of loadedMessages) {
                    // Ensure message.metadata is an object and has sourceChunkIds
                    if (message.role === 'assistant' && message.metadata && message.metadata.sourceChunkIds && message.metadata.sourceChunkIds.length > 0) {
                        // No need to parse again, metadata is already an object
                        void fetchContextForMessage(message.message_id, message.metadata.sourceChunkIds);
                    }
                }
            }
            // --- End context fetching ---

        } catch (fetchError: any) {
            console.error("[Effect LoadMessages] Failed to load messages:", fetchError);
            setError(`Failed to load chat history: ${fetchError.message || 'Unknown error'}`);
            setMessages([]); // Ensure messages are empty on error
        } finally {
            // Always turn off loading state
            setIsLoading(false);
        }
    };

    loadMessages();

    // No cleanup needed specifically for getMessages, but the effect depends on sessionId
  }, [currentSessionId]);

  // --- Chat Logic ---

  // Combine messages with the live stream *display* state
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

  // Setup IPC listeners for streaming
  useEffect(() => {
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

        // Try to find and update the temporary message
        if (lastIndex >= 0 && updatedMessages[lastIndex].message_id === 'streaming-temp') {
          updatedMessages[lastIndex] = {
            ...updatedMessages[lastIndex],
            message_id: result.messageId, // Use actual ID from payload
            content: finalContentFromStream,
            metadata: result.metadata, // Use metadata from payload
          };
          console.log(`[End Listener] Finalized streaming message ${result.messageId} with content length: ${finalContentFromStream.length}`);
        } else {
          // If no temporary message, add the final message directly
          console.warn(`[End Listener] No temporary streaming message found, adding final message ${result.messageId} directly.`);
          updatedMessages.push({
            message_id: result.messageId, // Use actual ID from payload
            session_id: currentSessionId,
            role: 'assistant',
            content: finalContentFromStream,
            timestamp: new Date().toISOString(),
            metadata: result.metadata, // Use metadata from payload
          });
        }
        return updatedMessages;
      });

      // --- Trigger context fetching for the NEW message --- 
      if (result.metadata?.sourceChunkIds && result.metadata.sourceChunkIds.length > 0) {
          console.log(`[End Listener] Triggering context fetch for new message ${result.messageId}`);
          void fetchContextForMessage(result.messageId, result.metadata.sourceChunkIds);
      }
      // --- End context fetching for new message --- 

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
  }, [currentSessionId]);

  const handleSubmit = useCallback((
    inputValue: string,
    options?: { experimental_attachments?: FileList }
  ) => {
    if (!inputValue.trim() || isLoading) return;

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

  return (
    <div className="relative h-screen flex flex-col">
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
            Upload data
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-grow flex flex-col w-1/3 overflow-hidden pl-2 pt-0 pb-1">
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
