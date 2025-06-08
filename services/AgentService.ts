import { WebContents } from 'electron';
import { logger } from '../utils/logger';
import { performanceTracker } from '../utils/performanceTracker';
import { SetIntentPayload, IntentResultPayload, ChatMessageRole, HybridSearchResult, DisplaySlice } from '../shared/types';
import { NotebookService } from './NotebookService';
import { ExaService } from './ExaService';
import { HybridSearchService } from './HybridSearchService';
import { SearchResultFormatter } from './SearchResultFormatter';
import { ChatModel } from '../models/ChatModel';
import { SliceService } from './SliceService';
import { getProfileService } from './ProfileService';
import { BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { createChatModel } from '../utils/llm';
import { 
  NEWS_SOURCE_MAPPINGS, 
  OPENAI_CONFIG, 
  generateSystemPrompt, 
  TOOL_DEFINITIONS 
} from './AgentService.constants';
import { v4 as uuidv4 } from 'uuid';
import { 
  ON_INTENT_RESULT, 
  ON_INTENT_STREAM_START, 
  ON_INTENT_STREAM_CHUNK, 
  ON_INTENT_STREAM_END, 
  ON_INTENT_STREAM_ERROR 
} from '../shared/ipcChannels';

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

interface ToolCallResult {
  content: string;
  immediateReturn?: IntentResultPayload;
}

export class AgentService {
  private notebookService: NotebookService;
  private hybridSearchService: HybridSearchService;
  private exaService: ExaService;
  private formatter: SearchResultFormatter;
  private chatModel: ChatModel;
  private sliceService: SliceService;
  private conversationHistory = new Map<string, OpenAIMessage[]>();
  private sessionIdMap = new Map<string, string>(); // Maps senderId to sessionId
  private currentIntentSearchResults: HybridSearchResult[] = []; // Aggregate search results for current intent

  constructor(
    notebookService: NotebookService,
    hybridSearchServiceInstance: HybridSearchService,
    exaServiceInstance: ExaService,
    chatModel: ChatModel,
    sliceService: SliceService
  ) {
    this.notebookService = notebookService;
    this.hybridSearchService = hybridSearchServiceInstance;
    this.exaService = exaServiceInstance;
    this.chatModel = chatModel;
    this.sliceService = sliceService;
    this.formatter = new SearchResultFormatter();
    
    logger.info('[AgentService] Initialized');
  }

  async processComplexIntent(payload: SetIntentPayload, senderId?: string | number, correlationId?: string): Promise<IntentResultPayload | undefined> {
    const { intentText } = payload;
    const effectiveSenderId = String(senderId || '0');
    
    logger.info(`[AgentService] Processing complex intent: "${intentText}" from sender ${effectiveSenderId}`);
    
    // Track agent processing start
    if (correlationId) {
      performanceTracker.recordEvent(correlationId, 'AgentService', 'intent_processing_start', {
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
      const messages = await this.prepareMessages(effectiveSenderId, intentText, payload);
      
      // Save user message to database
      await this.saveMessage(sessionId, 'user', intentText);
      
      // Call OpenAI
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'calling_openai');
      }
      
      const assistantMessage = await this.callOpenAI(messages);
      
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
      
      // Save initial assistant message (with tool calls if any)
      await this.saveMessage(
        sessionId, 
        'assistant', 
        assistantMessage.content || '', 
        { toolCalls: assistantMessage.tool_calls }
      );
      
      // Handle tool calls if present
      if (assistantMessage.tool_calls?.length) {
        return await this.handleToolCalls(assistantMessage.tool_calls, messages, effectiveSenderId, sessionId, correlationId);
      }
      
      // Direct response
      if (assistantMessage.content) {
        return { type: 'chat_reply', message: assistantMessage.content };
      }
      
      return { type: 'error', message: 'No valid response from AI' };
      
    } catch (error) {
      logger.error('[AgentService] Error processing complex intent:', error);
      return { type: 'error', message: 'An error occurred while processing your request.' };
    }
  }

  async processComplexIntentWithStreaming(
    payload: SetIntentPayload, 
    senderId: string | number,
    sender: WebContents,
    correlationId?: string
  ): Promise<void> {
    const { intentText } = payload;
    const effectiveSenderId = String(senderId || '0');
    
    logger.info(`[AgentService] Processing complex intent with streaming: "${intentText}" from sender ${effectiveSenderId}`);
    
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
      
      // Save initial assistant message
      await this.saveMessage(
        sessionId, 
        'assistant', 
        assistantMessage.content || '', 
        { toolCalls: assistantMessage.tool_calls }
      );
      
      // Handle tool calls if present
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        if (correlationId) {
          performanceTracker.recordEvent(correlationId, 'AgentService', 'processing_tool_calls_streaming');
        }
        
        // Process tool calls
        const toolResults = await this.handleToolCallsForStreaming(
          assistantMessage.tool_calls, 
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
          // Send slices immediately
          if (correlationId) {
            performanceTracker.recordEvent(correlationId, 'AgentService', 'sending_slices');
          }
          
          const slices = await this.processSearchResultsToSlices(this.currentIntentSearchResults);
          logger.info(`[AgentService] Sending ${slices.length} slices immediately`);
          
          // Send slices via ON_INTENT_RESULT
          sender.send(ON_INTENT_RESULT, {
            type: 'chat_reply',
            message: '', // Empty message since we're streaming
            slices: slices.length > 0 ? slices : undefined
          });
          
          // Start streaming the summary
          const streamId = uuidv4();
          sender.send(ON_INTENT_STREAM_START, { streamId });
          
          if (correlationId) {
            performanceTracker.recordEvent(correlationId, 'AgentService', 'starting_summary_stream');
          }
          
          try {
            const stream = this.streamAISummary(messages, effectiveSenderId, correlationId);
            
            for await (const chunk of stream) {
              sender.send(ON_INTENT_STREAM_CHUNK, { streamId, chunk });
            }
            
            sender.send(ON_INTENT_STREAM_END, { streamId });
            
            if (correlationId) {
              performanceTracker.recordEvent(correlationId, 'AgentService', 'summary_stream_complete');
            }
            
          } catch (streamError) {
            logger.error('[AgentService] Streaming error:', streamError);
            sender.send(ON_INTENT_STREAM_ERROR, { 
              streamId, 
              error: streamError instanceof Error ? streamError.message : 'Streaming failed' 
            });
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
        // Direct response without tools - send as regular result
        if (assistantMessage.content) {
          sender.send(ON_INTENT_RESULT, { 
            type: 'chat_reply', 
            message: assistantMessage.content 
          });
        }
      }
      
    } catch (error) {
      logger.error('[AgentService] Error in streaming intent processing:', error);
      sender.send(ON_INTENT_STREAM_ERROR, { 
        error: error instanceof Error ? error.message : 'An error occurred while processing your request.' 
      });
    }
  }

  private async handleToolCallsForStreaming(
    toolCalls: any[], 
    messages: OpenAIMessage[], 
    senderId: string,
    sessionId: string,
    correlationId?: string
  ): Promise<ToolCallResult[]> {
    logger.info(`[AgentService] Processing ${toolCalls.length} tool call(s) for streaming`);
    
    // Process all tool calls in parallel
    const toolPromises = toolCalls.map(tc => this.processToolCall(tc));
    const toolResults = await Promise.all(toolPromises);
    
    // Add tool responses to messages and save to database
    for (let index = 0; index < toolCalls.length; index++) {
      const toolCall = toolCalls[index];
      const toolResult = toolResults[index];
      
      messages.push({
        role: "tool",
        content: toolResult.content,
        tool_call_id: toolCall.id
      });
      
      // Save tool response to database
      await this.saveMessage(
        sessionId,
        'tool' as ChatMessageRole,
        toolResult.content,
        { toolCallId: toolCall.id, toolName: toolCall.function.name }
      );
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
    const notebooks = await this.notebookService.getAllRegularNotebooks();
    logger.info(`[AgentService] Found ${notebooks.length} regular notebooks for system prompt:`, notebooks.map(n => ({ id: n.id, title: n.title })));
    
    // Fetch user profile data
    const profileService = getProfileService();
    const profileContext = await profileService.getEnrichedProfileForAI('default_user');
    logger.info(`[AgentService] Fetched profile context for system prompt, length: ${profileContext.length}`);
    logger.debug(`[AgentService] Profile context content:`, profileContext);
    
    // Generate system prompt with notebooks, profile, and current notebook context
    const currentSystemPromptContent = generateSystemPrompt(notebooks, profileContext, payload?.notebookId);
    
    if (messages.length === 0) {
      // New conversation: add the fresh system prompt
      logger.debug(`[AgentService] New conversation for sender ${senderId}. Adding system prompt.`);
      messages.push({ 
        role: "system", 
        content: currentSystemPromptContent 
      });
    } else {
      // Existing conversation: find and update the system prompt
      const systemMessageIndex = messages.findIndex(msg => msg.role === "system");
      if (systemMessageIndex !== -1) {
        logger.debug(`[AgentService] Existing conversation for sender ${senderId}. Updating system prompt.`);
        messages[systemMessageIndex].content = currentSystemPromptContent;
      } else {
        logger.warn(`[AgentService] Existing conversation for sender ${senderId} but no system prompt found. Prepending.`);
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
      logger.debug('[AgentService] Messages being sent to OpenAI:', 
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
      logger.error(`[AgentService] LLM call error:`, error);
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
      logger.error(`[AgentService] LLM streaming error:`, error);
      throw error;
    }
  }

  private async handleToolCalls(
    toolCalls: any[], 
    messages: OpenAIMessage[], 
    senderId: string,
    sessionId: string,
    correlationId?: string
  ): Promise<IntentResultPayload> {
    logger.info(`[AgentService] Processing ${toolCalls.length} tool call(s)`);
    
    if (correlationId) {
      performanceTracker.recordEvent(correlationId, 'AgentService', 'processing_tool_calls', {
        toolCount: toolCalls.length,
        tools: toolCalls.map(tc => tc.function.name)
      });
    }
    
    // Process all tool calls in parallel
    const toolPromises = toolCalls.map(tc => this.processToolCall(tc));
    const toolResults = await Promise.all(toolPromises);
    
    // Add tool responses to messages and save to database
    for (let index = 0; index < toolCalls.length; index++) {
      const toolCall = toolCalls[index];
      const toolResult = toolResults[index];
      
      messages.push({
        role: "tool",
        content: toolResult.content,
        tool_call_id: toolCall.id
      });
      
      // Save tool response to database
      await this.saveMessage(
        sessionId,
        'tool' as ChatMessageRole,
        toolResult.content,
        { toolCallId: toolCall.id, toolName: toolCall.function.name }
      );
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

  private async processToolCall(toolCall: any): Promise<ToolCallResult> {
    const { name, arguments: argsJson } = toolCall.function;
    
    try {
      const args = JSON.parse(argsJson);
      logger.info(`[AgentService] Processing tool: ${name}`, args);
      
      switch (name) {
        case 'search_knowledge_base':
          return await this.handleSearchKnowledgeBase(args);
        case 'open_notebook':
          return await this.handleOpenNotebook(args);
        case 'create_notebook':
          return await this.handleCreateNotebook(args);
        case 'delete_notebook':
          return await this.handleDeleteNotebook(args);
        case 'search_web':
          return await this.handleSearchWeb(args);
        case 'open_url':
          return await this.handleOpenUrl(args);
        case 'update_user_goals':
          return await this.handleUpdateUserGoals(args);
        default:
          logger.warn(`[AgentService] Unknown tool: ${name}`);
          return { content: `Unknown tool: ${name}` };
      }
    } catch (error) {
      logger.error(`[AgentService] Tool call error:`, error);
      return { content: `Error: ${error instanceof Error ? error.message : 'Tool execution failed'}` };
    }
  }

  private async handleSearchKnowledgeBase(args: any): Promise<ToolCallResult> {
    const { query, limit = 10, autoOpen = false } = args;
    if (!query) {
      return { content: "Error: Search query was unclear." };
    }
    
    logger.info(`[AgentService] Searching knowledge base: "${query}" (limit: ${limit}, autoOpen: ${autoOpen})`);
    
    try {
      // Use hybrid search but only search local vector database
      const results = await this.hybridSearchService.search(query, {
        numResults: limit,
        useExa: false  // Force local-only search
      });
      
      logger.debug(`[AgentService] Knowledge base search returned ${results.length} results`);
      
      // Aggregate search results for later processing into slices
      this.currentIntentSearchResults.push(...results);
      
      if (results.length === 0) {
        return { content: `No results found in your knowledge base for "${query}". Try saving more content or refining your search.` };
      }
      
      // If autoOpen is true and we have a URL, open the first result
      if (autoOpen && results[0].url) {
        logger.info(`[AgentService] Auto-opening first result: ${results[0].url}`);
        return {
          content: `Found "${results[0].title}" in your knowledge base. Opening it now...`,
          immediateReturn: {
            type: 'open_url',
            url: results[0].url,
            message: `Right on, I found "${results[0].title}" in your knowledge base and I'll open it for you.`
          }
        };
      }
      
      // Otherwise, format results for display
      const formatted = this.formatKnowledgeBaseResults(results, query);
      
      logger.debug(`[AgentService] Formatted knowledge base results (length: ${formatted.length}):`, 
        formatted.substring(0, 500) + '...');
      
      return { content: formatted };
    } catch (error) {
      logger.error(`[AgentService] Knowledge base search error:`, error);
      return { content: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }
  
  private formatKnowledgeBaseResults(results: HybridSearchResult[], query: string): string {
    const lines = [`## Found ${results.length} items in your knowledge base for "${query}"\n`];
    lines.push(`### Key Ideas:\n`);
    
    // Collect all propositions from all results
    const allPropositions: string[] = [];
    const sourcesByProposition = new Map<string, string[]>();
    
    results.forEach(result => {
      if (result.propositions && result.propositions.length > 0) {
        result.propositions.forEach(prop => {
          // Track which sources contributed each proposition
          if (!sourcesByProposition.has(prop)) {
            sourcesByProposition.set(prop, []);
          }
          sourcesByProposition.get(prop)!.push(result.title || 'Untitled');
          
          // Add to all propositions if not already present
          if (!allPropositions.includes(prop)) {
            allPropositions.push(prop);
          }
        });
      }
    });
    
    // Format propositions as bullet points
    if (allPropositions.length > 0) {
      allPropositions.forEach(prop => {
        lines.push(`• ${prop}`);
      });
    } else {
      // Fallback if no propositions are available
      lines.push(`*No key ideas extracted. Showing sources:*`);
      results.forEach((item, idx) => {
        lines.push(`• ${item.title || 'Untitled'} - ${item.url || 'No URL'}`);
      });
    }
    
    lines.push(`\n### Sources:`);
    // List unique sources
    const uniqueSources = new Map<string, string>();
    results.forEach(result => {
      const key = result.url || result.title || 'Unknown';
      if (!uniqueSources.has(key)) {
        uniqueSources.set(key, result.title || 'Untitled');
      }
    });
    
    uniqueSources.forEach((title, url) => {
      lines.push(`• ${title} (${url})`);
    });
    
    return lines.join('\n');
  }

  private async handleOpenNotebook(args: any): Promise<ToolCallResult> {
    const { notebook_name } = args;
    if (!notebook_name) {
      return { content: "Error: Notebook name was unclear." };
    }
    
    const notebooks = await this.notebookService.getAllRegularNotebooks();
    logger.info(`[AgentService] handleOpenNotebook: Looking for "${notebook_name}" among ${notebooks.length} regular notebooks:`, notebooks.map(n => n.title));
    
    const found = notebooks.find(nb => 
      nb.title.toLowerCase() === notebook_name.toLowerCase()
    );
    
    if (found) {
      logger.info(`[AgentService] Found notebook: "${found.title}" (ID: ${found.id})`);
      return {
        content: `Opened notebook: ${found.title}`,
        immediateReturn: {
          type: 'open_notebook',
          notebookId: found.id,
          title: found.title,
          message: `Right on, I'll open "${found.title}" for you.`
        }
      };
    }
    
    logger.warn(`[AgentService] Notebook "${notebook_name}" not found among available notebooks`);
    return { content: `Notebook "${notebook_name}" not found.` };
  }

  private async handleCreateNotebook(args: any): Promise<ToolCallResult> {
    const { title } = args;
    if (!title) {
      return { content: "Error: Notebook title was unclear." };
    }
    
    try {
      const notebook = await this.notebookService.createNotebook(title);
      return {
        content: `Created notebook: ${notebook.title}`,
        immediateReturn: {
          type: 'open_notebook',
          notebookId: notebook.id,
          title: notebook.title,
          message: `Right on, I've created "${notebook.title}" and I'll open it for you now.`
        }
      };
    } catch (error) {
      logger.error(`[AgentService] Error creating notebook:`, error);
      return { content: `Failed to create notebook: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  private async handleDeleteNotebook(args: any): Promise<ToolCallResult> {
    const { notebook_name } = args;
    if (!notebook_name) {
      return { content: "Error: Notebook name was unclear." };
    }
    
    const notebooks = await this.notebookService.getAllRegularNotebooks();
    const found = notebooks.find(nb => 
      nb.title.toLowerCase() === notebook_name.toLowerCase()
    );
    
    if (!found) {
      return { content: `Notebook "${notebook_name}" not found.` };
    }
    
    try {
      await this.notebookService.deleteNotebook(found.id);
      logger.info(`[AgentService] Deleted notebook "${notebook_name}" (ID: ${found.id})`);
      return {
        content: `Deleted notebook: ${found.title}`,
        immediateReturn: {
          type: 'chat_reply',
          message: `I've deleted "${found.title}" for you.`
        }
      };
    } catch (error) {
      logger.error(`[AgentService] Error deleting notebook:`, error);
      return { content: `Failed to delete notebook: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  private async handleSearchWeb(args: any): Promise<ToolCallResult> {
    const { query, searchType = 'general' } = args;
    if (!query) {
      return { content: "Error: Search query was unclear." };
    }
    
    logger.info(`[AgentService] Searching: "${query}" (type: ${searchType})`);
    
    try {
      let results: HybridSearchResult[];
      
      if (searchType === 'headlines' || searchType === 'news') {
        results = await this.searchNews(query);
        // Aggregate search results
        this.currentIntentSearchResults.push(...results);
        // Check if this was a multi-source search
        const sources = this.detectNewsSourcesInternal(query);
        const formatted = sources.length > 0
          ? this.formatter.formatMultiSourceNews(results, sources)
          : this.formatter.formatNewsResults(results);
        return { content: formatted };
      } else {
        results = await this.hybridSearchService.search(query, {
          numResults: 10
        });
        // Aggregate search results
        this.currentIntentSearchResults.push(...results);
      }
      
      const formatted = this.formatter.formatSearchResults(results);
      
      return { content: formatted };
    } catch (error) {
      logger.error(`[AgentService] Search error:`, error);
      return { content: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  private async handleOpenUrl(args: any): Promise<ToolCallResult> {
    const { url } = args;
    if (!url) {
      return { content: "Error: URL was unclear." };
    }
    
    const formattedUrl = url.startsWith('http') ? url : `https://${url}`;
    
    return {
      content: `Opened URL: ${formattedUrl}`,
      immediateReturn: {
        type: 'open_url',
        url: formattedUrl,
        message: `Right on, I'll open that for you.`
      }
    };
  }

  private async handleUpdateUserGoals(args: any): Promise<ToolCallResult> {
    const { action, goals, goalIds } = args;
    
    try {
      const profileService = getProfileService();
      
      if (action === 'add' && goals && goals.length > 0) {
        // Parse timeframe from natural language if needed
        const processedGoals = goals.map((goal: any) => {
          // Default to 'week' if no timeframe specified
          const timeframeType = goal.timeframeType || 'week';
          
          return {
            text: goal.text,
            timeframeType: timeframeType
          };
        });
        
        logger.info(`[AgentService] Adding ${processedGoals.length} time-bound goals`);
        await profileService.addTimeBoundGoals('default_user', processedGoals);
        
        const goalTexts = processedGoals.map((g: any) => `"${g.text}" (${g.timeframeType})`).join(', ');
        return { 
          content: `I'll keep this goal in mind: ${goalTexts}.` 
        };
      } else if (action === 'remove' && goalIds && goalIds.length > 0) {
        logger.info(`[AgentService] Removing ${goalIds.length} goals`);
        await profileService.removeTimeBoundGoals('default_user', goalIds);
        
        return { 
          content: `I've removed that from your profile.` 
        };
      } else {
        return { 
          content: "Error: Invalid action or missing required parameters for updating goals." 
        };
      }
    } catch (error) {
      logger.error(`[AgentService] Error updating user goals:`, error);
      return { 
        content: `Error updating goals: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
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
    return await this.hybridSearchService.searchNews(query, {
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
        const response = await this.exaService.search(query, {
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
        logger.error(`[AgentService] Failed to search ${source}:`, error);
        return [];
      }
    });
    
    const results = await Promise.all(searchPromises);
    return results.flat();
  }

  private async getAISummary(messages: OpenAIMessage[], senderId: string, correlationId?: string): Promise<IntentResultPayload> {
    const sessionId = this.sessionIdMap.get(senderId);
    if (!sessionId) {
      logger.error('[AgentService] No sessionId found for senderId:', senderId);
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
        logger.info(`[AgentService] Processing ${this.currentIntentSearchResults.length} accumulated search results into slices`);
        const slices = await this.processSearchResultsToSlices(this.currentIntentSearchResults);
        logger.info(`[AgentService] Got ${slices.length} slices to include in chat_reply`);
        
        return { 
          type: 'chat_reply', 
          message: summaryMessage.content,
          slices: slices.length > 0 ? slices : undefined
        };
      }
    } catch (error) {
      logger.error(`[AgentService] Summary error:`, error);
    }
    
    // Fallback
    const searchContents = messages
      .filter(m => m.role === 'tool' && m.content?.includes('Search Results'))
      .map(m => m.content)
      .join('\n\n');
    
    // Even in fallback, try to include slices
    logger.info(`[AgentService] Fallback path: Processing ${this.currentIntentSearchResults.length} accumulated search results`);
    const slices = await this.processSearchResultsToSlices(this.currentIntentSearchResults);
    logger.info(`[AgentService] Fallback path: Got ${slices.length} slices`);
    
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
      logger.error('[AgentService] No sessionId found for senderId:', senderId);
      throw new Error('Session not found');
    }
    
    try {
      if (correlationId) {
        performanceTracker.recordEvent(correlationId, 'AgentService', 'processing_slices');
      }
      
      // Process slices immediately and send them
      const slices = await this.processSearchResultsToSlices(this.currentIntentSearchResults);
      logger.info(`[AgentService] Got ${slices.length} slices to send immediately`);
      
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
      logger.error(`[AgentService] Stream summary error:`, error);
      throw error;
    }
  }

  private async updateMessage(messageId: string, content: string): Promise<void> {
    const model = this.chatModel;
    if (!model) {
      throw new Error('ChatModel not available');
    }
    
    // We need to add an update method to ChatModel or use the existing save mechanism
    // For now, we'll log this as a TODO
    logger.info(`[AgentService] TODO: Update message ${messageId} with final content`);
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
    logger.info(`[AgentService] Cleared conversation for sender ${senderId}`);
  }

  clearAllConversations(): void {
    this.conversationHistory.clear();
    this.sessionIdMap.clear();
    logger.info(`[AgentService] Cleared all conversations`);
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
      const notebookCover = await this.notebookService.getNotebookCover('default_user');
      
      try {
        // Create session and let ChatModel generate the ID
        const session = await this.chatModel.createSession(
          notebookCover.id, 
          undefined, // Let ChatModel generate the session ID
          `Conversation - ${new Date().toLocaleString()}`
        );
        sessionId = session.sessionId;
        this.sessionIdMap.set(senderId, sessionId);
        logger.info(`[AgentService] Created new session ${sessionId} for sender ${senderId} in NotebookCover ${notebookCover.id}`);
      } catch (error) {
        logger.error(`[AgentService] Failed to create session for sender ${senderId}:`, error);
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
    try {
      const message = await this.chatModel.addMessage({
        sessionId,
        role,
        content,
        metadata
      });
      logger.debug(`[AgentService] Saved ${role} message to session ${sessionId}`);
      return message.messageId;
    } catch (error) {
      logger.error(`[AgentService] Failed to save message to database:`, error);
      // Continue processing even if save fails
      return ''; // Return empty string on error
    }
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
      const dbMessages = await this.chatModel.getMessagesBySessionId(sessionId);
      
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
            logger.warn(`[AgentService] Failed to parse metadata for message ${msg.messageId}`);
          }
        }
        
        return baseMessage;
      });
      
      // Validate conversation history
      const validation = this.validateLoadedMessages(messages);
      if (!validation.valid) {
        logger.error(`[AgentService] Invalid conversation history loaded from database:`, validation.errors);
        // Use sanitized version to prevent API errors
        return validation.sanitizedMessages;
      }
      
      return messages;
    } catch (error) {
      logger.error(`[AgentService] Failed to load messages from database:`, error);
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
    logger.info(`[AgentService] processSearchResultsToSlices called with ${results.length} results`);
    
    // Log the full results for debugging
    logger.debug('[AgentService] Full search results:', results.map(r => ({
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
      
      logger.info(`[AgentService] Processing ${localResults.length} local and ${webResults.length} web results`);
      
      // Log filtered local results for debugging
      logger.debug('[AgentService] Filtered local results:', localResults.map(r => ({
        chunkId: r.chunkId,
        chunkIdType: typeof r.chunkId,
        objectId: r.objectId,
        title: r.title
      })));
      
      // Process local results
      if (localResults.length > 0) {
        // Collect all chunk IDs from local results
        const chunkIds = localResults
          .map(r => r.chunkId)
          .filter((id): id is number => id !== undefined && id !== null);
        
        logger.debug('[AgentService] Chunk IDs before filtering:', localResults.map(r => r.chunkId));
        logger.debug('[AgentService] Chunk IDs after filtering:', chunkIds);
        
        if (chunkIds.length > 0) {
          logger.info(`[AgentService] Fetching details for ${chunkIds.length} chunks: ${chunkIds.join(', ')}`);
          try {
            // Batch fetch slice details
            const sliceDetails = await this.sliceService.getDetailsForSlices(chunkIds);
            logger.info(`[AgentService] SliceService returned ${sliceDetails.length} slice details`);
            logger.debug('[AgentService] Slice details:', sliceDetails.map(d => ({
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
              logger.debug(`[AgentService] Adding local display slice:`, {
                id: displaySlice.id,
                title: displaySlice.title,
                sourceUri: displaySlice.sourceUri
              });
              displaySlices.push(displaySlice);
            }
          } catch (error) {
            logger.error('[AgentService] Error fetching slice details:', error);
            // Fallback: create DisplaySlice from HybridSearchResult
            logger.debug('[AgentService] Using fallback for local results');
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
              logger.debug(`[AgentService] Adding fallback slice:`, {
                id: fallbackSlice.id,
                title: fallbackSlice.title,
                chunkId: fallbackSlice.chunkId
              });
              displaySlices.push(fallbackSlice);
            }
          }
        } else {
          logger.warn('[AgentService] No valid chunk IDs found in local results');
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
        logger.debug(`[AgentService] Adding web display slice:`, {
          id: webSlice.id,
          title: webSlice.title,
          sourceUri: webSlice.sourceUri
        });
        displaySlices.push(webSlice);
      }
      
      logger.debug(`[AgentService] Before deduplication: ${displaySlices.length} slices`);
      
      // Improved deduplication logic
      const seen = new Map<string, DisplaySlice>();
      for (const slice of displaySlices) {
        // For local content, use a composite key of sourceUri + chunkId to avoid over-deduplication
        let key: string;
        if (slice.sourceType === 'local' && slice.chunkId !== undefined) {
          // Use composite key for local chunks
          key = `${slice.sourceUri || 'local'}-chunk-${slice.chunkId}`;
          logger.debug(`[AgentService] Local slice dedup key: "${key}" (sourceUri: "${slice.sourceUri}", chunkId: ${slice.chunkId})`);
        } else if (slice.sourceUri) {
          // For web content with URLs, use the URL
          key = slice.sourceUri;
          logger.debug(`[AgentService] Web slice dedup key: "${key}" (using sourceUri)`);
        } else {
          // Fallback to ID
          key = slice.id;
          logger.debug(`[AgentService] Fallback dedup key: "${key}" (using id, no sourceUri or chunkId)`);
        }
        
        if (!seen.has(key) || (seen.get(key)!.score || 0) < (slice.score || 0)) {
          seen.set(key, slice);
          logger.debug(`[AgentService] Keeping slice with key: "${key}"`);
        } else {
          logger.debug(`[AgentService] Removing duplicate with key: "${key}" (already have one with score ${seen.get(key)!.score || 0})`);
        }
      }
      
      const finalSlices = Array.from(seen.values());
      logger.info(`[AgentService] Returning ${finalSlices.length} display slices after deduplication`);
      logger.debug('[AgentService] Final unique slices:', finalSlices.map(s => ({
        id: s.id,
        title: s.title,
        sourceUri: s.sourceUri,
        sourceType: s.sourceType,
        chunkId: s.chunkId
      })));
      return finalSlices;
    } catch (error) {
      logger.error('[AgentService] Error processing search results to slices:', error);
      return [];
    }
  }
}