import { WebContents } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { BaseService } from './base/BaseService';
import { performanceTracker } from '../utils/performanceTracker';
import { SetIntentPayload, IntentResultPayload, ChatMessageRole, HybridSearchResult, DisplaySlice } from '../shared/types';
import { NotebookService } from './NotebookService';
import { ExaService } from './ExaService';
import { HybridSearchService } from './HybridSearchService';
import { SearchResultFormatter } from './SearchResultFormatter';
import { ChatModel } from '../models/ChatModel';
import { SliceService } from './SliceService';
import { ProfileService } from './ProfileService';
import { AGENT_TOOLS, ToolContext, ToolCallResult } from './agents/tools';
import { 
  ON_INTENT_RESULT, 
  ON_INTENT_STREAM_START, 
  ON_INTENT_STREAM_CHUNK, 
  ON_INTENT_STREAM_END, 
  ON_INTENT_STREAM_ERROR 
} from '../shared/ipcChannels';
import Database from 'better-sqlite3';
import { StreamManager } from './StreamManager';
import { ConversationService } from './agents/ConversationService';
import { OpenAIMessage } from '../shared/types/agent.types';
import { LLMClient } from './agents/LLMClient';
import { SearchService } from './agents/SearchService';

interface AgentServiceDeps {
  notebookService: NotebookService;
  hybridSearchService: HybridSearchService;
  exaService: ExaService;
  chatModel: ChatModel;
  sliceService: SliceService;
  profileService: ProfileService;
  searchResultFormatter: SearchResultFormatter;
  db: Database.Database; // Add database for transactions
  streamManager: StreamManager;
  conversationService: ConversationService;
  llmClient: LLMClient;
  searchService: SearchService;
}

export class AgentService extends BaseService<AgentServiceDeps> {
  private formatter: SearchResultFormatter;

  constructor(deps: AgentServiceDeps) {
    super('AgentService', deps);
    this.formatter = deps.searchResultFormatter;
  }

  async initialize(): Promise<void> {
    this.logger.info('AgentService initialized');
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up AgentService');
    // Conversation cleanup is now handled by ConversationService
  }

