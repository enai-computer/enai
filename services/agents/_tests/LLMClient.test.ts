import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LLMClient } from '../LLMClient';
import { OpenAIMessage } from '../../../shared/types/agent.types';
import { mockLoggerModule } from '../../../test-utils/mocks/logger';
import { 
  createMockConversationService, 
  createMockNotebookService, 
  createMockProfileService 
} from '../../../test-utils/mocks/services';

// Mock modules
vi.mock('../../../utils/logger', () => mockLoggerModule);

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
    stream: vi.fn(),
  })),
}));

vi.mock('../../../utils/llm', () => ({
  createChatModel: vi.fn().mockImplementation((model) => ({
    invoke: vi.fn(),
    stream: vi.fn(),
    bind: vi.fn().mockReturnThis(),
    model,
  })),
}));

describe('LLMClient', () => {
  let llmClient: LLMClient;

  // Helper to create a mock LLM with streaming support
  const createMockStreamingLLM = (streamGenerator: AsyncGenerator<any, any, unknown>) => {
    const boundLLM = {
      stream: vi.fn().mockReturnValue(streamGenerator),
    };
    return {
      bind: vi.fn().mockReturnValue(boundLLM),
    };
  };

  beforeEach(async () => {
    // Create minimal mocks with only what's needed
    const conversationService = createMockConversationService({
      getConversationHistory: vi.fn().mockReturnValue([]),
      ensureSession: vi.fn().mockResolvedValue('session-123'),
      updateConversationHistory: vi.fn(),
    });

    const notebookService = createMockNotebookService({
      ensureDefaultNotebook: vi.fn().mockResolvedValue({ id: 'notebook-123' }),
      getAllRegularNotebooks: vi.fn().mockResolvedValue([
        { id: 'notebook-123', title: 'Test Notebook' }
      ]),
    });

    const profileService = createMockProfileService({
      getEnrichedProfileForAI: vi.fn().mockResolvedValue(
        'User Name: Test User\nAbout User: Test user bio\nStated Goals: Goal 1, Goal 2\nAreas of Expertise: Area 1, Area 2'
      ),
    });

    llmClient = new LLMClient({
      conversationService: conversationService as any,
      notebookService: notebookService as any,
      profileService: profileService as any,
    });

    await llmClient.initialize();
  });

  afterEach(async () => {
    await llmClient.cleanup();
  });

  describe('prepareMessages', () => {
    it('should prepare messages with system prompt', async () => {
      const senderId = 'test-sender';
      const intentText = 'Hello, world!';
      
      const messages = await llmClient.prepareMessages(senderId, intentText);
      
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('helpful, proactive assistant');
      expect(messages[0].content).toContain('User Name: Test User');
      expect(messages[0].content).toContain('knowledge base');
      
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe(intentText);
    });

    it('should include conversation history', async () => {
      const senderId = 'test-sender';
      const history: OpenAIMessage[] = [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
      ];
      
      // Update the mock to return history
      const conversationService = createMockConversationService({
        getConversationHistory: vi.fn().mockReturnValue([...history]),
        ensureSession: vi.fn().mockResolvedValue('session-123'),
      });
      
      const profileService = createMockProfileService({
        getEnrichedProfileForAI: vi.fn().mockResolvedValue('User Name: Test User'),
      });
      
      const llmClient = new LLMClient({
        conversationService: conversationService as any,
        notebookService: createMockNotebookService() as any,
        profileService: profileService as any,
      });
      
      await llmClient.initialize();
      
      const messages = await llmClient.prepareMessages(senderId, 'New message');
      
      // When existing history has no system message, LLMClient prepends one
      expect(messages).toHaveLength(4); // system + history + new
      expect(messages[0].role).toBe('system'); // System message prepended
      expect(messages[0].content).toContain('helpful, proactive assistant');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('Previous message');
      expect(messages[2].role).toBe('assistant');
      expect(messages[2].content).toBe('Previous response');
      expect(messages[3].role).toBe('user');
      expect(messages[3].content).toBe('New message');
    });

    it('should include notebook context when provided', async () => {
      const senderId = 'test-sender';
      const payload = {
        intentText: 'Search query',
        context: 'notebook' as const,
        notebookId: 'notebook-123',
      };
      
      const messages = await llmClient.prepareMessages(senderId, 'Search query', payload);
      
      // Check that the system prompt is present
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('helpful, proactive assistant');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('Search query');
    });

    it('should limit conversation history', async () => {
      const senderId = 'test-sender';
      const longHistory = Array(50).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      })) as OpenAIMessage[];
      
      const conversationService = createMockConversationService({
        getConversationHistory: vi.fn().mockReturnValue(longHistory),
        ensureSession: vi.fn().mockResolvedValue('session-123'),
      });
      
      const profileService = createMockProfileService({
        getEnrichedProfileForAI: vi.fn().mockResolvedValue('User Name: Test User'),
      });
      
      const llmClient = new LLMClient({
        conversationService: conversationService as any,
        notebookService: createMockNotebookService() as any,
        profileService: profileService as any,
      });
      
      await llmClient.initialize();
      
      const messages = await llmClient.prepareMessages(senderId, 'New message');
      
      // Should include system + limited history + new message
      expect(messages.length).toBeLessThan(longHistory.length + 2);
      expect(messages[messages.length - 1].content).toBe('New message');
    });
  });

  describe('callOpenAI', () => {
    it('should make successful API call', async () => {
      const messages: OpenAIMessage[] = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ];
      
      const mockResponse = {
        content: 'Hello! How can I help you today?',
        additional_kwargs: { model: 'gpt-4' },
      };
      
      const mockLLM = {
        invoke: vi.fn().mockResolvedValue(mockResponse),
        bind: vi.fn().mockReturnThis(),
      };
      
      const llmModule = await import('../../../utils/llm');
      vi.mocked(llmModule.createChatModel).mockReturnValue(mockLLM as any);
      
      const response = await llmClient.callOpenAI(messages);
      
      expect(response).toEqual({
        role: 'assistant',
        content: 'Hello! How can I help you today?',
        tool_calls: undefined,
      });
      
      expect(mockLLM.invoke).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content: 'You are a helpful assistant' }),
          expect.objectContaining({ content: 'Hello' }),
        ])
      );
    });

    it('should handle API errors gracefully', async () => {
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      
      const mockLLM = {
        invoke: vi.fn().mockRejectedValue(new Error('API Error')),
        bind: vi.fn().mockReturnThis(),
      };
      
      const llmModule = await import('../../../utils/llm');
      vi.mocked(llmModule.createChatModel).mockReturnValue(mockLLM as any);
      
      await expect(llmClient.callOpenAI(messages)).rejects.toThrow('API Error');
    });

    it('should handle empty response', async () => {
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      
      const mockLLM = {
        invoke: vi.fn().mockResolvedValue({ content: '' }),
        bind: vi.fn().mockReturnThis(),
      };
      
      const llmModule = await import('../../../utils/llm');
      vi.mocked(llmModule.createChatModel).mockReturnValue(mockLLM as any);
      
      const response = await llmClient.callOpenAI(messages);
      
      expect(response).toEqual({
        role: 'assistant',
        content: null,
        tool_calls: undefined,
      });
    });
  });

  describe('streamOpenAI', () => {
    it('should stream responses successfully', async () => {
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      
      const chunks = ['Hello', ' there', '!'];
      const mockStream = async function* () {
        for (const chunk of chunks) {
          yield { content: chunk };
        }
      };
      
      const mockLLM = createMockStreamingLLM(mockStream());
      
      const llmModule = await import('../../../utils/llm');
      vi.mocked(llmModule.createChatModel).mockReturnValue(mockLLM as any);
      
      const collected: string[] = [];
      const onChunk = vi.fn((chunk: string) => {
        collected.push(chunk);
      });
      
      const generator = llmClient.streamOpenAI(messages, onChunk);
      let result = await generator.next();
      
      while (!result.done) {
        result = await generator.next();
      }
      
      expect(collected).toEqual(chunks);
      expect(onChunk).toHaveBeenCalledTimes(3);
      expect(result.value).toEqual({
        role: 'assistant',
        content: 'Hello there!',
        tool_calls: undefined,
      });
    });

    it('should handle streaming errors', async () => {
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      
      const mockStream = async function* () {
        yield { content: 'Start' };
        throw new Error('Stream error');
      };
      
      const mockLLM = createMockStreamingLLM(mockStream());
      
      const llmModule = await import('../../../utils/llm');
      vi.mocked(llmModule.createChatModel).mockReturnValue(mockLLM as any);
      
      const generator = llmClient.streamOpenAI(messages);
      const chunks: string[] = [];
      
      await expect(async () => {
        for await (const chunk of generator) {
          chunks.push(chunk);
        }
      }).rejects.toThrow('Stream error');
      
      expect(chunks).toEqual(['Start']);
    });

    it('should handle empty stream', async () => {
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      
      const mockStream = async function* () {
        // Empty stream
      };
      
      const mockLLM = createMockStreamingLLM(mockStream());
      
      const llmModule = await import('../../../utils/llm');
      vi.mocked(llmModule.createChatModel).mockReturnValue(mockLLM as any);
      
      const generator = llmClient.streamOpenAI(messages);
      const result = await generator.next();
      
      expect(result.done).toBe(true);
      expect(result.value).toEqual({
        role: 'assistant',
        content: '',
        tool_calls: undefined,
      });
    });
  });

  describe('edge cases', () => {
    it('should handle very long messages', async () => {
      const longContent = 'x'.repeat(10000);
      const messages: OpenAIMessage[] = [
        { role: 'user', content: longContent },
      ];
      
      const mockLLM = {
        invoke: vi.fn().mockResolvedValue({ content: 'Response' }),
        bind: vi.fn().mockReturnThis(),
      };
      
      const llmModule = await import('../../../utils/llm');
      vi.mocked(llmModule.createChatModel).mockReturnValue(mockLLM as any);
      
      const response = await llmClient.callOpenAI(messages);
      
      expect(response).toBeDefined();
      expect(mockLLM.invoke).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content: longContent }),
        ])
      );
    });

    it('should handle special characters in messages', async () => {
      const specialContent = `Test "quotes" 'apostrophes' \n\t emojis 🎉`;
      const messages: OpenAIMessage[] = [
        { role: 'user', content: specialContent },
      ];
      
      const mockLLM = {
        invoke: vi.fn().mockResolvedValue({ content: 'Response' }),
        bind: vi.fn().mockReturnThis(),
      };
      
      const llmModule = await import('../../../utils/llm');
      vi.mocked(llmModule.createChatModel).mockReturnValue(mockLLM as any);
      
      await llmClient.callOpenAI(messages);
      
      expect(mockLLM.invoke).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content: specialContent }),
        ])
      );
    });
  });
});