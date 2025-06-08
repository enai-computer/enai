import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";

/**
 * Minimal helper for creating ChatOpenAI instances with API key management
 */
export function createChatModel(modelName: string, options: any = {}) {
  const config: any = {
    modelName,
    openAIApiKey: process.env.OPENAI_API_KEY
  };
  
  if (options.temperature !== undefined) config.temperature = options.temperature;
  if (options.streaming !== undefined) config.streaming = options.streaming;
  if (options.max_tokens !== undefined) config.maxTokens = options.max_tokens;
  if (options.response_format !== undefined) config.modelKwargs = { response_format: options.response_format };
  
  return new ChatOpenAI(config);
}

/**
 * Minimal helper for creating OpenAIEmbeddings instances with API key management
 */
export function createEmbeddingModel(modelName: string = "text-embedding-3-small", options: any = {}) {
  return new OpenAIEmbeddings({
    model: modelName,
    openAIApiKey: process.env.OPENAI_API_KEY,
    ...options
  });
}