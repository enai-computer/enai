/**
 * Agent-related types shared across agent services
 */

/**
 * OpenAI-compatible message format used throughout the agent system
 */
export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }[];
  tool_call_id?: string;
}

// Future types for Phase 2-4 refactoring can be added here:
// - LLMConfig
// - ToolDefinition
// - ToolCallResult
// - SearchConfig
// etc.