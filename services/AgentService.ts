import { logger } from '../utils/logger';
import { SetIntentPayload, IntentResultPayload, ChatMessageRole } from '../shared/types';
import { NotebookService } from './NotebookService';
import { ExaService } from './ExaService';
import { HybridSearchService, HybridSearchResult } from './HybridSearchService';
import { SearchResultFormatter } from './SearchResultFormatter';
import { LLMService } from './LLMService';
import { ChatModel } from '../models/ChatModel';
import { BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { 
  NEWS_SOURCE_MAPPINGS, 
  OPENAI_CONFIG, 
  generateSystemPrompt, 
  TOOL_DEFINITIONS 
} from './AgentService.constants';
import { v4 as uuidv4 } from 'uuid';

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
  private llmService: LLMService;
  private chatModel: ChatModel;
  private conversationHistory = new Map<string, OpenAIMessage[]>();
  private sessionIdMap = new Map<string, string>(); // Maps senderId to sessionId

  constructor(
    notebookService: NotebookService,
    llmService: LLMService,
    hybridSearchServiceInstance: HybridSearchService,
    exaServiceInstance: ExaService,
    chatModel: ChatModel
  ) {
    this.notebookService = notebookService;
    this.llmService = llmService;
    this.hybridSearchService = hybridSearchServiceInstance;
    this.exaService = exaServiceInstance;
    this.chatModel = chatModel;
    this.formatter = new SearchResultFormatter();
    
    logger.info('[AgentService] Initialized');
  }

  async processComplexIntent(payload: SetIntentPayload, senderId?: string | number): Promise<IntentResultPayload | undefined> {
    const { intentText } = payload;
    const effectiveSenderId = String(senderId || '0');
    
    logger.info(`[AgentService] Processing complex intent: "${intentText}" from sender ${effectiveSenderId}`);
    
    try {
      // Ensure we have a session for this sender
      const sessionId = await this.ensureSession(effectiveSenderId);
      
      // Get messages and ensure system prompt
      const messages = await this.prepareMessages(effectiveSenderId, intentText);
      
      // Save user message to database
      await this.saveMessage(sessionId, 'user', intentText);
      
      // Call OpenAI
      const assistantMessage = await this.callOpenAI(messages);
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
        return await this.handleToolCalls(assistantMessage.tool_calls, messages, effectiveSenderId, sessionId);
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

  private async prepareMessages(senderId: string, intentText: string): Promise<OpenAIMessage[]> {
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
    const currentSystemPromptContent = generateSystemPrompt(notebooks);
    
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

      // Get the LangChain model from LLMService for tool calling support
      const llm = this.llmService.getLangchainModel({
        userId: 'system',
        taskType: 'intent_analysis',
        priority: 'high_performance_large_context'
      });

      // Bind tools to the model
      const llmWithTools = llm.bind({
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        temperature: OPENAI_CONFIG.temperature,
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

  private async handleToolCalls(
    toolCalls: any[], 
    messages: OpenAIMessage[], 
    senderId: string,
    sessionId: string
  ): Promise<IntentResultPayload> {
    logger.info(`[AgentService] Processing ${toolCalls.length} tool call(s)`);
    
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
      return await this.getAISummary(messages, senderId);
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
      return await this.getAISummary(messages, senderId);
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
      
      return { content: formatted };
    } catch (error) {
      logger.error(`[AgentService] Knowledge base search error:`, error);
      return { content: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }
  
  private formatKnowledgeBaseResults(results: HybridSearchResult[], query: string): string {
    const lines = [`## Your Knowledge Base Results for "${query}"\n`];
    
    // Group by source/topic if possible
    const byUrl = new Map<string, HybridSearchResult[]>();
    
    results.forEach(result => {
      const key = result.url || 'No URL';
      if (!byUrl.has(key)) {
        byUrl.set(key, []);
      }
      byUrl.get(key)!.push(result);
    });
    
    let index = 1;
    byUrl.forEach((items, url) => {
      if (url !== 'No URL') {
        lines.push(`\n### From: ${url}`);
      }
      
      items.forEach(item => {
        lines.push(`\n**${index}.** ${item.title || 'Untitled'}`);
        if (item.content) {
          // Show more context for knowledge base results
          const preview = item.content.substring(0, 300).trim();
          lines.push(`${preview}${item.content.length > 300 ? '...' : ''}`);
        }
        if (item.publishedDate) {
          lines.push(`*Saved: ${new Date(item.publishedDate).toLocaleDateString()}*`);
        }
        index++;
      });
    });
    
    lines.push(`\n---\n*Found ${results.length} items in your knowledge base*`);
    
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

  private async getAISummary(messages: OpenAIMessage[], senderId: string): Promise<IntentResultPayload> {
    const sessionId = this.sessionIdMap.get(senderId);
    if (!sessionId) {
      logger.error('[AgentService] No sessionId found for senderId:', senderId);
      return { type: 'error', message: 'Session not found' };
    }
    
    try {
      const summaryMessage = await this.callOpenAI(messages);
      if (summaryMessage?.content) {
        messages.push(summaryMessage);
        this.updateConversationHistory(senderId, messages);
        
        // Save summary message to database
        await this.saveMessage(sessionId, 'assistant', summaryMessage.content);
        
        return { type: 'chat_reply', message: summaryMessage.content };
      }
    } catch (error) {
      logger.error(`[AgentService] Summary error:`, error);
    }
    
    // Fallback
    const searchContents = messages
      .filter(m => m.role === 'tool' && m.content?.includes('Search Results'))
      .map(m => m.content)
      .join('\n\n');
    
    return { 
      type: 'chat_reply', 
      message: `I found search results but couldn't summarize them. Here's what I found:\n\n${searchContents}` 
    };
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
  ): Promise<void> {
    try {
      await this.chatModel.addMessage({
        sessionId,
        role,
        content,
        metadata
      });
      logger.debug(`[AgentService] Saved ${role} message to session ${sessionId}`);
    } catch (error) {
      logger.error(`[AgentService] Failed to save message to database:`, error);
      // Continue processing even if save fails
    }
  }
  
  private async loadMessagesFromDatabase(sessionId: string): Promise<OpenAIMessage[]> {
    try {
      const dbMessages = await this.chatModel.getMessagesBySessionId(sessionId);
      
      return dbMessages.map(msg => {
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
}