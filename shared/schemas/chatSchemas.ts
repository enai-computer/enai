import { z } from 'zod';

/**
 * Schema for tool call structure in assistant messages
 */
export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string()
  })
});

/**
 * Schema for chat message source metadata
 */
export const ChatMessageSourceMetadataSchema = z.object({
  sourceChunkIds: z.array(z.number()).optional().nullable(),
  relevantOriginalQueries: z.array(z.string()).optional().nullable(),
  confidenceScore: z.number().min(0).max(1).optional().nullable(),
  sourceObjectIds: z.array(z.string()).optional().nullable(),
  retrievalMethod: z.string().optional().nullable(),
  // Tool-related fields
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).optional()
}).passthrough(); // Allow additional fields for extensibility

export type ChatMessageSourceMetadata = z.infer<typeof ChatMessageSourceMetadataSchema>;

/**
 * Safely parse and validate chat metadata from JSON string
 */
export function parseChatMetadata(metadataJson: string): ChatMessageSourceMetadata | null {
  try {
    const parsed = JSON.parse(metadataJson);
    const result = ChatMessageSourceMetadataSchema.safeParse(parsed);
    
    if (result.success) {
      // Additional validation: ensure sourceChunkIds contains valid numbers
      if (result.data.sourceChunkIds && !Array.isArray(result.data.sourceChunkIds)) {
        return null;
      }
      
      if (result.data.sourceChunkIds?.some(id => typeof id !== 'number' || !Number.isInteger(id))) {
        // Filter out invalid IDs
        result.data.sourceChunkIds = result.data.sourceChunkIds.filter(
          id => typeof id === 'number' && Number.isInteger(id)
        );
      }
      
      return result.data;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Schema for a chat message
 */
export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  metadata: ChatMessageSourceMetadataSchema.nullable().optional(),
  createdAt: z.union([z.string(), z.date()]).transform(val => 
    typeof val === 'string' ? new Date(val) : val
  )
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * Validates that a conversation history has proper tool response messages
 * for any assistant messages with tool calls
 */
export function validateConversationHistory(messages: ChatMessage[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const pendingToolCalls = new Map<string, { messageIndex: number; toolName: string }>();

  messages.forEach((message, index) => {
    // Check for assistant messages with tool calls
    if (message.role === 'assistant' && message.metadata?.toolCalls) {
      message.metadata.toolCalls.forEach(toolCall => {
        pendingToolCalls.set(toolCall.id, {
          messageIndex: index,
          toolName: toolCall.function.name
        });
      });
    }

    // Check for tool response messages
    if (message.role === 'tool' && message.metadata?.toolCallId) {
      const toolCallId = message.metadata.toolCallId;
      if (pendingToolCalls.has(toolCallId)) {
        pendingToolCalls.delete(toolCallId);
      } else {
        errors.push(
          `Tool response at index ${index} references unknown tool_call_id: ${toolCallId}`
        );
      }
    }
  });

  // Report any unmatched tool calls
  pendingToolCalls.forEach((info, toolCallId) => {
    errors.push(
      `Assistant message at index ${info.messageIndex} has tool_call '${toolCallId}' ` +
      `(${info.toolName}) without a corresponding tool response message`
    );
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Filters out orphaned tool messages and assistant messages with unmatched tool calls
 */
export function sanitizeConversationHistory(messages: ChatMessage[]): ChatMessage[] {
  const validToolCallIds = new Set<string>();
  
  // First pass: collect all tool call IDs from assistant messages
  messages.forEach(message => {
    if (message.role === 'assistant' && message.metadata?.toolCalls) {
      message.metadata.toolCalls.forEach(toolCall => {
        validToolCallIds.add(toolCall.id);
      });
    }
  });

  // Second pass: filter messages
  return messages.filter((message, index) => {
    // Keep all non-tool messages
    if (message.role !== 'tool') return true;
    
    // For tool messages, only keep if they have a valid tool_call_id
    const toolCallId = message.metadata?.toolCallId;
    if (!toolCallId || !validToolCallIds.has(toolCallId)) {
      console.warn(
        `Filtering out orphaned tool message at index ${index} with tool_call_id: ${toolCallId}`
      );
      return false;
    }
    
    return true;
  });
}