import { BaseMessage } from "@langchain/core/messages";
import { 
  ILLMCompletionProvider, 
  IEmbeddingProvider,
  ILLMContext,
  ILLMCompletionOptions,
  ILLMProviderError
} from "../shared/llm-types";
import { logger } from "../utils/logger";

export interface LLMServiceConfig {
  completionProviders: Map<string, ILLMCompletionProvider>;
  embeddingProviders: Map<string, IEmbeddingProvider>;
  defaultCompletionProvider: string;
  defaultEmbeddingProvider: string;
}

export class LLMService {
  private completionProviders: Map<string, ILLMCompletionProvider>;
  private embeddingProviders: Map<string, IEmbeddingProvider>;
  private defaultCompletionProvider: string;
  private defaultEmbeddingProvider: string;
  
  constructor(config: LLMServiceConfig) {
    this.completionProviders = config.completionProviders;
    this.embeddingProviders = config.embeddingProviders;
    this.defaultCompletionProvider = config.defaultCompletionProvider;
    this.defaultEmbeddingProvider = config.defaultEmbeddingProvider;
    
    logger.info("[LLMService] Initialized with providers:", {
      completionProviders: Array.from(this.completionProviders.keys()),
      embeddingProviders: Array.from(this.embeddingProviders.keys()),
      defaultCompletionProvider: this.defaultCompletionProvider,
      defaultEmbeddingProvider: this.defaultEmbeddingProvider
    });
  }
  
  private _selectCompletionProvider(context: ILLMContext): ILLMCompletionProvider {
    logger.debug("[LLMService] Selecting completion provider", { context });
    
    const highPerformanceTasks = [
      'chunking_structure_extraction',
      'profile_synthesis',
      'intent_analysis'
    ];
    
    const useHighPerformance = 
      highPerformanceTasks.includes(context.taskType) || 
      context.priority === 'high_performance_large_context';
    
    const providerName = useHighPerformance ? 'OpenAI-GPT-4-Turbo' : 'OpenAI-GPT-4o-Mini';
    
    const provider = this.completionProviders.get(providerName);
    if (!provider) {
      logger.warn(`[LLMService] Provider ${providerName} not found, falling back to default`);
      const defaultProvider = this.completionProviders.get(this.defaultCompletionProvider);
      if (!defaultProvider) {
        throw new Error(`Default completion provider ${this.defaultCompletionProvider} not found`);
      }
      return defaultProvider;
    }
    
    logger.debug(`[LLMService] Selected provider: ${provider.providerName}`);
    return provider;
  }
  
  private _selectEmbeddingProvider(context?: ILLMContext): IEmbeddingProvider {
    logger.debug("[LLMService] Selecting embedding provider", { context });
    
    const provider = this.embeddingProviders.get(this.defaultEmbeddingProvider);
    if (!provider) {
      throw new Error(`Default embedding provider ${this.defaultEmbeddingProvider} not found`);
    }
    
    logger.debug(`[LLMService] Selected provider: ${provider.providerName}`);
    return provider;
  }
  
  async generateCompletion(prompt: string, context: ILLMContext, options?: ILLMCompletionOptions): Promise<string> {
    logger.debug("[LLMService] generateCompletion called", { 
      context, 
      promptLength: prompt.length,
      options 
    });
    
    const provider = this._selectCompletionProvider(context);
    
    try {
      return await provider.complete(prompt, context, options);
    } catch (error) {
      logger.error("[LLMService] generateCompletion error:", error);
      
      const providerError: ILLMProviderError = {
        name: 'LLMProviderError',
        message: `Error from ${provider.providerName}: ${error instanceof Error ? error.message : String(error)}`,
        providerName: provider.providerName,
        originalError: error instanceof Error ? error : undefined,
        isRetryable: this._isRetryableError(error)
      };
      
      throw providerError;
    }
  }
  
  async generateChatResponse(messages: BaseMessage[], context: ILLMContext, options?: ILLMCompletionOptions): Promise<BaseMessage> {
    logger.debug("[LLMService] generateChatResponse called", { 
      context, 
      messageCount: messages.length,
      options 
    });
    
    const provider = this._selectCompletionProvider(context);
    
    try {
      return await provider.chat(messages, context, options);
    } catch (error) {
      logger.error("[LLMService] generateChatResponse error:", error);
      
      const providerError: ILLMProviderError = {
        name: 'LLMProviderError',
        message: `Error from ${provider.providerName}: ${error instanceof Error ? error.message : String(error)}`,
        providerName: provider.providerName,
        originalError: error instanceof Error ? error : undefined,
        isRetryable: this._isRetryableError(error)
      };
      
      throw providerError;
    }
  }
  
