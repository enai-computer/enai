import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { BaseService } from '../base/BaseService';
import { ChatModel } from '../../models/ChatModel';
import { NotebookService } from '../NotebookService';
import { ChatMessageRole } from '../../shared/types';
import { OpenAIMessage } from '../../shared/types/agent.types';
import { OPENAI_CONFIG } from '../../shared/constants/agent.constants';

interface ConversationServiceDeps {
  db: Database.Database;
  chatModel: ChatModel;
  notebookService: NotebookService;
}

export class ConversationService extends BaseService<ConversationServiceDeps> {
  private conversationHistory = new Map<string, OpenAIMessage[]>();
  private sessionIdMap = new Map<string, string>(); // Maps senderId to sessionId

  constructor(deps: ConversationServiceDeps) {
    super('ConversationService', deps);
  }

  async initialize(): Promise<void> {
    this.logInfo('ConversationService initialized');
  }

  async cleanup(): Promise<void> {
    this.logInfo('Cleaning up ConversationService - clearing conversation history');
    
    const conversationCount = this.conversationHistory.size;
    this.conversationHistory.clear();
    this.sessionIdMap.clear();
    
    this.logInfo(`ConversationService cleanup complete - cleared ${conversationCount} conversations`);
  }

  async ensureSession(senderId: string): Promise<string> {
    return this.execute('ensureSession', async () => {
      // Check if we already have a session ID for this sender
      let sessionId = this.sessionIdMap.get(senderId);
      
      if (!sessionId) {
        // Get or create the NotebookCover for the user
        // For now, we're using default_user for all homepage conversations
        const notebookCover = await this.deps.notebookService.getNotebookCover('default_user');
        
        // Create session and let ChatModel generate the ID
        const session = await this.deps.chatModel.createSession(
          notebookCover.id, 
          undefined, // Let ChatModel generate the session ID
          `Conversation - ${new Date().toLocaleString()}`
        );
        sessionId = session.sessionId;
        this.sessionIdMap.set(senderId, sessionId);
        this.logInfo(`Created new session ${sessionId} for sender ${senderId} in NotebookCover ${notebookCover.id}`);
      }
      
      return sessionId;
    });
  }

  async saveMessage(
    sessionId: string, 
    role: ChatMessageRole, 
    content: string, 
    metadata?: any
  ): Promise<string> {
    return this.execute('saveMessage', async () => {
      const message = await this.deps.chatModel.addMessage({
        sessionId,
        role,
        content,
        metadata
      });
      this.logDebug(`Saved ${role} message to session ${sessionId}`);
      return message.messageId;
    });
  }

  async updateMessage(messageId: string, content: string): Promise<void> {
    return this.execute('updateMessage', async () => {
      await this.deps.chatModel.updateMessageContent(messageId, content);
      this.logDebug(`Updated message ${messageId} with content length: ${content.length}`);
    });
  }

  /**
   * Save multiple messages in a single transaction.
   * Used for atomic saves of related messages (e.g., tool calls and responses).
   */
  async saveMessagesInTransaction(
    sessionId: string,
    messages: Array<{
      role: ChatMessageRole;
      content: string;
      metadata?: any;
    }>
  ): Promise<string[]> {
    return this.execute('saveMessagesInTransaction', async () => {
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
      
      this.logDebug(`Saved ${messages.length} messages in transaction for session ${sessionId}`);
      return messageIds;
    });
  }

  async loadMessagesFromDatabase(sessionId: string): Promise<OpenAIMessage[]> {
    return this.execute('loadMessagesFromDatabase', async () => {
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
            this.logWarn(`Failed to parse metadata for message ${msg.messageId}`);
          }
        }
        
        return baseMessage;
      });
      
      // Validate conversation history
      const validation = this.validateLoadedMessages(messages);
      if (!validation.valid) {
        this.logError(`Invalid conversation history loaded from database:`, validation.errors);
        // Use sanitized version to prevent API errors
        return validation.sanitizedMessages;
      }
      
      return messages;
    });
  }

  validateLoadedMessages(messages: OpenAIMessage[]): {
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

  filterValidMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
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

  updateConversationHistory(senderId: string, messages: OpenAIMessage[]): void {
    // Trim if too long
    if (messages.length > OPENAI_CONFIG.maxHistoryLength) {
      messages = [messages[0], ...messages.slice(-OPENAI_CONFIG.maxHistoryLength + 1)];
    }
    
    this.conversationHistory.set(senderId, this.filterValidMessages(messages));
  }

  clearConversation(senderId: string): void {
    this.conversationHistory.delete(senderId);
    this.sessionIdMap.delete(senderId);
    this.logInfo(`Cleared conversation for sender ${senderId}`);
  }

  clearAllConversations(): void {
    this.conversationHistory.clear();
    this.sessionIdMap.clear();
    this.logInfo(`Cleared all conversations`);
  }
  
  getActiveConversationCount(): number {
    return this.conversationHistory.size;
  }

  // Getters for accessing conversation data
  getConversationHistory(senderId: string): OpenAIMessage[] | undefined {
    return this.conversationHistory.get(senderId);
  }

  getSessionId(senderId: string): string | undefined {
    return this.sessionIdMap.get(senderId);
  }
}