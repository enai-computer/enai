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
import { IChatMessage } from '../../shared/types';

/**
 * Root page, now primarily displaying the chat interface.
 * Includes a menu for Settings and Upload Data.
 */
export default function Home() {
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  // --- Chat State ---
  const [messages, setMessages] = useState<IChatMessage[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStreamDisplay, setCurrentStreamDisplay] = useState('');
  const currentStreamRef = useRef<string>('');
  const [error, setError] = useState<string | null>(null);
  const currentSessionId = 'static-session-id-homepage';

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

    const handleEnd = () => {
      console.log("[End Listener] Stream ended.");
      setIsLoading(false);
      const finalContentFromStream = currentStreamRef.current;

      setMessages(prevMessages => {
        const updatedMessages = [...prevMessages];
        const lastIndex = updatedMessages.length - 1;

        if (lastIndex >= 0 && updatedMessages[lastIndex].message_id === 'streaming-temp') {
          updatedMessages[lastIndex] = {
            ...updatedMessages[lastIndex],
            message_id: `final-${Date.now()}`,
            content: finalContentFromStream,
          };
          console.log(`[End Listener] Finalized streaming message with content length: ${finalContentFromStream.length}`);
        } else {
          console.warn("[End Listener] No temporary streaming message found, adding final message directly.");
          updatedMessages.push({
            message_id: `final-${Date.now()}`,
            session_id: currentSessionId,
            role: 'assistant',
            content: finalContentFromStream,
            timestamp: new Date().toISOString(),
            metadata: null,
          });
        }
        return updatedMessages;
      });

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

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentInput(e.target.value);
  }, []);

  const handleSubmit = useCallback((
    event?: React.FormEvent<HTMLFormElement> | { preventDefault?: () => void },
    options?: { experimental_attachments?: FileList }
  ) => {
    if (event && typeof (event as any).preventDefault === 'function') {
      (event as React.FormEvent<HTMLFormElement>).preventDefault();
    }
    if (!currentInput.trim() || isLoading) return;

    const userMessage: IChatMessage = {
      message_id: `temp-${Date.now()}`,
      session_id: currentSessionId,
      role: 'user',
      content: currentInput,
      timestamp: new Date().toISOString(),
      metadata: null,
    };

    setMessages(prev => [...prev, userMessage]);
    const questionToSend = currentInput;
    setCurrentInput('');
    setIsLoading(true);
    setError(null);
    setCurrentStreamDisplay('');
    currentStreamRef.current = '';

    console.log(`[handleSubmit] Starting stream for session: ${currentSessionId}`);
    window.api.startChatStream(currentSessionId, questionToSend);
  }, [currentInput, isLoading, currentSessionId]);

  const handleStop = useCallback(() => {
    if (isLoading) {
      console.log("[handleStop] Stopping stream...");
      window.api.stopChatStream();
    }
  }, [isLoading]);

  return (
    <div className="relative h-screen flex flex-col p-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-4 top-4 text-xl"
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

      <div className="flex-grow flex flex-col pt-12">
        {error && <div className="text-red-500 p-2 text-center">{error}</div>}
        <Chat
          messages={messagesWithStream.map(msg => ({
            id: msg.message_id,
            role: msg.role,
            content: msg.content,
          }))}
          input={currentInput}
          handleInputChange={handleInputChange}
          handleSubmit={handleSubmit}
          isGenerating={isLoading}
          stop={handleStop}
        />
      </div>

      <BookmarkUploadDialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen} />
    </div>
  );
}
