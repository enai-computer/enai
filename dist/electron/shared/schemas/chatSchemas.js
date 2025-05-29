"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatMessageSchema = exports.ChatMessageSourceMetadataSchema = exports.ToolCallSchema = void 0;
exports.parseChatMetadata = parseChatMetadata;
exports.validateConversationHistory = validateConversationHistory;
exports.sanitizeConversationHistory = sanitizeConversationHistory;
const zod_1 = require("zod");
/**
 * Schema for tool call structure in assistant messages
 */
exports.ToolCallSchema = zod_1.z.object({
    id: zod_1.z.string(),
    type: zod_1.z.literal('function'),
    function: zod_1.z.object({
        name: zod_1.z.string(),
        arguments: zod_1.z.string()
    })
});
/**
 * Schema for chat message source metadata
 */
exports.ChatMessageSourceMetadataSchema = zod_1.z.object({
    sourceChunkIds: zod_1.z.array(zod_1.z.number()).optional().nullable(),
    relevantOriginalQueries: zod_1.z.array(zod_1.z.string()).optional().nullable(),
    confidenceScore: zod_1.z.number().min(0).max(1).optional().nullable(),
    sourceObjectIds: zod_1.z.array(zod_1.z.string()).optional().nullable(),
    retrievalMethod: zod_1.z.string().optional().nullable(),
    // Tool-related fields
    toolCallId: zod_1.z.string().optional(),
    toolName: zod_1.z.string().optional(),
    toolCalls: zod_1.z.array(exports.ToolCallSchema).optional()
}).passthrough(); // Allow additional fields for extensibility
/**
 * Safely parse and validate chat metadata from JSON string
 */
function parseChatMetadata(metadataJson) {
    try {
        const parsed = JSON.parse(metadataJson);
        const result = exports.ChatMessageSourceMetadataSchema.safeParse(parsed);
        if (result.success) {
            // Additional validation: ensure sourceChunkIds contains valid numbers
            if (result.data.sourceChunkIds && !Array.isArray(result.data.sourceChunkIds)) {
                return null;
            }
            if (result.data.sourceChunkIds?.some(id => typeof id !== 'number' || !Number.isInteger(id))) {
                // Filter out invalid IDs
                result.data.sourceChunkIds = result.data.sourceChunkIds.filter(id => typeof id === 'number' && Number.isInteger(id));
            }
            return result.data;
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Schema for a chat message
 */
exports.ChatMessageSchema = zod_1.z.object({
    id: zod_1.z.string(),
    role: zod_1.z.enum(['user', 'assistant', 'system', 'tool']),
    content: zod_1.z.string(),
    metadata: exports.ChatMessageSourceMetadataSchema.nullable().optional(),
    createdAt: zod_1.z.union([zod_1.z.string(), zod_1.z.date()]).transform(val => typeof val === 'string' ? new Date(val) : val)
});
/**
 * Validates that a conversation history has proper tool response messages
 * for any assistant messages with tool calls
 */
function validateConversationHistory(messages) {
    const errors = [];
    const pendingToolCalls = new Map();
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
            }
            else {
                errors.push(`Tool response at index ${index} references unknown tool_call_id: ${toolCallId}`);
            }
        }
    });
    // Report any unmatched tool calls
    pendingToolCalls.forEach((info, toolCallId) => {
        errors.push(`Assistant message at index ${info.messageIndex} has tool_call '${toolCallId}' ` +
            `(${info.toolName}) without a corresponding tool response message`);
    });
    return {
        valid: errors.length === 0,
        errors
    };
}
/**
 * Filters out orphaned tool messages and assistant messages with unmatched tool calls
 */
function sanitizeConversationHistory(messages) {
    const validToolCallIds = new Set();
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
        if (message.role !== 'tool')
            return true;
        // For tool messages, only keep if they have a valid tool_call_id
        const toolCallId = message.metadata?.toolCallId;
        if (!toolCallId || !validToolCallIds.has(toolCallId)) {
            console.warn(`Filtering out orphaned tool message at index ${index} with tool_call_id: ${toolCallId}`);
            return false;
        }
        return true;
    });
}
//# sourceMappingURL=chatSchemas.js.map