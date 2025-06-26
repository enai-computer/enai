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
import { BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { createChatModel } from '../utils/llm';
import { 
  NEWS_SOURCE_MAPPINGS, 
  OPENAI_CONFIG, 
  generateSystemPrompt, 
  TOOL_DEFINITIONS 
} from './AgentService.constants';
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

interface OpenAIMessage {
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
}

export class AgentService extends BaseService<AgentServiceDeps> {
  private conversationHistory = new Map<string, OpenAIMessage[]>();
  private sessionIdMap = new Map<string, string>(); // Maps senderId to sessionId
  private currentIntentSearchResults: HybridSearchResult[] = []; // Aggregate search results for current intent
  private formatter: SearchResultFormatter;

  constructor(deps: AgentServiceDeps) {
    super('AgentService', deps);
    this.formatter = deps.searchResultFormatter;
  }

  async initialize(): Promise<void> {
    this.logger.info('AgentService initialized');
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up AgentService - clearing conversation history');
    
    // Clear all conversation history
    const conversationCount = this.conversationHistory.size;
    this.conversationHistory.clear();
    this.sessionIdMap.clear();
    
    this.logger.info(`AgentService cleanup complete - cleared ${conversationCount} conversations`);
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
      this.currentIntentSearchResults = [];
      
      // Ensure we have a session for this sender
      const sessionId = await this.ensureSession(effectiveSenderId);
      
      // Get messages and ensure system prompt
      const messages = await this.prepareMessages(effectiveSenderId, intentText, payload);
      
      // First save user message before making the OpenAI call
      let userMessageId: string = '';
      try {
        userMessageId = await this.saveMessage(sessionId, 'user', intentText);
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
        assistantMessage = await this.callOpenAI(messages);
      } catch (error) {
        this.logger.error('OpenAI call failed:', error);
        // Save error state if we have a user message
        if (userMessageId) {
          try {
            await this.saveMessage(
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
      this.updateConversationHistory(effectiveSenderId, messages);
      
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
        await this.saveMessage(
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
    this.currentIntentSearchResults = [];
    
    try {
      // Ensure we have a session for this sender
      const sessionId = await this.ensureSession(effectiveSenderId);
      
      // Get messages and ensure system prompt
      const messages = await this.prepareMessages(effectiveSenderId, intentText);
      
      // Save user message to database
      await this.saveMessage(sessionId, 'user', intentText);
      
      // Call OpenAI for tool processing
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'calling_openai_streaming');
      }
      
      const assistantMessage = await this.callOpenAI(messages);
      
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'openai_response_received_streaming');
      }
      
      if (!assistantMessage) {
        sender.send(ON_INTENT_STREAM_ERROR, { error: 'Failed to get response from AI' });
        return;
      }
      
      messages.push(assistantMessage);
      this.updateConversationHistory(effectiveSenderId, messages);
      
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
        const hasSearchResults = this.currentIntentSearchResults.length > 0;
        
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
          const streamGenerator = async function* (this: AgentService): AsyncGenerator<string, { messageId: string } | null, unknown> {
            // Create message record with placeholder content
            const messageId = await this.saveMessage(sessionId, 'assistant', '');
            let fullContent = '';
            
            // Stream the response using the existing streamOpenAI method
            const stream = this.streamOpenAI(messages);
            
            for await (const chunk of stream) {
              fullContent += chunk;
              yield chunk;
            }
            
            // Update the complete message in database
            if (fullContent) {
              await this.updateMessage(messageId, fullContent);
              messages.push({ role: 'assistant', content: fullContent });
              this.updateConversationHistory(effectiveSenderId, messages);
            }
            
            return { messageId };
          }.bind(this);
          
          // Use StreamManager to handle streaming
          const result = await this.deps.streamManager.startStream(
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
      await this.saveMessagesInTransaction(sessionId, messagesToSave);
      this.logger.debug(`Atomically saved assistant message and ${toolCalls.length} tool responses for streaming`);
    } catch (error) {
      this.logger.error('Failed to save conversation turn atomically:', error);
      // Critical failure - the conversation state is now inconsistent
      throw error;
    }
    
    // Update history
    this.updateConversationHistory(senderId, messages);
    
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
      await this.saveMessagesInTransaction(sessionId, toolMessages);
      this.logger.debug(`Saved ${toolMessages.length} tool response messages in transaction`);
    } catch (error) {
      this.logger.error('Failed to save tool response messages:', error);
      // Continue processing - messages are already in memory
    }
    
    // Update history
    this.updateConversationHistory(senderId, messages);
    
    return toolResults;
  }

  private async prepareMessages(senderId: string, intentText: string, payload?: SetIntentPayload): Promise<OpenAIMessage[]> {
    let messages = this.conversationHistory.get(senderId) || [];
    
    // If no in-memory history, try to load from database
    if (messages.length === 0) {
      const sessionId = this.sessionIdMap.get(senderId);
      if (sessionId) {
        messages = await this.loadMessagesFromDatabase(sessionId);
        if (messages.length > 0) {
          this.conversationHistory.set(senderId, messages);
        }
      }
    }
    
    // Always fetch current notebooks to ensure freshness (exclude NotebookCovers)
    const notebooks = await this.deps.notebookService.getAllRegularNotebooks();
    this.logger.info(`Found ${notebooks.length} regular notebooks for system prompt:`, notebooks.map(n => ({ id: n.id, title: n.title })));
    
    // Fetch user profile data
    const profileContext = await this.deps.profileService.getEnrichedProfileForAI('default_user');
    this.logger.info(`Fetched profile context for system prompt, length: ${profileContext.length}`);
    this.logger.debug(`Profile context content:`, profileContext);
    
    // Generate system prompt with notebooks, profile, and current notebook context
    const currentSystemPromptContent = generateSystemPrompt(notebooks, profileContext, payload?.notebookId);
    
    if (messages.length === 0) {
      // New conversation: add the fresh system prompt
      this.logger.debug(`New conversation for sender ${senderId}. Adding system prompt.`);
      messages.push({ 
        role: "system", 
        content: currentSystemPromptContent 
      });
    } else {
      // Existing conversation: find and update the system prompt
      const systemMessageIndex = messages.findIndex(msg => msg.role === "system");
      if (systemMessageIndex !== -1) {
        this.logger.debug(`Existing conversation for sender ${senderId}. Updating system prompt.`);
        messages[systemMessageIndex].content = currentSystemPromptContent;
      } else {
        this.logger.warn(`Existing conversation for sender ${senderId} but no system prompt found. Prepending.`);
        messages.unshift({ role: "system", content: currentSystemPromptContent });
      }
    }
    
    // Add user message
    messages.push({ role: "user", content: intentText });
    
    return messages;
  }

  private async callOpenAI(messages: OpenAIMessage[]): Promise<OpenAIMessage | null> {
    try {
      // Log the raw messages being sent to OpenAI
      this.logger.debug('Messages being sent to OpenAI:', 
        messages.map(msg => ({
          role: msg.role,
          content: msg.role === 'system' ? 
            msg.content?.substring(0, 200) + '...' : // Truncate system messages
            msg.content,
          tool_calls: msg.tool_calls,
          tool_call_id: msg.tool_call_id
        }))
      );
      
      // Convert OpenAIMessage format to BaseMessage format
      const baseMessages: BaseMessage[] = messages.map(msg => {
        if (msg.role === "system") {
          return new SystemMessage(msg.content || "");
        } else if (msg.role === "user") {
          return new HumanMessage(msg.content || "");
        } else if (msg.role === "assistant") {
          const aiMsg = new AIMessage(msg.content || "");
          if (msg.tool_calls) {
            // Add tool calls to the message
            (aiMsg as any).additional_kwargs = { tool_calls: msg.tool_calls };
          }
          return aiMsg;
        } else if (msg.role === "tool") {
          return new ToolMessage({
            content: msg.content || "",
            tool_call_id: msg.tool_call_id || ""
          });
        }
        throw new Error(`Unknown message role: ${msg.role}`);
      });

      // Using gpt-4.1 for all core reasoning, tool use, and summarization
      const llm = createChatModel('gpt-4.1', { temperature: OPENAI_CONFIG.temperature });

      // Bind tools to the model
      const llmWithTools = llm.bind({
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto"
      });

      // Call the model
      const response = await llmWithTools.invoke(baseMessages);
      
      // Convert response back to OpenAIMessage format
      const toolCalls = (response as any).additional_kwargs?.tool_calls;
      
      return {
        role: "assistant",
        content: response.content as string || null,
        tool_calls: toolCalls
      };
    } catch (error) {
      this.logger.error(`LLM call error:`, error);
      throw error;
    }
  }

  private async *streamOpenAI(
    messages: OpenAIMessage[], 
    onChunk?: (chunk: string) => void
  ): AsyncGenerator<string, OpenAIMessage | null, unknown> {
    try {
      // Convert OpenAIMessage format to BaseMessage format
      const baseMessages: BaseMessage[] = messages.map(msg => {
        if (msg.role === "system") {
          return new SystemMessage(msg.content || "");
        } else if (msg.role === "user") {
          return new HumanMessage(msg.content || "");
        } else if (msg.role === "assistant") {
          const aiMsg = new AIMessage(msg.content || "");
          if (msg.tool_calls) {
            // Add tool calls to the message
            (aiMsg as any).additional_kwargs = { tool_calls: msg.tool_calls };
          }
          return aiMsg;
        } else if (msg.role === "tool") {
          return new ToolMessage({
            content: msg.content || "",
            tool_call_id: msg.tool_call_id || ""
          });
        }
        throw new Error(`Unknown message role: ${msg.role}`);
      });

      // Using gpt-4o for all core reasoning, tool use, and summarization
      const llm = createChatModel('gpt-4o', { temperature: OPENAI_CONFIG.temperature });

      // Bind tools to the model - for summary generation, we don't need tools
      const llmWithTools = llm.bind({
        tools: [] // No tools for summary generation
      });

      // Stream the response
      const stream = await llmWithTools.stream(baseMessages);
      let fullContent = '';
      
      for await (const chunk of stream) {
        const content = chunk.content as string || '';
        if (content) {
          fullContent += content;
          if (onChunk) {
            onChunk(content);
          }
          yield content;
        }
      }
      
      // Return the complete message after streaming
      return {
        role: "assistant",
        content: fullContent,
        tool_calls: undefined
      };
    } catch (error) {
      this.logger.error(`LLM streaming error:`, error);
      throw error;
    }
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
      await this.saveMessagesInTransaction(sessionId, messagesToSave);
      this.logger.debug(`Atomically saved assistant message and ${toolCalls.length} tool responses`);
    } catch (error) {
      this.logger.error('Failed to save conversation turn atomically:', error);
      // Critical failure - the conversation state is now inconsistent
      // We should not continue as if everything is fine
      throw error;
    }
    
    // Update history
    this.updateConversationHistory(senderId, messages);
    
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
      await this.saveMessagesInTransaction(sessionId, toolMessages);
      this.logger.debug(`Saved ${toolMessages.length} tool response messages in transaction`);
    } catch (error) {
      this.logger.error('Failed to save tool response messages:', error);
      // Continue processing - messages are already in memory
    }
    
    // Update history
    this.updateConversationHistory(senderId, messages);
    
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
          profileService: this.deps.profileService
        },
        sessionInfo: {
          senderId: '', // Will be set by caller if needed
          sessionId: '' // Will be set by caller if needed
        },
        currentIntentSearchResults: this.currentIntentSearchResults,
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
    const sources = this.detectNewsSourcesInternal(query);
    
    if (sources.length > 0) {
      // Multi-source search
      const cleanedQuery = this.removeSourcesFromQuery(query, sources);
      const results = await this.searchMultipleSources(sources, cleanedQuery);
      return results;
    }
    
    // General news search
    return await this.deps.hybridSearchService.searchNews(query, {
      numResults: 10
    });
  }


  private removeSourcesFromQuery(query: string, sources: string[]): string {
    let cleaned = query;
    
    for (const source of sources) {
      const aliases = NEWS_SOURCE_MAPPINGS[source as keyof typeof NEWS_SOURCE_MAPPINGS] || [];
      for (const alias of aliases) {
        cleaned = cleaned.replace(new RegExp(alias, 'gi'), '');
      }
    }
    
    return cleaned
      .replace(/\b(and|from|in|the)\b/gi, ' ')
      .replace(/[,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async searchMultipleSources(
    sources: string[], 
    cleanedQuery: string
  ): Promise<HybridSearchResult[]> {
    const { cleanNewsContent } = await import('./helpers/contentFilter');
    
    const searchPromises = sources.map(async (source) => {
      try {
        const query = `site:${source} ${cleanedQuery || 'headlines'} today`;
        const response = await this.deps.exaService.search(query, {
          type: 'neural',
          numResults: 3,
          includeDomains: [source],
          contents: { text: true, highlights: true, summary: true },
        });
        
        return response.results.map(result => ({
          id: result.id,
          title: result.title,
          url: result.url,
          content: result.text ? cleanNewsContent(result.text) : result.summary || '',
          score: result.score,
          source: 'exa' as const,
          publishedDate: result.publishedDate,
          author: result.author,
          highlights: result.highlights,
        }));
      } catch (error) {
        this.logger.error(`Failed to search ${source}:`, error);
        return [];
      }
    });
    
    const results = await Promise.all(searchPromises);
    return results.flat();
  }

  private async getAISummary(messages: OpenAIMessage[], senderId: string, correlationId?: string): Promise<IntentResultPayload> {
    const sessionId = this.sessionIdMap.get(senderId);
    if (!sessionId) {
      this.logger.error('No sessionId found for senderId:', senderId);
      return { type: 'error', message: 'Session not found' };
    }
    
    try {
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'generating_summary');
      }
      
      const summaryMessage = await this.callOpenAI(messages);
      
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'summary_generated');
      }
      
      if (summaryMessage?.content) {
        messages.push(summaryMessage);
        this.updateConversationHistory(senderId, messages);
        
        // Save summary message to database
        await this.saveMessage(sessionId, 'assistant', summaryMessage.content);
        
        // Process accumulated search results into slices
        this.logger.info(`Processing ${this.currentIntentSearchResults.length} accumulated search results into slices`);
        const slices = await this.processSearchResultsToSlices(this.currentIntentSearchResults);
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
    this.logger.info(`Fallback path: Processing ${this.currentIntentSearchResults.length} accumulated search results`);
    const slices = await this.processSearchResultsToSlices(this.currentIntentSearchResults);
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
    const sessionId = this.sessionIdMap.get(senderId);
    if (!sessionId) {
      this.logger.error('No sessionId found for senderId:', senderId);
      throw new Error('Session not found');
    }
    
    try {
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'processing_slices');
      }
      
      // Process slices immediately and send them
      const slices = await this.processSearchResultsToSlices(this.currentIntentSearchResults);
      this.logger.info(`Got ${slices.length} slices to send immediately`);
      
      if (onSlicesReady && slices.length > 0) {
        onSlicesReady(slices);
      }
      
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'starting_stream');
      }
      
      // Create message record with placeholder content
      const messageId = await this.saveMessage(sessionId, 'assistant', '');
      let fullContent = '';
      
      // Stream the summary
      const stream = this.streamOpenAI(messages);
      
      for await (const chunk of stream) {
        fullContent += chunk;
        yield chunk;
      }
      
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'stream_complete');
      }
      
      // Update the complete message in database
      if (fullContent) {
        await this.updateMessage(messageId, fullContent);
        messages.push({ role: 'assistant', content: fullContent });
        this.updateConversationHistory(senderId, messages);
      }
      
      return { messageId };
      
    } catch (error) {
      this.logger.error(`Stream summary error:`, error);
      throw error;
    }
  }

  private async updateMessage(messageId: string, content: string): Promise<void> {
    const model = this.deps.chatModel;
    if (!model) {
      throw new Error('ChatModel not available');
    }
    
    // We need to add an update method to ChatModel or use the existing save mechanism
    // For now, we'll log this as a TODO
    this.logger.info(`TODO: Update message ${messageId} with final content`);
  }

  private updateConversationHistory(senderId: string, messages: OpenAIMessage[]): void {
    // Trim if too long
    if (messages.length > OPENAI_CONFIG.maxHistoryLength) {
      messages = [messages[0], ...messages.slice(-OPENAI_CONFIG.maxHistoryLength + 1)];
    }
    
    this.conversationHistory.set(senderId, this.filterValidMessages(messages));
  }

  private filterValidMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
    const filtered: OpenAIMessage[] = [];
    
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      
      if (message.role === 'tool') {
        // Ensure tool message has valid context
        const prevMessage = i > 0 ? messages[i - 1] : null;
        if (prevMessage?.role === 'assistant' && prevMessage.tool_calls?.some(tc => tc.id === message.tool_call_id)) {
          filtered.push(message);
        }
      } else {
        filtered.push(message);
      }
    }
    
    return filtered;
  }

  clearConversation(senderId: string): void {
    this.conversationHistory.delete(senderId);
    this.sessionIdMap.delete(senderId);
    this.logger.info(`Cleared conversation for sender ${senderId}`);
  }

  clearAllConversations(): void {
    this.conversationHistory.clear();
    this.sessionIdMap.clear();
    this.logger.info(`Cleared all conversations`);
  }
  
  getActiveConversationCount(): number {
    return this.conversationHistory.size;
  }
  
  // New private methods for database integration
  private async ensureSession(senderId: string): Promise<string> {
    // Check if we already have a session ID for this sender
    let sessionId = this.sessionIdMap.get(senderId);
    
    if (!sessionId) {
      // Get or create the NotebookCover for the user
      // For now, we're using default_user for all homepage conversations
      const notebookCover = await this.deps.notebookService.getNotebookCover('default_user');
      
      try {
        // Create session and let ChatModel generate the ID
        const session = await this.deps.chatModel.createSession(
          notebookCover.id, 
          undefined, // Let ChatModel generate the session ID
          `Conversation - ${new Date().toLocaleString()}`
        );
        sessionId = session.sessionId;
        this.sessionIdMap.set(senderId, sessionId);
        this.logger.info(`Created new session ${sessionId} for sender ${senderId} in NotebookCover ${notebookCover.id}`);
      } catch (error) {
        this.logger.error(`Failed to create session for sender ${senderId}:`, error);
        throw error;
      }
    }
    
    return sessionId;
  }
  
  private async saveMessage(
    sessionId: string, 
    role: ChatMessageRole, 
    content: string, 
    metadata?: any
  ): Promise<string> {
    const message = await this.deps.chatModel.addMessage({
      sessionId,
      role,
      content,
      metadata
    });
    this.logger.debug(`Saved ${role} message to session ${sessionId}`);
    return message.messageId;
  }

  /**
   * Save multiple messages in a single transaction.
   * Used for atomic saves of related messages (e.g., tool calls and responses).
   */
  private async saveMessagesInTransaction(
    sessionId: string,
    messages: Array<{
      role: ChatMessageRole;
      content: string;
      metadata?: any;
    }>
  ): Promise<string[]> {
    const messageIds: string[] = [];
    
    this.withTransaction(this.deps.db, () => {
      for (const msg of messages) {
        const message = this.deps.chatModel.addMessageSync({
          sessionId,
          role: msg.role,
          content: msg.content,
          metadata: msg.metadata
        });
        messageIds.push(message.messageId);
      }
    });
    
    this.logger.debug(`Saved ${messages.length} messages in transaction for session ${sessionId}`);
    return messageIds;
  }
  
  private validateLoadedMessages(messages: OpenAIMessage[]): {
    valid: boolean;
    errors: string[];
    sanitizedMessages: OpenAIMessage[];
  } {
    const errors: string[] = [];
    const pendingToolCalls = new Map<string, { messageIndex: number; toolName: string }>();
    const sanitizedMessages: OpenAIMessage[] = [];

    // Track which tool calls have valid responses
    const validToolCallIds = new Set<string>();
    
    // First pass: identify all tool call IDs and their responses
    messages.forEach((message, index) => {
      if (message.role === 'assistant' && message.tool_calls) {
        message.tool_calls.forEach(toolCall => {
          pendingToolCalls.set(toolCall.id, {
            messageIndex: index,
            toolName: toolCall.function.name
          });
        });
      }
      
      if (message.role === 'tool' && message.tool_call_id) {
        if (pendingToolCalls.has(message.tool_call_id)) {
          validToolCallIds.add(message.tool_call_id);
          pendingToolCalls.delete(message.tool_call_id);
        }
      }
    });
    
    // Report unmatched tool calls
    pendingToolCalls.forEach((info, toolCallId) => {
      errors.push(
        `Assistant message at index ${info.messageIndex} has tool_call '${toolCallId}' ` +
        `(${info.toolName}) without a corresponding tool response message`
      );
    });
    
    // Second pass: build sanitized message list
    messages.forEach((message, index) => {
      if (message.role === 'assistant' && message.tool_calls) {
        // Filter out tool calls that don't have responses
        const validToolCalls = message.tool_calls.filter(tc => validToolCallIds.has(tc.id));
        if (validToolCalls.length > 0) {
          sanitizedMessages.push({
            ...message,
            tool_calls: validToolCalls
          });
        } else {
          // If no valid tool calls, include message without tool_calls
          const { tool_calls, ...messageWithoutTools } = message;
          sanitizedMessages.push(messageWithoutTools);
        }
      } else if (message.role === 'tool') {
        // Only include tool messages that correspond to valid tool calls
        if (message.tool_call_id && validToolCallIds.has(message.tool_call_id)) {
          sanitizedMessages.push(message);
        }
      } else {
        // Include all other messages as-is
        sanitizedMessages.push(message);
      }
    });
    
    return {
      valid: errors.length === 0,
      errors,
      sanitizedMessages
    };
  }

  private async loadMessagesFromDatabase(sessionId: string): Promise<OpenAIMessage[]> {
    try {
      const dbMessages = await this.deps.chatModel.getMessagesBySessionId(sessionId);
      
      const messages = dbMessages.map(msg => {
        const baseMessage: OpenAIMessage = {
          role: msg.role as "system" | "user" | "assistant" | "tool",
          content: msg.content
        };
        
        // Parse metadata if needed
        if (msg.metadata) {
          try {
            const metadata = JSON.parse(msg.metadata);
            if (metadata.toolCalls) {
              baseMessage.tool_calls = metadata.toolCalls;
            }
            if (metadata.toolCallId) {
              baseMessage.tool_call_id = metadata.toolCallId;
            }
          } catch (e) {
            this.logger.warn(`Failed to parse metadata for message ${msg.messageId}`);
          }
        }
        
        return baseMessage;
      });
      
      // Validate conversation history
      const validation = this.validateLoadedMessages(messages);
      if (!validation.valid) {
        this.logger.error(`Invalid conversation history loaded from database:`, validation.errors);
        // Use sanitized version to prevent API errors
        return validation.sanitizedMessages;
      }
      
      return messages;
    } catch (error) {
      this.logger.error(`Failed to load messages from database:`, error);
      return [];
    }
  }
  
  // Public methods for testing
  detectNewsSources(query: string): { sources: string[]; cleanedQuery: string } {
    const sources = this.detectNewsSourcesInternal(query);
    const cleanedQuery = sources.length > 0 ? this.removeSourcesFromQuery(query, sources) : query;
    return { sources, cleanedQuery };
  }
  
  private detectNewsSourcesInternal(query: string): string[] {
    const lower = query.toLowerCase();
    const detected: string[] = [];
    
    for (const [domain, aliases] of Object.entries(NEWS_SOURCE_MAPPINGS)) {
      if (aliases.some(alias => lower.includes(alias))) {
        detected.push(domain);
      }
    }
    
    return detected;
  }
  
  private async processSearchResultsToSlices(results: HybridSearchResult[]): Promise<DisplaySlice[]> {
    this.logger.info(`processSearchResultsToSlices called with ${results.length} results`);
    
    // Log the full results for debugging
    this.logger.debug('Full search results:', results.map(r => ({
      source: r.source,
      chunkId: r.chunkId,
      objectId: r.objectId,
      title: r.title,
      url: r.url,
      hasContent: !!r.content,
      contentLength: r.content?.length || 0
    })));
    
    const displaySlices: DisplaySlice[] = [];
    const maxResults = 100; // Limit to prevent memory issues
    const limitedResults = results.slice(0, maxResults);
    
    try {
      // Separate local and web results
      const localResults = limitedResults.filter(r => r.source === 'local');
      const webResults = limitedResults.filter(r => r.source === 'exa');
      
      this.logger.info(`Processing ${localResults.length} local and ${webResults.length} web results`);
      
      // Log filtered local results for debugging
      this.logger.debug('Filtered local results:', localResults.map(r => ({
        chunkId: r.chunkId,
        chunkIdType: typeof r.chunkId,
        objectId: r.objectId,
        title: r.title
      })));
      
      // Process local results
      if (localResults.length > 0) {
        // Collect all chunk IDs from local results
        const rawChunkIds = localResults.map(r => r.chunkId);
        this.logger.debug('Raw chunk IDs before filtering:', rawChunkIds);
        this.logger.debug('Chunk ID types:', rawChunkIds.map(id => ({
          value: id,
          type: typeof id,
          isNumber: typeof id === 'number',
          isBigInt: typeof id === 'bigint',
          constructor: id?.constructor?.name
        })));
        
        const chunkIds = localResults
          .map(r => r.chunkId)
          .filter((id): id is number => typeof id === 'number');
        
        this.logger.debug('Chunk IDs after filtering:', chunkIds);
        
        if (chunkIds.length > 0) {
          this.logger.info(`Fetching details for ${chunkIds.length} chunks: ${chunkIds.join(', ')}`);
          try {
            // Batch fetch slice details
            const sliceDetails = await this.deps.sliceService.getDetailsForSlices(chunkIds);
            this.logger.info(`SliceService returned ${sliceDetails.length} slice details`);
            this.logger.debug('Slice details:', sliceDetails.map(d => ({
              chunkId: d.chunkId,
              title: d.sourceObjectTitle,
              uri: d.sourceObjectUri,
              contentLength: d.content?.length || 0
            })));
            
            // Convert SliceDetail to DisplaySlice
            for (const detail of sliceDetails) {
              const displaySlice = {
                id: `local-${detail.chunkId}`,
                title: detail.sourceObjectTitle,
                sourceUri: detail.sourceObjectUri,
                content: detail.content,
                summary: detail.summary,
                sourceType: 'local' as const,
                chunkId: detail.chunkId,
                sourceObjectId: detail.sourceObjectId,
                score: localResults.find(r => r.chunkId === detail.chunkId)?.score
              };
              this.logger.debug(`Adding local display slice:`, {
                id: displaySlice.id,
                title: displaySlice.title,
                sourceUri: displaySlice.sourceUri
              });
              displaySlices.push(displaySlice);
            }
          } catch (error) {
            this.logger.error('Error fetching slice details:', error);
            // Fallback: create DisplaySlice from HybridSearchResult
            this.logger.debug('Using fallback for local results');
            for (const result of localResults) {
              const fallbackSlice = {
                id: result.id,
                title: result.title,
                sourceUri: result.url || null,
                content: result.content.substring(0, 500), // Truncate for display
                summary: null, // Fallback doesn't have summary
                sourceType: 'local' as const,
                chunkId: result.chunkId,
                sourceObjectId: result.objectId,
                score: result.score
              };
              this.logger.debug(`Adding fallback slice:`, {
                id: fallbackSlice.id,
                title: fallbackSlice.title,
                chunkId: fallbackSlice.chunkId
              });
              displaySlices.push(fallbackSlice);
            }
          }
        } else {
          this.logger.warn('No valid chunk IDs found in local results');
        }
      }
      
      // Process web results
      for (const result of webResults) {
        const webSlice = {
          id: result.id,
          title: result.title,
          sourceUri: result.url || null,
          content: result.content.substring(0, 500), // Truncate for display
          summary: null, // Web results don't have summaries yet
          sourceType: 'web' as const,
          score: result.score,
          publishedDate: result.publishedDate,
          author: result.author
        };
        this.logger.debug(`Adding web display slice:`, {
          id: webSlice.id,
          title: webSlice.title,
          sourceUri: webSlice.sourceUri
        });
        displaySlices.push(webSlice);
      }
      
      this.logger.debug(`Before deduplication: ${displaySlices.length} slices`);
      
      // Improved deduplication logic
      const seen = new Map<string, DisplaySlice>();
      for (const slice of displaySlices) {
        // For local content, use a composite key of sourceUri + chunkId to avoid over-deduplication
        let key: string;
        if (slice.sourceType === 'local' && slice.chunkId !== undefined) {
          // Use composite key for local chunks
          key = `${slice.sourceUri || 'local'}-chunk-${slice.chunkId}`;
          this.logger.debug(`Local slice dedup key: "${key}" (sourceUri: "${slice.sourceUri}", chunkId: ${slice.chunkId})`);
        } else if (slice.sourceUri) {
          // For web content with URLs, use the URL
          key = slice.sourceUri;
          this.logger.debug(`Web slice dedup key: "${key}" (using sourceUri)`);
        } else {
          // Fallback to ID
          key = slice.id;
          this.logger.debug(`Fallback dedup key: "${key}" (using id, no sourceUri or chunkId)`);
        }
        
        if (!seen.has(key) || (seen.get(key)!.score || 0) < (slice.score || 0)) {
          seen.set(key, slice);
          this.logger.debug(`Keeping slice with key: "${key}"`);
        } else {
          this.logger.debug(`Removing duplicate with key: "${key}" (already have one with score ${seen.get(key)!.score || 0})`);
        }
      }
      
      const finalSlices = Array.from(seen.values());
      this.logger.info(`Returning ${finalSlices.length} display slices after deduplication`);
      this.logger.debug('Final unique slices:', finalSlices.map(s => ({
        id: s.id,
        title: s.title,
        sourceUri: s.sourceUri,
        sourceType: s.sourceType,
        chunkId: s.chunkId
      })));
      return finalSlices;
    } catch (error) {
      this.logger.error('Error processing search results to slices:', error);
      return [];
    }
  }
}

