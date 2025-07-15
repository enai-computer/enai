"use client";

import React from 'react';
import { Chat } from '@/components/ui/chat';
import type { ChatWindowPayload } from '@/../shared/types';
import { useChatStream } from '@/hooks/useChatStream'; // Import the new hook

interface ChatWindowProps {
  payload: ChatWindowPayload;
  windowId: string; // For potential future use, like unique debugging or state keys
  notebookId: string; // Added notebookId prop
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ payload, windowId, notebookId }) => {
  const { sessionId } = payload;

  const {
    messages,
    isLoading,
    error,
    contextDetailsMap,
    startStream,
    stopStream,
    // fetchContextForMessage, // Can be used if needed for manual context fetching trigger
  } = useChatStream({ sessionId, debugId: `ChatWindow-${windowId}`, notebookId }); // Pass notebookId here

  if (!sessionId) {
    return <div className="p-4 text-red-500">Error: No session ID provided for chat window.</div>;
  }

  // Mapping function for Chat component props, as suggested for minor refinement
  const mapMessagesForChat = (msgs: typeof messages) => {
    return msgs.map((msg, index) => ({
      id: msg.messageId || `message-${index}`,
      role: msg.role,
      content: msg.content,
      // Example for custom UI based on metadata or other properties from StructuredChatMessage
      // ui: msg.metadata?.sourceChunkIds ? <div>Context Aware</div> : undefined,
      // You can add more specific rendering logic for metadata here or inside the ChatMessage component itself
    }));
  };

  return (
    <div className="h-full flex flex-col bg-step-1 px-1.5">
      {error && (
        <div className="p-2 text-center text-red-500 bg-red-100 border-b border-red-300">
          {error}
        </div>
      )}
      <Chat
        messages={mapMessagesForChat(messages)}
        handleSubmit={startStream} // Use startStream from the hook
        isGenerating={isLoading}
        stop={stopStream} // Use stopStream from the hook
        contextDetailsMap={contextDetailsMap}
        // Any other props required by the Chat component can be passed here
        // e.g., onRateResponse, append, suggestions if they were managed by ChatWindow before
      />
    </div>
  );
}; 