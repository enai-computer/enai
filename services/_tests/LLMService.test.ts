import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMService } from '../LLMService';
import { 
  ILLMCompletionProvider, 
  ILLMCompletionProviderCapabilities,
  IEmbeddingProvider,
  IEmbeddingProviderCapabilities,
  ILLMContext
} from '../../shared/llm-types';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';

// Mock providers
class MockCompletionProvider implements ILLMCompletionProvider {
  constructor(public providerName: string, public capabilities: ILLMCompletionProviderCapabilities) {}
  
  async complete(prompt: string, context: ILLMContext, options?: any): Promise<string> {
    return `${this.providerName} response to: ${prompt}`;
  }
  
  async chat(messages: BaseMessage[], context: ILLMContext, options?: any): Promise<BaseMessage> {
    return new HumanMessage(`${this.providerName} chat response`);
  }
  
  async *streamComplete(prompt: string, context: ILLMContext, options?: any): AsyncGenerator<string> {
    yield `${this.providerName} `;
    yield 'streamed ';
    yield 'response';
  }
  
  async *streamChat(messages: BaseMessage[], context: ILLMContext, options?: any): AsyncGenerator<string> {
    yield `${this.providerName} `;
    yield 'streamed ';
    yield 'chat';
  }
  
  getLangchainModel() {
    return { modelName: this.providerName };
  }
}

class MockEmbeddingProvider implements IEmbeddingProvider {
  constructor(public providerName: string, public capabilities: IEmbeddingProviderCapabilities) {}
  
  async embedDocuments(texts: string[], context?: ILLMContext): Promise<number[][]> {
    return texts.map(() => Array(this.capabilities.dimensions).fill(0.1));
  }
  
  async embedQuery(text: string, context?: ILLMContext): Promise<number[]> {
    return Array(this.capabilities.dimensions).fill(0.1);
  }
  
  getLangchainEmbeddings() {
    return { modelName: this.providerName };
  }
}

