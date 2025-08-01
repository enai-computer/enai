import { WebContents } from 'electron';
import { BaseService } from './base/BaseService';
import { performanceTracker } from '../utils/performanceTracker';
import { SetIntentPayload, IntentResultPayload, DisplaySlice } from '../shared/types';
import { ToolCallResult } from './agents/tools';
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
import { ToolService } from './agents/ToolService';

interface AgentServiceDeps {
  // Core orchestration dependencies
  conversationService: ConversationService;
  llmClient: LLMClient;
  searchService: SearchService;
  toolService: ToolService;
  
  // Stream management
  streamManager: StreamManager;
  
  // Database for potential future use
  db: Database.Database;
}

export class AgentService extends BaseService<AgentServiceDeps> {
  constructor(deps: AgentServiceDeps) {
    super('AgentService', deps);
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
        const result = await this.deps.toolService.handleToolCallsWithAtomicSave(
          assistantMessage,
          messages,
          effectiveSenderId,
          sessionId,
          correlationId
        );

        // Check for immediate returns
        const immediateReturn = result.toolResults.find((r: ToolCallResult) => r.immediateReturn);
        if (immediateReturn?.immediateReturn) {
          return immediateReturn.immediateReturn;
        }

        // If we have search results or meaningful content, get AI summary
        if (result.hasSearchResults || result.hasMeaningfulContent) {
          return await this.getAISummary(messages, effectiveSenderId, correlationId);
        }

        return { type: 'chat_reply', message: 'Request processed.' };
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
        const toolResults = await this.deps.toolService.handleToolCallsForStreamingWithAtomicSave(
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

