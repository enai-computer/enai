import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { 
  ILLMCompletionProvider, 
  ILLMCompletionProviderCapabilities,
  IEmbeddingProvider,
  IEmbeddingProviderCapabilities,
  ILLMContext, 
  ILLMCompletionOptions 
} from "../../shared/llm-types";
import { logger } from "../../utils/logger";

abstract class BaseOpenAICompletionProvider implements ILLMCompletionProvider {
  protected llm: ChatOpenAI;
  
  abstract readonly providerName: string;
  abstract readonly capabilities: ILLMCompletionProviderCapabilities;
  
  constructor(modelName: string, apiKey?: string) {
    this.llm = new ChatOpenAI({
      modelName,
      openAIApiKey: apiKey || process.env.OPENAI_API_KEY,
      temperature: 0.7,
    });
    logger.info(`[${this.constructor.name}] Initialized ${modelName}`);
  }
  
  async complete(prompt: string, context: ILLMContext, options?: ILLMCompletionOptions): Promise<string> {
    logger.debug(`[${this.providerName}] complete called`, { 
      context, 
      promptLength: prompt.length,
      options 
    });
    
    try {
      const messages = [new HumanMessage(prompt)];
      
      const llmConfig: any = {
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens,
        stop: options?.stopSequences,
      };
      
      if (options?.outputFormat === 'json_object' && this.capabilities.supportsJSONOutputMode) {
        llmConfig.modelKwargs = { response_format: { type: "json_object" } };
      }
      
      const configuredLLM = this.llm.bind(llmConfig);
      const response = await configuredLLM.invoke(messages);
      
      return response.content.toString();
    } catch (error) {
      logger.error(`[${this.providerName}] complete error:`, error);
      throw error;
    }
  }
  
  async chat(messages: BaseMessage[], context: ILLMContext, options?: ILLMCompletionOptions): Promise<BaseMessage> {
    logger.debug(`[${this.providerName}] chat called`, { 
      context, 
      messageCount: messages.length,
      options 
    });
    
    try {
      const llmConfig: any = {
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens,
        stop: options?.stopSequences,
      };
      
      if (options?.outputFormat === 'json_object' && this.capabilities.supportsJSONOutputMode) {
        llmConfig.modelKwargs = { response_format: { type: "json_object" } };
      }
      
      const configuredLLM = this.llm.bind(llmConfig);
      const response = await configuredLLM.invoke(messages);
      
      return response;
    } catch (error) {
      logger.error(`[${this.providerName}] chat error:`, error);
      throw error;
    }
  }
  
  async *streamComplete(prompt: string, context: ILLMContext, options?: ILLMCompletionOptions): AsyncGenerator<string, void, unknown> {
    logger.debug(`[${this.providerName}] streamComplete called`, { 
      context, 
      promptLength: prompt.length,
      options 
    });
    
    try {
      const messages = [new HumanMessage(prompt)];
      
      const llmConfig: any = {
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens,
        stop: options?.stopSequences,
      };
      
      if (options?.outputFormat === 'json_object' && this.capabilities.supportsJSONOutputMode) {
        llmConfig.modelKwargs = { response_format: { type: "json_object" } };
      }
      
      const configuredLLM = this.llm.bind(llmConfig);
      const stream = await configuredLLM.stream(messages);
      
      for await (const chunk of stream) {
        const content = chunk.content.toString();
        if (content) {
          if (options?.onToken) {
            options.onToken(content);
          }
          yield content;
        }
      }
    } catch (error) {
      logger.error(`[${this.providerName}] streamComplete error:`, error);
      throw error;
    }
  }
  