  async processComplexIntent(payload: SetIntentPayload, senderId?: string | number, correlationId?: string): Promise<IntentResultPayload | undefined> {
    return this.execute('processComplexIntent', async () => {
      const { intentText } = payload;
      const effectiveSenderId = String(senderId || '0');
      
      this.logger.info(`Processing complex intent: "${intentText}" from sender ${effectiveSenderId}`);
      
      // Track agent processing start
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'intent_processing_start', {
          intentText: intentText.substring(0, 50),
          senderId: effectiveSenderId
        });
      }
      
      // Clear search results from previous intent
      this.deps.searchService.clearSearchResults();
      
      // Ensure we have a session for this sender
      const sessionId = await this.deps.conversationService.ensureSession(effectiveSenderId);
      
      // Get messages and ensure system prompt
      const messages = await this.deps.llmClient.prepareMessages(effectiveSenderId, intentText, payload);
      
      // First save user message before making the OpenAI call
      let userMessageId: string = '';
      try {
        userMessageId = await this.deps.conversationService.saveMessage(sessionId, 'user', intentText);
      } catch (error) {
        this.logger.error('Failed to save user message:', error);
        // Continue processing even if save fails
      }
      
      // Call OpenAI
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'calling_openai');
      }
      
      let assistantMessage: OpenAIMessage | null = null;
      try {
        assistantMessage = await this.deps.llmClient.callOpenAI(messages);
      } catch (error) {
        this.logger.error('OpenAI call failed:', error);
        // Save error state if we have a user message
        if (userMessageId) {
          try {
            await this.deps.conversationService.saveMessage(
              sessionId,
              'assistant',
              'I encountered an error processing your request. Please try again.',
              { error: error instanceof Error ? error.message : 'Unknown error' }
            );
          } catch (saveError) {
            this.logger.error('Failed to save error message:', saveError);
          }
        }
        throw error;
      }
      
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'openai_response_received', {
          hasToolCalls: !!(assistantMessage?.tool_calls?.length)
        });
      }
      
      if (!assistantMessage) {
        return { type: 'error', message: 'No response from AI' };
      }
      
      // Store assistant message in memory
      messages.push(assistantMessage);
      this.deps.conversationService.updateConversationHistory(effectiveSenderId, messages);
      
      // Handle tool calls if present
      if (assistantMessage.tool_calls?.length) {
        // Process tool calls and get all messages to save atomically
        return await this.handleToolCallsWithAtomicSave(
          assistantMessage,
          messages, 
          effectiveSenderId, 
          sessionId, 
          correlationId
        );
      }
      
      // Direct response - save assistant message
      try {
        await this.deps.conversationService.saveMessage(
          sessionId, 
          'assistant', 
          assistantMessage.content || '', 
          { toolCalls: assistantMessage.tool_calls }
        );
      } catch (error) {
        this.logger.error('Failed to save assistant message:', error);
        // Continue processing - the response can still be shown to user
      }
      
      if (assistantMessage.content) {
        return { type: 'chat_reply', message: assistantMessage.content };
      }
      
      return { type: 'error', message: 'No valid response from AI' };
    });
  }

  async processComplexIntentWithStreaming(
    payload: SetIntentPayload, 
    senderId: string | number,
    sender: WebContents,
    correlationId?: string
  ): Promise<void> {
    await this.execute('processComplexIntentWithStreaming', async () => {
      const { intentText } = payload;
    const effectiveSenderId = String(senderId || '0');
    
    this.logger.info(`Processing complex intent with streaming: "${intentText}" from sender ${effectiveSenderId}`);
    
    if (correlationId) {
      performanceTracker.recordEvent(correlationId, 'AgentService', 'intent_processing_start_streaming', {
        intentText: intentText.substring(0, 50),
        senderId: effectiveSenderId
      });
    }
    
    // Clear search results from previous intent
    this.deps.searchService.clearSearchResults();
    
    try {
      // Ensure we have a session for this sender
      const sessionId = await this.deps.conversationService.ensureSession(effectiveSenderId);
      
      // Get messages and ensure system prompt
      const messages = await this.deps.llmClient.prepareMessages(effectiveSenderId, intentText);
      
      // Save user message to database
      await this.deps.conversationService.saveMessage(sessionId, 'user', intentText);
      
      // Call OpenAI for tool processing
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'calling_openai_streaming');
      }
      
      const assistantMessage = await this.deps.llmClient.callOpenAI(messages);
      
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'openai_response_received_streaming');
      }
      
      if (!assistantMessage) {
        sender.send(ON_INTENT_STREAM_ERROR, { error: 'Failed to get response from AI' });
        return;
      }
      
      messages.push(assistantMessage);
      this.deps.conversationService.updateConversationHistory(effectiveSenderId, messages);
      
      // Handle tool calls if present
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        if (correlationId) {
          performanceTracker.recordEvent(correlationId, 'AgentService', 'processing_tool_calls_streaming');
        }
        
        // Process tool calls with atomic save
        const toolResults = await this.handleToolCallsForStreamingWithAtomicSave(
          assistantMessage,
          messages, 
          effectiveSenderId, 
          sessionId,
          correlationId
        );
        
        // Check for immediate returns (like open_notebook, open_url)
        const immediateReturn = toolResults.find(r => r.immediateReturn);
        if (immediateReturn?.immediateReturn) {
          sender.send(ON_INTENT_RESULT, immediateReturn.immediateReturn);
          return;
        }
        
        // Check if we have search results to summarize
        const hasSearchResults = this.deps.searchService.getCurrentSearchResults().length > 0;
        
        if (hasSearchResults) {
          // Start streaming the summary (slices will be sent via the callback)
          if (correlationId) {
            performanceTracker.recordEvent(correlationId, 'AgentService', 'starting_summary_stream');
          }
          
          try {
            // Create the stream generator with slices callback
            const generator = this.streamAISummary(messages, effectiveSenderId, correlationId, (slices) => {
              // Send slices via ON_INTENT_RESULT before streaming starts
              sender.send(ON_INTENT_RESULT, {
                type: 'chat_reply',
                message: '', 
                slices: slices.length > 0 ? slices : undefined
              });
            });
            
            // Use StreamManager to handle streaming
            const result = await this.deps.streamManager.startStream(
              sender,
              generator,
              {
                onStart: ON_INTENT_STREAM_START,
                onChunk: ON_INTENT_STREAM_CHUNK,
                onEnd: ON_INTENT_STREAM_END,
                onError: ON_INTENT_STREAM_ERROR
              },
              {}, // End payload can be empty as the meaningful data is in the generator result
              correlationId
            );
            
            if (correlationId) {
              performanceTracker.recordEvent(correlationId, 'AgentService', 'summary_stream_complete', {
                hasResult: !!result,
                messageId: result?.messageId
              });
            }
            
          } catch (streamError) {
            this.logger.error('Streaming error:', streamError);
            // StreamManager already sent error event, just log here
          }
        } else {
          // No search results, just send the tool results as a regular response
          const meaningfulContent = toolResults.find(r => 
            r.content && 
            !r.content.startsWith('Opened ') && 
            !r.content.startsWith('Created ') &&
            !r.content.startsWith('Deleted ')
          );
          
          if (meaningfulContent) {
            sender.send(ON_INTENT_RESULT, { 
              type: 'chat_reply', 
              message: meaningfulContent.content 
            });
          } else {
            sender.send(ON_INTENT_RESULT, { 
              type: 'chat_reply', 
              message: 'Request processed.' 
            });
          }
        }
        
      } else {
        // Direct response without tools - use real streaming
        if (correlationId) {
          performanceTracker.recordEvent(correlationId, 'AgentService', 'starting_direct_stream');
        }
        
        try {
          // Create a generator that streams the response
          const streamGenerator = async function* (this: AgentService): AsyncGenerator<string, { messageId: string }, unknown> {
            // Create message record with placeholder content
            const messageId = await this.deps.conversationService.saveMessage(sessionId, 'assistant', '');
            let fullContent = '';
            
            // Stream the response using the existing streamOpenAI method
            const stream = this.deps.llmClient.streamOpenAI(messages);
            
            for await (const chunk of stream) {
              fullContent += chunk;
              yield chunk;
            }
            
            // Update the complete message in database
            if (fullContent) {
              await this.deps.conversationService.updateMessage(messageId, fullContent);
              messages.push({ role: 'assistant', content: fullContent });
              this.deps.conversationService.updateConversationHistory(effectiveSenderId, messages);
            }
            
            return { messageId };
          }.bind(this);
          
          // Use StreamManager to handle streaming
          const result = await this.deps.streamManager.startStream<{ messageId: string }>(
            sender,
            streamGenerator(),
            {
              onStart: ON_INTENT_STREAM_START,
              onChunk: ON_INTENT_STREAM_CHUNK,
              onEnd: ON_INTENT_STREAM_END,
              onError: ON_INTENT_STREAM_ERROR
            },
            {},
            correlationId
          );
          
          if (correlationId) {
            performanceTracker.recordEvent(correlationId, 'AgentService', 'direct_stream_complete', {
              hasResult: !!result,
              messageId: result?.messageId
            });
          }
          
        } catch (streamError) {
          this.logger.error('Direct streaming error:', streamError);
          // StreamManager already sent error event, just log here
        }
      }
      
    } catch (error) {
      this.logger.error('Error in streaming intent processing:', error);
      sender.send(ON_INTENT_STREAM_ERROR, { 
        error: error instanceof Error ? error.message : 'An error occurred while processing your request.' 
      });
    }
    });
  }

  private async handleToolCallsForStreamingWithAtomicSave(
    assistantMessage: OpenAIMessage,
    messages: OpenAIMessage[], 
    senderId: string,
    sessionId: string,
    correlationId?: string
  ): Promise<ToolCallResult[]> {
    const toolCalls = assistantMessage.tool_calls!;
    
    this.logger.info(`Processing ${toolCalls.length} tool call(s) for streaming with atomic save`);
    
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
      this.logger.debug(`Atomically saved assistant message and ${toolCalls.length} tool responses for streaming`);
    } catch (error) {
      this.logger.error('Failed to save conversation turn atomically:', error);
      // Critical failure - the conversation state is now inconsistent
      throw error;
    }
    
    // Update history
    this.deps.conversationService.updateConversationHistory(senderId, messages);
    
    return toolResults;
  }

  private async handleToolCallsForStreaming(
    toolCalls: any[], 
    messages: OpenAIMessage[], 
    senderId: string,
    sessionId: string,
    correlationId?: string
  ): Promise<ToolCallResult[]> {
    this.logger.info(`Processing ${toolCalls.length} tool call(s) for streaming`);
    
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
      this.logger.debug(`Saved ${toolMessages.length} tool response messages in transaction`);
    } catch (error) {
      this.logger.error('Failed to save tool response messages:', error);
      // Continue processing - messages are already in memory
    }
    
    // Update history
    this.deps.conversationService.updateConversationHistory(senderId, messages);
    
    return toolResults;
  }




  private async handleToolCallsWithAtomicSave(
    assistantMessage: OpenAIMessage,
    messages: OpenAIMessage[], 
    senderId: string,
    sessionId: string,
    correlationId?: string
  ): Promise<IntentResultPayload> {
    const toolCalls = assistantMessage.tool_calls!;
    
    this.logger.info(`Processing ${toolCalls.length} tool call(s) with atomic save`);
    
    if (correlationId) {
      performanceTracker.recordEvent(correlationId, 'AgentService', 'processing_tool_calls');
    }
    
    // Process all tool calls in parallel
    const toolPromises = toolCalls.map(tc => this.processToolCall(tc));
    const toolResults = await Promise.all(toolPromises);
    
    if (correlationId) {
      performanceTracker.recordEvent(correlationId, 'AgentService', 'tool_calls_completed');
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
      this.logger.debug(`Atomically saved assistant message and ${toolCalls.length} tool responses`);
    } catch (error) {
      this.logger.error('Failed to save conversation turn atomically:', error);
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
    
    if (hasSearchResults) {
      return await this.getAISummary(messages, senderId, correlationId);
    }
    
    // Check if we have any meaningful content to return
    const meaningfulContent = toolResults.find(r => 
      r.content && 
      !r.content.startsWith('Opened ') && 
      !r.content.startsWith('Created ') &&
      !r.content.startsWith('Deleted ')
    );
    
    if (meaningfulContent) {
      // Get AI to formulate a proper response based on the tool results
      return await this.getAISummary(messages, senderId, correlationId);
    }
    
    return { type: 'chat_reply', message: 'Request processed.' };
  }

  private async handleToolCalls(
    toolCalls: any[], 
    messages: OpenAIMessage[], 
    senderId: string,
    sessionId: string,
    correlationId?: string
  ): Promise<IntentResultPayload> {
    this.logger.info(`Processing ${toolCalls.length} tool call(s)`);
    
    if (correlationId) {
      performanceTracker.recordEvent(correlationId, 'AgentService', 'processing_tool_calls', {
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
      this.logger.debug(`Saved ${toolMessages.length} tool response messages in transaction`);
    } catch (error) {
      this.logger.error('Failed to save tool response messages:', error);
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
    
    if (hasSearchResults) {
      return await this.getAISummary(messages, senderId, correlationId);
    }
    
    // Check if we have any meaningful content to return
    const meaningfulContent = toolResults.find(r => 
      r.content && 
      !r.content.startsWith('Opened ') && 
      !r.content.startsWith('Created ') &&
      !r.content.startsWith('Deleted ')
    );
    
    if (meaningfulContent) {
      // Get AI to formulate a proper response based on the tool results
      return await this.getAISummary(messages, senderId, correlationId);
    }
    
    return { type: 'chat_reply', message: 'Request processed.' };
  }

  private async processToolCall(toolCall: any, payload?: SetIntentPayload): Promise<ToolCallResult> {
    const { name, arguments: argsJson } = toolCall.function;
    
    try {
      const args = JSON.parse(argsJson);
      this.logger.info(`Processing tool: ${name}`, args);
      
      // Look up tool in registry
      const tool = AGENT_TOOLS[name];
      if (!tool) {
        this.logger.warn(`Unknown tool: ${name}`);
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
        formatter: this.formatter
      };
      
      // Execute tool
      return await tool.handle(args, context);
    } catch (error) {
      this.logger.error(`Tool call error:`, error);
      return { content: `Error: ${error instanceof Error ? error.message : 'Tool execution failed'}` };
    }
  }

  private async searchNews(query: string): Promise<HybridSearchResult[]> {
    return await this.deps.searchService.searchNews(query);
  }

  private async getAISummary(messages: OpenAIMessage[], senderId: string, correlationId?: string): Promise<IntentResultPayload> {
    const sessionId = this.deps.conversationService.getSessionId(senderId);
    if (!sessionId) {
      this.logger.error('No sessionId found for senderId:', senderId);
      return { type: 'error', message: 'Session not found' };
    }
    
    try {
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'generating_summary');
      }
      
      const summaryMessage = await this.deps.llmClient.callOpenAI(messages);
      
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'summary_generated');
      }
      
      if (summaryMessage?.content) {
        messages.push(summaryMessage);
        this.deps.conversationService.updateConversationHistory(senderId, messages);
        
        // Save summary message to database
        await this.deps.conversationService.saveMessage(sessionId, 'assistant', summaryMessage.content);
        
        // Process accumulated search results into slices
        const searchResults = this.deps.searchService.getCurrentSearchResults();
        this.logger.info(`Processing ${searchResults.length} accumulated search results into slices`);
        const slices = await this.deps.searchService.processSearchResultsToSlices(searchResults);
        this.logger.info(`Got ${slices.length} slices to include in chat_reply`);
        
        return { 
          type: 'chat_reply', 
          message: summaryMessage.content,
          slices: slices.length > 0 ? slices : undefined
        };
      }
    } catch (error) {
      this.logger.error(`Summary error:`, error);
    }
    
    // Fallback
    const searchContents = messages
      .filter(m => m.role === 'tool' && m.content?.includes('Search Results'))
      .map(m => m.content)
      .join('\n\n');
    
    // Even in fallback, try to include slices
    const searchResults = this.deps.searchService.getCurrentSearchResults();
    this.logger.info(`Fallback path: Processing ${searchResults.length} accumulated search results`);
    const slices = await this.deps.searchService.processSearchResultsToSlices(searchResults);
    this.logger.info(`Fallback path: Got ${slices.length} slices`);
    
    return { 
      type: 'chat_reply', 
      message: `I found search results but couldn't summarize them. Here's what I found:\n\n${searchContents}`,
      slices: slices.length > 0 ? slices : undefined
    };
  }

  async *streamAISummary(
    messages: OpenAIMessage[], 
    senderId: string, 
    correlationId?: string,
    onSlicesReady?: (slices: DisplaySlice[]) => void
  ): AsyncGenerator<string, { messageId: string } | null, unknown> {
    const sessionId = this.deps.conversationService.getSessionId(senderId);
    if (!sessionId) {
      this.logger.error('No sessionId found for senderId:', senderId);
      throw new Error('Session not found');
    }
    
    try {
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'processing_slices');
      }
      
      // Process slices immediately and send them
      const slices = await this.deps.searchService.processSearchResultsToSlices(this.deps.searchService.getCurrentSearchResults());
      this.logger.info(`Got ${slices.length} slices to send immediately`);
      
      if (onSlicesReady && slices.length > 0) {
        onSlicesReady(slices);
      }
      
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'starting_stream');
      }
      
      // Create message record with placeholder content
      const messageId = await this.deps.conversationService.saveMessage(sessionId, 'assistant', '');
      let fullContent = '';
      
      // Stream the summary
      const stream = this.deps.llmClient.streamOpenAI(messages);
      
      for await (const chunk of stream) {
        fullContent += chunk;
        yield chunk;
      }
      
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'stream_complete');
      }
      
      // Update the complete message in database
      if (fullContent) {
        await this.deps.conversationService.updateMessage(messageId, fullContent);
        messages.push({ role: 'assistant', content: fullContent });
        this.deps.conversationService.updateConversationHistory(senderId, messages);
      }
      
      return { messageId };
      
    } catch (error) {
      this.logger.error(`Stream summary error:`, error);
      throw error;
    }
  }

  // Delegate conversation methods to ConversationService
  clearConversation(senderId: string): void {
    this.deps.conversationService.clearConversation(senderId);
  }

  clearAllConversations(): void {
    this.deps.conversationService.clearAllConversations();
  }
  
  getActiveConversationCount(): number {
    return this.deps.conversationService.getActiveConversationCount();
  }
  
  // Public methods for testing
  detectNewsSources(query: string): { sources: string[]; cleanedQuery: string } {
    return this.deps.searchService.detectNewsSources(query);
  }
}

