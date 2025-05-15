import {
  ChatMessage,
  type ChatMessageProps,
  type Message as DisplayMessage,
} from "@/components/ui/chat-message"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { ContextState } from "../../../shared/types"

type AdditionalMessageOptions = Omit<ChatMessageProps, keyof DisplayMessage>

interface MessageListProps {
  messages: DisplayMessage[]
  showTimeStamp?: boolean
  isTyping?: boolean
  messageOptions?:
    | AdditionalMessageOptions
    | ((message: DisplayMessage) => AdditionalMessageOptions)
  contextDetailsMap?: Record<string, ContextState>
}

export function MessageList({
  messages,
  showTimeStamp = true,
  isTyping = false,
  messageOptions,
  contextDetailsMap,
}: MessageListProps) {
  return (
    <div className="space-y-4 overflow-visible">
      {messages.map((msg, index) => {
        const additionalOptions =
          typeof messageOptions === "function"
            ? messageOptions(msg)
            : messageOptions

        const contextState =
          msg.role === "assistant" ? contextDetailsMap?.[msg.id] : undefined;

        return (
          <ChatMessage
            key={msg.id}
            showTimeStamp={showTimeStamp}
            {...msg}
            {...additionalOptions}
            contextState={contextState}
          />
        )
      })}
      {isTyping && <TypingIndicator key="typing-indicator" />}
    </div>
  )
}