  async *streamCompletion(prompt: string, context: ILLMContext, options?: ILLMCompletionOptions): AsyncGenerator<string, void, unknown> {
    logger.debug("[LLMService] streamCompletion called", { 
      context, 
      promptLength: prompt.length,
      options 
    });
    
    const provider = this._selectCompletionProvider(context);
    
    if (!provider.streamComplete) {
      throw new Error(`Provider ${provider.providerName} does not support streaming`);
    }
    
    try {
      yield* provider.streamComplete(prompt, context, options);
    } catch (error) {
      logger.error("[LLMService] streamCompletion error:", error);
      
      const providerError: ILLMProviderError = {
        name: 'LLMProviderError',
        message: `Error from ${provider.providerName}: ${error instanceof Error ? error.message : String(error)}`,
        providerName: provider.providerName,
        originalError: error instanceof Error ? error : undefined,
        isRetryable: this._isRetryableError(error)
      };
      
      throw providerError;
    }
  }
  
  async *streamChatResponse(messages: BaseMessage[], context: ILLMContext, options?: ILLMCompletionOptions): AsyncGenerator<string, void, unknown> {
    logger.debug("[LLMService] streamChatResponse called", { 
      context, 
      messageCount: messages.length,
      options 
    });
    
    const provider = this._selectCompletionProvider(context);
    
    if (!provider.streamChat) {
      throw new Error(`Provider ${provider.providerName} does not support streaming`);
    }
    
    try {
      yield* provider.streamChat(messages, context, options);
    } catch (error) {
      logger.error("[LLMService] streamChatResponse error:", error);
      
      const providerError: ILLMProviderError = {
        name: 'LLMProviderError',
        message: `Error from ${provider.providerName}: ${error instanceof Error ? error.message : String(error)}`,
        providerName: provider.providerName,
        originalError: error instanceof Error ? error : undefined,
        isRetryable: this._isRetryableError(error)
      };
      
      throw providerError;
    }
  }
  
  async embedDocuments(texts: string[], context?: ILLMContext): Promise<number[][]> {
    logger.debug("[LLMService] embedDocuments called", { 
      textCount: texts.length,
      context 
    });
    
    const provider = this._selectEmbeddingProvider(context);
    
    try {
      return await provider.embedDocuments(texts, context);
    } catch (error) {
      logger.error("[LLMService] embedDocuments error:", error);
      
      const providerError: ILLMProviderError = {
        name: 'LLMProviderError',
        message: `Error from ${provider.providerName}: ${error instanceof Error ? error.message : String(error)}`,
        providerName: provider.providerName,
        originalError: error instanceof Error ? error : undefined,
        isRetryable: this._isRetryableError(error)
      };
      
      throw providerError;
    }
  }
  
  async embedQuery(text: string, context?: ILLMContext): Promise<number[]> {
    logger.debug("[LLMService] embedQuery called", { 
      textLength: text.length,
      context 
    });
    
    const provider = this._selectEmbeddingProvider(context);
    
    try {
      return await provider.embedQuery(text, context);
    } catch (error) {
      logger.error("[LLMService] embedQuery error:", error);
      
      const providerError: ILLMProviderError = {
        name: 'LLMProviderError',
        message: `Error from ${provider.providerName}: ${error instanceof Error ? error.message : String(error)}`,
        providerName: provider.providerName,
        originalError: error instanceof Error ? error : undefined,
        isRetryable: this._isRetryableError(error)
      };
      
      throw providerError;
    }
  }
  
  getCompletionProvider(context: ILLMContext): ILLMCompletionProvider {
    return this._selectCompletionProvider(context);
  }
  
  getEmbeddingProvider(context?: ILLMContext): IEmbeddingProvider {
    return this._selectEmbeddingProvider(context);
  }
  
  getLangchainModel(context: ILLMContext): any {
    const provider = this._selectCompletionProvider(context);
    
    if (!provider.getLangchainModel) {
      throw new Error(`Provider ${provider.providerName} does not expose a LangChain model`);
    }
    
    return provider.getLangchainModel();
  }
  
  getLangchainEmbeddings(context?: ILLMContext): any {
    const provider = this._selectEmbeddingProvider(context);
    
    if (!provider.getLangchainEmbeddings) {
      throw new Error(`Provider ${provider.providerName} does not expose LangChain embeddings`);
    }
    
    return provider.getLangchainEmbeddings();
  }
  
  private _isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('rate limit') || 
             message.includes('timeout') || 
             message.includes('network') ||
             message.includes('service unavailable');
    }
    return false;
  }
}