  async *streamChat(messages: BaseMessage[], context: ILLMContext, options?: ILLMCompletionOptions): AsyncGenerator<string, void, unknown> {
    logger.debug(`[${this.providerName}] streamChat called`, { 
      context, 
      messageCount: messages.length,
      options 
    });
    
    try {
      const llmConfig: any = {
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens,
        stop: options?.stopSequences,
      };
      
      if (options?.outputFormat === 'json_object' && this.capabilities.supportsJSONOutputMode) {
        llmConfig.modelKwargs = { response_format: { type: "json_object" } };
      }
      
      const configuredLLM = this.llm.bind(llmConfig);
      const stream = await configuredLLM.stream(messages);
      
      for await (const chunk of stream) {
        const content = chunk.content.toString();
        if (content) {
          if (options?.onToken) {
            options.onToken(content);
          }
          yield content;
        }
      }
    } catch (error) {
      logger.error(`[${this.providerName}] streamChat error:`, error);
      throw error;
    }
  }
  
  getLangchainModel(): ChatOpenAI {
    return this.llm;
  }
}

export class OpenAIGPT4oMiniProvider extends BaseOpenAICompletionProvider {
  readonly providerName = "OpenAI-GPT-4o-Mini";
  
  readonly capabilities: ILLMCompletionProviderCapabilities = {
    supportsStreaming: true,
    maxInputTokens: 128000,
    supportsJSONOutputMode: true,
    outputFormats: ['text', 'json_object', 'tool_calls']
  };
  
  constructor(apiKey?: string) {
    super("gpt-4o-mini", apiKey);
  }
}

export class OpenAIGPT4TurboProvider extends BaseOpenAICompletionProvider {
  readonly providerName = "OpenAI-GPT-4-Turbo";
  
  readonly capabilities: ILLMCompletionProviderCapabilities = {
    supportsStreaming: true,
    maxInputTokens: 128000,
    supportsJSONOutputMode: true,
    outputFormats: ['text', 'json_object', 'tool_calls']
  };
  
  constructor(apiKey?: string) {
    super("gpt-4-turbo", apiKey);
  }
}

export class OpenAIGPT41NanoProvider extends BaseOpenAICompletionProvider {
  readonly providerName = "OpenAI-GPT-4.1-Nano";
  
  readonly capabilities: ILLMCompletionProviderCapabilities = {
    supportsStreaming: true,
    maxInputTokens: 128000,
    supportsJSONOutputMode: true,
    outputFormats: ['text', 'json_object', 'tool_calls']
  };
  
  constructor(apiKey?: string) {
    super("gpt-4.1-nano", apiKey);
  }
}

export class OpenAITextEmbedding3SmallProvider implements IEmbeddingProvider {
  private embeddings: OpenAIEmbeddings;
  
  readonly providerName = "OpenAI-text-embedding-3-small";
  
  readonly capabilities: IEmbeddingProviderCapabilities = {
    dimensions: 1536,
    maxInputTokensPerDocument: 8191
  };
  
  constructor(apiKey?: string) {
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: apiKey || process.env.OPENAI_API_KEY,
      modelName: "text-embedding-3-small",
    });
    logger.info(`[OpenAITextEmbedding3SmallProvider] Initialized`);
  }
  
  async embedDocuments(texts: string[], context?: ILLMContext): Promise<number[][]> {
    logger.debug(`[${this.providerName}] embedDocuments called`, { 
      textCount: texts.length,
      context 
    });
    
    try {
      return await this.embeddings.embedDocuments(texts);
    } catch (error) {
      logger.error(`[${this.providerName}] embedDocuments error:`, error);
      throw error;
    }
  }
  
  async embedQuery(text: string, context?: ILLMContext): Promise<number[]> {
    logger.debug(`[${this.providerName}] embedQuery called`, { 
      textLength: text.length,
      context 
    });
    
    try {
      return await this.embeddings.embedQuery(text);
    } catch (error) {
      logger.error(`[${this.providerName}] embedQuery error:`, error);
      throw error;
    }
  }
  
  getLangchainEmbeddings(): OpenAIEmbeddings {
    return this.embeddings;
  }
}