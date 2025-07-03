import { BaseService } from '../base/BaseService';
import { ConversationService } from './ConversationService';
import { SearchService } from './SearchService';
import { NotebookService } from '../NotebookService';
import { ProfileService } from '../ProfileService';
import { HybridSearchService } from '../HybridSearchService';
import { ExaService } from '../ExaService';
import { SliceService } from '../SliceService';
import { SearchResultFormatter } from '../SearchResultFormatter';
import { AGENT_TOOLS, ToolContext, ToolCallResult } from './tools';
import { OpenAIMessage } from '../../shared/types/agent.types';
import { IntentResultPayload, ChatMessageRole, SetIntentPayload } from '../../shared/types';
import { performanceTracker } from '../../utils/performanceTracker';
import Database from 'better-sqlite3';

// Type for tool execution results
export interface ToolExecutionResult {
  toolResults: ToolCallResult[];
  hasSearchResults: boolean;
  hasMeaningfulContent: boolean;
}

interface ToolServiceDeps {
  db: Database.Database;
  conversationService: ConversationService;
  searchService: SearchService;
  notebookService: NotebookService;
  profileService: ProfileService;
  hybridSearchService: HybridSearchService;
  exaService: ExaService;
  sliceService: SliceService;
  searchResultFormatter: SearchResultFormatter;
}

/**
 * ToolService handles the execution and orchestration of agent tools.
 * It manages tool registry, execution, and result processing.
 */
export class ToolService extends BaseService<ToolServiceDeps> {
  constructor(deps: ToolServiceDeps) {
    super('ToolService', deps);
  }

  /**
   * Process a single tool call
   */
  async processToolCall(toolCall: any, payload?: SetIntentPayload): Promise<ToolCallResult> {
    const { name, arguments: argsJson } = toolCall.function;
    
    try {
      const args = JSON.parse(argsJson);
      this.logInfo(`Processing tool: ${name}`, args);
      
      // Look up tool in registry
      const tool = AGENT_TOOLS[name];
      if (!tool) {
        this.logWarn(`Unknown tool: ${name}`);
        return { content: `Unknown tool: ${name}` };
      }
      
      // Create context for tool execution
      const context: ToolContext = {
        services: {
          notebookService: this.deps.notebookService,
          hybridSearchService: this.deps.hybridSearchService,
          exaService: this.deps.exaService,
          sliceService: this.deps.sliceService,
          profileService: this.deps.profileService,
          searchService: this.deps.searchService
        },
        sessionInfo: {
          senderId: '', // Will be set by caller if needed
          sessionId: '' // Will be set by caller if needed
        },
        currentIntentSearchResults: this.deps.searchService.getCurrentSearchResults(),
        formatter: this.deps.searchResultFormatter
      };
      
      // Execute tool
      return await tool.handle(args, context);
    } catch (error) {
      this.logError(`Tool call error:`, error);
      return { content: `Error: ${error instanceof Error ? error.message : 'Tool execution failed'}` };
    }
  }

