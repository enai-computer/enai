import { BaseService } from '../base/BaseService';
import { ConversationService } from './ConversationService';
import { OpenAIMessage } from '../../shared/types/agent.types';
import { NotebookService } from '../NotebookService';
import { ProfileService } from '../ProfileService';
import { SetIntentPayload } from '../../shared/types';
import { BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { createChatModel } from '../../utils/llm';
import { generateSystemPrompt, TOOL_DEFINITIONS } from './constants/llm.constants';
import { OPENAI_CONFIG } from '../../shared/constants/agent.constants';

interface LLMClientDeps {
  conversationService: ConversationService;
  notebookService: NotebookService;
  profileService: ProfileService;
}

export class LLMClient extends BaseService<LLMClientDeps> {
  constructor(deps: LLMClientDeps) {
    super('LLMClient', deps);
  }

  async prepareMessages(senderId: string, intentText: string, payload?: SetIntentPayload): Promise<OpenAIMessage[]> {
    let messages = this.deps.conversationService.getConversationHistory(senderId) || [];
    
    // If no in-memory history, try to load from database
    if (messages.length === 0) {
      const sessionId = this.deps.conversationService.getSessionId(senderId);
      if (sessionId) {
        messages = await this.deps.conversationService.loadMessagesFromDatabase(sessionId);
        if (messages.length > 0) {
          this.deps.conversationService.updateConversationHistory(senderId, messages);
        }
      }
    }
    
    // Always fetch current notebooks to ensure freshness (exclude NotebookCovers)
    const notebooks = await this.deps.notebookService.getAllRegularNotebooks();
    this.logInfo(`Found ${notebooks.length} regular notebooks for system prompt:`, notebooks.map(n => ({ id: n.id, title: n.title })));
    
    // Fetch user profile data
    const profileContext = await this.deps.profileService.getEnrichedProfileForAI('default_user');
    this.logInfo(`Fetched profile context for system prompt, length: ${profileContext.length}`);
    this.logDebug(`Profile context content:`, profileContext);
    
    // Generate system prompt with notebooks, profile, and current notebook context
    const currentSystemPromptContent = generateSystemPrompt(notebooks, profileContext, payload?.notebookId);
    
    if (messages.length === 0) {
      // New conversation: add the fresh system prompt
      this.logDebug(`New conversation for sender ${senderId}. Adding system prompt.`);
      messages.push({ 
        role: "system", 
        content: currentSystemPromptContent 
      });
    } else {
      // Existing conversation: find and update the system prompt
      const systemMessageIndex = messages.findIndex(msg => msg.role === "system");
      if (systemMessageIndex !== -1) {
        this.logDebug(`Existing conversation for sender ${senderId}. Updating system prompt.`);
        messages[systemMessageIndex].content = currentSystemPromptContent;
      } else {
        this.logWarn(`Existing conversation for sender ${senderId} but no system prompt found. Prepending.`);
        messages.unshift({ role: "system", content: currentSystemPromptContent });
      }
    }
    
    // Add user message
    messages.push({ role: "user", content: intentText });
    
    return messages;
  }

  async callOpenAI(messages: OpenAIMessage[]): Promise<OpenAIMessage | null> {
    try {
      // Log the raw messages being sent to OpenAI
      this.logDebug('Messages being sent to OpenAI:', 
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
      const baseMessages = this.convertToBaseMessages(messages);

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
      return this.convertFromBaseMessage(response);
    } catch (error) {
      this.logError(`LLM call error:`, error);
      throw error;
    }
  }

  async *streamOpenAI(
    messages: OpenAIMessage[], 
    onChunk?: (chunk: string) => void
  ): AsyncGenerator<string, OpenAIMessage | null, unknown> {
    try {
      // Convert OpenAIMessage format to BaseMessage format
      const baseMessages = this.convertToBaseMessages(messages);

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
      this.logError(`LLM streaming error:`, error);
      throw error;
    }
  }

  private convertToBaseMessages(messages: OpenAIMessage[]): BaseMessage[] {
    return messages.map(msg => {
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
  }

  private convertFromBaseMessage(response: any): OpenAIMessage {
    const toolCalls = (response as any).additional_kwargs?.tool_calls;
    
    return {
      role: "assistant",
      content: response.content as string || null,
      tool_calls: toolCalls
    };
  }
}