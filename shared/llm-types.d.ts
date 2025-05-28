import { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

export interface ILLMContext {
  userId?: string;
  taskType: 'chat' | 'summarization' | 'chunking_structure_extraction' | 'intent_analysis' | 'profile_synthesis' | string;
  priority: 'high_performance_large_context' | 'balanced_throughput';
}

export interface ILLMCompletionProviderCapabilities {
  supportsStreaming: boolean;
  maxInputTokens: number;
  supportsJSONOutputMode?: boolean;
  outputFormats: ('text' | 'json_object' | 'tool_calls')[];
}

export interface ILLMCompletionOptions {
  stopSequences?: string[];
  temperature?: number;
  maxTokens?: number;
  outputFormat?: 'text' | 'json_object';
  onToken?: (token: string) => void;
}

export interface ILLMCompletionProvider {
  readonly providerName: string;
  readonly capabilities: ILLMCompletionProviderCapabilities;
  
  complete(prompt: string, context: ILLMContext, options?: ILLMCompletionOptions): Promise<string>;
  
  chat(messages: BaseMessage[], context: ILLMContext, options?: ILLMCompletionOptions): Promise<BaseMessage>;
  
  streamComplete?(prompt: string, context: ILLMContext, options?: ILLMCompletionOptions): AsyncGenerator<string, void, unknown>;
  
  streamChat?(messages: BaseMessage[], context: ILLMContext, options?: ILLMCompletionOptions): AsyncGenerator<string, void, unknown>;
  
  getLangchainModel?(): any;
}

export interface IEmbeddingProviderCapabilities {
  dimensions: number;
  maxInputTokensPerDocument: number;
}

export interface IEmbeddingProvider {
  readonly providerName: string;
  readonly capabilities: IEmbeddingProviderCapabilities;
  
  embedDocuments(texts: string[], context?: ILLMContext): Promise<number[][]>;
  
  embedQuery(text: string, context?: ILLMContext): Promise<number[]>;
  
  getLangchainEmbeddings?(): any;
}

export interface IStructuredOutputOptions<T extends z.ZodTypeAny> extends ILLMCompletionOptions {
  schema: T;
  schemaName?: string;
  includeRaw?: boolean;
}

export interface ILLMProviderError extends Error {
  providerName: string;
  errorCode?: string;
  isRetryable?: boolean;
  originalError?: Error;
}