  /**
   * Handle multiple tool calls with atomic save
   */
  async handleToolCallsWithAtomicSave(
    assistantMessage: OpenAIMessage,
    messages: OpenAIMessage[], 
    senderId: string,
    sessionId: string,
    correlationId?: string
  ): Promise<ToolExecutionResult> {
    const toolCalls = assistantMessage.tool_calls!;
    
    this.logInfo(`Processing ${toolCalls.length} tool call(s) with atomic save`);
    
    if (correlationId) {
      performanceTracker.recordEvent(correlationId, 'ToolService', 'processing_tool_calls');
    }
    
    // Process all tool calls in parallel
    const toolPromises = toolCalls.map(tc => this.processToolCall(tc));
    const toolResults = await Promise.all(toolPromises);
    
    if (correlationId) {
      performanceTracker.recordEvent(correlationId, 'ToolService', 'tool_calls_completed');
    }
    
    // Prepare all messages to save atomically:
    // 1. The assistant message with tool calls
    // 2. All tool response messages
    const messagesToSave: Array<{
      role: ChatMessageRole;
      content: string;
      metadata?: any;
    }> = [];
    
    // Add assistant message
    messagesToSave.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      metadata: { toolCalls: assistantMessage.tool_calls }
    });
    
    // Add tool responses and update in-memory messages
    for (let index = 0; index < toolCalls.length; index++) {
      const toolCall = toolCalls[index];
      const toolResult = toolResults[index];
      
      messages.push({
        role: "tool",
        content: toolResult.content,
        tool_call_id: toolCall.id
      });
      
      // Add to messages to save
      messagesToSave.push({
        role: 'tool' as ChatMessageRole,
        content: toolResult.content,
        metadata: { toolCallId: toolCall.id, toolName: toolCall.function.name }
      });
    }
    
    // Save all messages in a single transaction
    try {
      await this.deps.conversationService.saveMessagesInTransaction(sessionId, messagesToSave);
      this.logDebug(`Atomically saved assistant message and ${toolCalls.length} tool responses`);
    } catch (error) {
      this.logError('Failed to save conversation turn atomically:', error);
      // Critical failure - the conversation state is now inconsistent
      // We should not continue as if everything is fine
      throw error;
    }
    
    // Update history
    this.deps.conversationService.updateConversationHistory(senderId, messages);
    
    // Check for immediate returns
    const immediateReturn = toolResults.find(r => r.immediateReturn);
    if (immediateReturn?.immediateReturn) {
      return immediateReturn.immediateReturn;
    }
    
    // Check for search results (both web and knowledge base)
    const hasSearchResults = toolResults.some((result, index) => {
      const toolName = toolCalls[index].function.name;
      return (toolName === 'search_web' || toolName === 'search_knowledge_base') && 
        !result.content.startsWith('Error:') &&
        !result.content.includes('No results found');
    });
    
    return {
      toolResults,
      hasSearchResults,
      hasMeaningfulContent: this.requiresSummary(toolResults)
    };
  }

  /**
   * Handle tool calls for streaming with atomic save
   */
  async handleToolCallsForStreamingWithAtomicSave(
    assistantMessage: OpenAIMessage,
    messages: OpenAIMessage[], 
    senderId: string,
    sessionId: string,
    correlationId?: string
  ): Promise<ToolCallResult[]> {
    const toolCalls = assistantMessage.tool_calls!;
    
    this.logInfo(`Processing ${toolCalls.length} tool call(s) for streaming with atomic save`);
    
    // Process all tool calls in parallel
    const toolPromises = toolCalls.map(tc => this.processToolCall(tc));
    const toolResults = await Promise.all(toolPromises);
    
    // Prepare all messages to save atomically:
    // 1. The assistant message with tool calls
    // 2. All tool response messages
    const messagesToSave: Array<{
      role: ChatMessageRole;
      content: string;
      metadata?: any;
    }> = [];
    
    // Add assistant message
    messagesToSave.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      metadata: { toolCalls: assistantMessage.tool_calls }
    });
    
    // Add tool responses and update in-memory messages
    for (let index = 0; index < toolCalls.length; index++) {
      const toolCall = toolCalls[index];
      const toolResult = toolResults[index];
      
      messages.push({
        role: "tool",
        content: toolResult.content,
        tool_call_id: toolCall.id
      });
      
      // Add to messages to save
      messagesToSave.push({
        role: 'tool' as ChatMessageRole,
        content: toolResult.content,
        metadata: { toolCallId: toolCall.id, toolName: toolCall.function.name }
      });
    }
    
    // Save all messages in a single transaction
    try {
      await this.deps.conversationService.saveMessagesInTransaction(sessionId, messagesToSave);
      this.logDebug(`Atomically saved assistant message and ${toolCalls.length} tool responses for streaming`);
    } catch (error) {
      this.logError('Failed to save conversation turn atomically:', error);
      // Critical failure - the conversation state is now inconsistent
      throw error;
    }
    
    // Update history
    this.deps.conversationService.updateConversationHistory(senderId, messages);
    
    return toolResults;
  }

  /**
   * Handle tool calls for streaming (without atomic save)
   */
  async handleToolCallsForStreaming(
    toolCalls: any[], 
    messages: OpenAIMessage[], 
    senderId: string,
    sessionId: string,
    correlationId?: string
  ): Promise<ToolCallResult[]> {
    this.logInfo(`Processing ${toolCalls.length} tool call(s) for streaming`);
    
    // Process all tool calls in parallel
    const toolPromises = toolCalls.map(tc => this.processToolCall(tc));
    const toolResults = await Promise.all(toolPromises);
    
    // Prepare all tool response messages
    const toolMessages: Array<{
      role: ChatMessageRole;
      content: string;
      metadata?: any;
    }> = [];
    
    for (let index = 0; index < toolCalls.length; index++) {
      const toolCall = toolCalls[index];
      const toolResult = toolResults[index];
      
      messages.push({
        role: "tool",
        content: toolResult.content,
        tool_call_id: toolCall.id
      });
      
      // Prepare message for batch save
      toolMessages.push({
        role: 'tool' as ChatMessageRole,
        content: toolResult.content,
        metadata: { toolCallId: toolCall.id, toolName: toolCall.function.name }
      });
    }
    
    // Save all tool messages in a single transaction
    try {
      await this.deps.conversationService.saveMessagesInTransaction(sessionId, toolMessages);
      this.logDebug(`Saved ${toolMessages.length} tool response messages in transaction`);
    } catch (error) {
      this.logError('Failed to save tool response messages:', error);
      // Continue processing - messages are already in memory
    }
    
    // Update history
    this.deps.conversationService.updateConversationHistory(senderId, messages);
    
    return toolResults;
  }

  /**
   * Handle tool calls (legacy method for backwards compatibility)
   */
  async handleToolCalls(
    toolCalls: any[], 
    messages: OpenAIMessage[], 
    senderId: string,
    sessionId: string,
    correlationId?: string
  ): Promise<IntentResultPayload> {
    this.logInfo(`Processing ${toolCalls.length} tool call(s)`);
    
    if (correlationId) {
      performanceTracker.recordEvent(correlationId, 'ToolService', 'processing_tool_calls', {
        toolCount: toolCalls.length,
        tools: toolCalls.map(tc => tc.function.name)
      });
    }
    
    // Process all tool calls in parallel
    const toolPromises = toolCalls.map(tc => this.processToolCall(tc));
    const toolResults = await Promise.all(toolPromises);
    
    // Prepare all tool response messages
    const toolMessages: Array<{
      role: ChatMessageRole;
      content: string;
      metadata?: any;
    }> = [];
    
    for (let index = 0; index < toolCalls.length; index++) {
      const toolCall = toolCalls[index];
      const toolResult = toolResults[index];
      
      messages.push({
        role: "tool",
        content: toolResult.content,
        tool_call_id: toolCall.id
      });
      
      // Prepare message for batch save
      toolMessages.push({
        role: 'tool' as ChatMessageRole,
        content: toolResult.content,
        metadata: { toolCallId: toolCall.id, toolName: toolCall.function.name }
      });
    }
    
    // Save all tool messages in a single transaction
    try {
      await this.deps.conversationService.saveMessagesInTransaction(sessionId, toolMessages);
      this.logDebug(`Saved ${toolMessages.length} tool response messages in transaction`);
    } catch (error) {
      this.logError('Failed to save tool response messages:', error);
      // Continue processing - messages are already in memory
    }
    
    // Update history
    this.deps.conversationService.updateConversationHistory(senderId, messages);
    
    // Check for immediate returns
    const immediateReturn = toolResults.find(r => r.immediateReturn);
    if (immediateReturn?.immediateReturn) {
      return immediateReturn.immediateReturn;
    }
    
    // Check for search results (both web and knowledge base)
    const hasSearchResults = toolResults.some((result, index) => {
      const toolName = toolCalls[index].function.name;
      return (toolName === 'search_web' || toolName === 'search_knowledge_base') && 
        !result.content.startsWith('Error:') &&
        !result.content.includes('No results found');
    });
    
    return {
      type: 'tool_result',
      hasSearchResults,
      toolResults,
      requiresSummary: hasSearchResults || this.requiresSummary(toolResults)
    } as any;
  }

  /**
   * Check if tool results require an AI summary
   */
  private requiresSummary(toolResults: ToolCallResult[]): boolean {
    return toolResults.some(r => 
      r.content && 
      !r.content.startsWith('Opened ') && 
      !r.content.startsWith('Created ') &&
      !r.content.startsWith('Deleted ')
    );
  }

  /**
   * Get available tool definitions
   */
  getToolDefinitions(): Array<{ type: "function"; function: any }> {
    return Object.entries(AGENT_TOOLS).map(([name, tool]) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }
}