describe('LLMService', () => {
  let llmService: LLMService;
  let gpt4oMiniProvider: MockCompletionProvider;
  let gpt4TurboProvider: MockCompletionProvider;
  let embeddingProvider: MockEmbeddingProvider;
  
  beforeEach(() => {
    // Create mock providers
    gpt4oMiniProvider = new MockCompletionProvider('OpenAI-GPT-4o-Mini', {
      supportsStreaming: true,
      maxInputTokens: 128000,
      supportsJSONOutputMode: true,
      outputFormats: ['text', 'json_object']
    });
    
    gpt4TurboProvider = new MockCompletionProvider('OpenAI-GPT-4-Turbo', {
      supportsStreaming: true,
      maxInputTokens: 128000,
      supportsJSONOutputMode: true,
      outputFormats: ['text', 'json_object', 'tool_calls']
    });
    
    embeddingProvider = new MockEmbeddingProvider('OpenAI-text-embedding-3-small', {
      dimensions: 1536,
      maxInputTokensPerDocument: 8191
    });
    
    // Create provider maps
    const completionProviders = new Map();
    completionProviders.set('OpenAI-GPT-4o-Mini', gpt4oMiniProvider);
    completionProviders.set('OpenAI-GPT-4-Turbo', gpt4TurboProvider);
    
    const embeddingProviders = new Map();
    embeddingProviders.set('OpenAI-text-embedding-3-small', embeddingProvider);
    
    // Create LLMService
    llmService = new LLMService({
      completionProviders,
      embeddingProviders,
      defaultCompletionModel: 'OpenAI-GPT-4o-Mini',
      defaultEmbeddingModel: 'OpenAI-text-embedding-3-small'
    });
  });
  
  describe('Provider Selection', () => {
    it('should select GPT-4o-mini for balanced_throughput priority', async () => {
      const context: ILLMContext = {
        userId: 'test',
        taskType: 'chat',
        priority: 'balanced_throughput'
      };
      
      const response = await llmService.generateCompletion('Hello', context);
      expect(response).toContain('OpenAI-GPT-4o-Mini');
    });
    
    it('should select GPT-4-turbo for high_performance_large_context priority', async () => {
      const context: ILLMContext = {
        userId: 'test',
        taskType: 'chat',
        priority: 'high_performance_large_context'
      };
      
      const response = await llmService.generateCompletion('Hello', context);
      expect(response).toContain('OpenAI-GPT-4-Turbo');
    });
    
    it('should select GPT-4-turbo for chunking_structure_extraction task', async () => {
      const context: ILLMContext = {
        userId: 'test',
        taskType: 'chunking_structure_extraction',
        priority: 'balanced_throughput'
      };
      
      const response = await llmService.generateCompletion('Hello', context);
      expect(response).toContain('OpenAI-GPT-4-Turbo');
    });
    
    it('should select GPT-4-turbo for profile_synthesis task', async () => {
      const context: ILLMContext = {
        userId: 'test',
        taskType: 'profile_synthesis',
        priority: 'balanced_throughput'
      };
      
      const response = await llmService.generateCompletion('Hello', context);
      expect(response).toContain('OpenAI-GPT-4-Turbo');
    });
    
    it('should select GPT-4-turbo for intent_analysis task', async () => {
      const context: ILLMContext = {
        userId: 'test',
        taskType: 'intent_analysis',
        priority: 'balanced_throughput'
      };
      
      const response = await llmService.generateCompletion('Hello', context);
      expect(response).toContain('OpenAI-GPT-4-Turbo');
    });
  });
  
  describe('Chat Operations', () => {
    it('should generate chat responses', async () => {
      const messages = [new HumanMessage('Hello')];
      const context: ILLMContext = {
        userId: 'test',
        taskType: 'chat',
        priority: 'balanced_throughput'
      };
      
      const response = await llmService.generateChatResponse(messages, context);
      expect(response).toBeInstanceOf(BaseMessage);
      expect(response.content).toContain('OpenAI-GPT-4o-Mini');
    });
    
    it('should stream chat responses', async () => {
      const messages = [new HumanMessage('Hello')];
      const context: ILLMContext = {
        userId: 'test',
        taskType: 'chat',
        priority: 'balanced_throughput'
      };
      
      const chunks: string[] = [];
      for await (const chunk of llmService.streamChatResponse(messages, context)) {
        chunks.push(chunk);
      }
      
      expect(chunks).toHaveLength(3);
      expect(chunks.join('')).toContain('OpenAI-GPT-4o-Mini');
    });
  });
  
  describe('Embedding Operations', () => {
    it('should embed query text', async () => {
      const embedding = await llmService.embedQuery('Hello world');
      expect(embedding).toBeInstanceOf(Array);
      expect(embedding).toHaveLength(1536);
    });
    
    it('should embed multiple documents', async () => {
      const embeddings = await llmService.embedDocuments(['Hello', 'World']);
      expect(embeddings).toHaveLength(2);
      expect(embeddings[0]).toHaveLength(1536);
    });
  });
  
  describe('LangChain Integration', () => {
    it('should get LangChain model', () => {
      const context: ILLMContext = {
        userId: 'test',
        taskType: 'chat',
        priority: 'balanced_throughput'
      };
      
      const model = llmService.getLangchainModel(context);
      expect(model.modelName).toBe('OpenAI-GPT-4o-Mini');
    });
    
    it('should get LangChain embeddings', () => {
      const embeddings = llmService.getLangchainEmbeddings();
      expect(embeddings.modelName).toBe('OpenAI-text-embedding-3-small');
    });
  });
  
  describe('Error Handling', () => {
    it('should handle provider errors gracefully', async () => {
      // Override complete method to throw an error
      vi.spyOn(gpt4oMiniProvider, 'complete').mockRejectedValue(new Error('API Error'));
      
      const context: ILLMContext = {
        userId: 'test',
        taskType: 'chat',
        priority: 'balanced_throughput'
      };
      
      await expect(llmService.generateCompletion('Hello', context)).rejects.toMatchObject({
        name: 'LLMProviderError',
        providerName: 'OpenAI-GPT-4o-Mini'
      });
    });
    
    it('should fall back to default provider if selected provider not found', async () => {
      // Remove GPT-4-Turbo provider
      const completionProviders = new Map();
      completionProviders.set('OpenAI-GPT-4o-Mini', gpt4oMiniProvider);
      
      const embeddingProviders = new Map();
      embeddingProviders.set('OpenAI-text-embedding-3-small', embeddingProvider);
      
      llmService = new LLMService({
        completionProviders,
        embeddingProviders,
        defaultCompletionModel: 'OpenAI-GPT-4o-Mini',
        defaultEmbeddingModel: 'OpenAI-text-embedding-3-small'
      });
      
      const context: ILLMContext = {
        userId: 'test',
        taskType: 'chunking_structure_extraction', // This would normally select GPT-4-Turbo
        priority: 'balanced_throughput'
      };
      
      const response = await llmService.generateCompletion('Hello', context);
      expect(response).toContain('OpenAI-GPT-4o-Mini'); // Falls back to default
    });
  });
});