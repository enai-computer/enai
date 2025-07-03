import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LLMClient } from '../LLMClient';
import { ConversationService } from '../ConversationService';
import { NotebookService } from '../../NotebookService';
import { ProfileService } from '../../ProfileService';
import { OpenAIMessage } from '../../../shared/types/chat.types';
import { ChatOpenAI } from '@langchain/openai';

vi.mock('../../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
    stream: vi.fn(),
  })),
}));

vi.mock('../../../utils/llm', () => ({
  createOpenAI: vi.fn().mockImplementation((model) => ({
    invoke: vi.fn(),
    stream: vi.fn(),
    model,
  })),
}));

describe('LLMClient', () => {
  let llmClient: LLMClient;
  let conversationService: ConversationService;
  let notebookService: NotebookService;
  let profileService: ProfileService;

  beforeEach(async () => {
    conversationService = {
      getConversationHistory: vi.fn().mockReturnValue([]),
      ensureSession: vi.fn().mockResolvedValue('session-123'),
    } as any;

    notebookService = {
      ensureDefaultNotebook: vi.fn().mockResolvedValue({ id: 'notebook-123' }),
      createNotebookCover: vi.fn().mockReturnValue('Cover info'),
    } as any;

    profileService = {
      getSynthesizedProfile: vi.fn().mockResolvedValue({
        bio: 'Test user bio',
        goals: ['Goal 1', 'Goal 2'],
        expertise: ['Area 1', 'Area 2'],
      }),
    } as any;

    llmClient = new LLMClient({
      conversationService,
      notebookService,
      profileService,
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
      expect(messages[0].content).toContain('AI assistant');
      expect(messages[0].content).toContain('Test user bio');
      expect(messages[0].content).toContain('Goal 1');
      expect(messages[0].content).toContain('Cover info');
      
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe(intentText);
    });

    it('should include conversation history', async () => {
      const senderId = 'test-sender';
      const history: OpenAIMessage[] = [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
      ];
      
      vi.mocked(conversationService.getConversationHistory).mockReturnValue(history);
      
      const messages = await llmClient.prepareMessages(senderId, 'New message');
      
      expect(messages).toHaveLength(4); // system + history + new
      expect(messages[1]).toEqual(history[0]);
      expect(messages[2]).toEqual(history[1]);
      expect(messages[3].content).toBe('New message');
    });

    it('should include search results in payload', async () => {
      const senderId = 'test-sender';
      const payload = {
        searchResults: [
          { title: 'Result 1', summary: 'Summary 1', url: 'http://example.com/1' },
          { title: 'Result 2', summary: 'Summary 2', url: 'http://example.com/2' },
        ],
      };
      
      const messages = await llmClient.prepareMessages(senderId, 'Search query', payload);
      
      expect(messages[0].content).toContain('Search results');
      expect(messages[0].content).toContain('Result 1');
      expect(messages[0].content).toContain('Summary 1');
    });

    it('should limit conversation history', async () => {
      const senderId = 'test-sender';
      const longHistory = Array(50).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      })) as OpenAIMessage[];
      
      vi.mocked(conversationService.getConversationHistory).mockReturnValue(longHistory);
      
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
      };
      
      const createOpenAI = await import('../../../utils/llm');
      vi.mocked(createOpenAI.createOpenAI).mockReturnValue(mockLLM as any);
      
      const response = await llmClient.callOpenAI(messages);
      
      expect(response).toEqual({
        role: 'assistant',
        content: 'Hello! How can I help you today?',
        metadata: { model: 'gpt-4' },
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
      };
      
      const createOpenAI = await import('../../../utils/llm');
      vi.mocked(createOpenAI.createOpenAI).mockReturnValue(mockLLM as any);
      
      const response = await llmClient.callOpenAI(messages);
      
      expect(response).toBeNull();
    });

    it('should handle empty response', async () => {
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      
      const mockLLM = {
        invoke: vi.fn().mockResolvedValue({ content: '' }),
      };
      
      const createOpenAI = await import('../../../utils/llm');
      vi.mocked(createOpenAI.createOpenAI).mockReturnValue(mockLLM as any);
      
      const response = await llmClient.callOpenAI(messages);
      
      expect(response).toEqual({
        role: 'assistant',
        content: '',
        metadata: undefined,
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
      
      const mockLLM = {
        stream: vi.fn().mockReturnValue(mockStream()),
      };
      
      const createOpenAI = await import('../../../utils/llm');
      vi.mocked(createOpenAI.createOpenAI).mockReturnValue(mockLLM as any);
      
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
        metadata: undefined,
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
      
      const mockLLM = {
        stream: vi.fn().mockReturnValue(mockStream()),
      };
      
      const createOpenAI = await import('../../../utils/llm');
      vi.mocked(createOpenAI.createOpenAI).mockReturnValue(mockLLM as any);
      
      const generator = llmClient.streamOpenAI(messages);
      const chunks: string[] = [];
      
      try {
        for await (const chunk of generator) {
          chunks.push(chunk);
        }
      } catch (error) {
        // Expected
      }
      
      expect(chunks).toEqual(['Start']);
    });

    it('should handle empty stream', async () => {
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      
      const mockStream = async function* () {
        // Empty stream
      };
      
      const mockLLM = {
        stream: vi.fn().mockReturnValue(mockStream()),
      };
      
      const createOpenAI = await import('../../../utils/llm');
      vi.mocked(createOpenAI.createOpenAI).mockReturnValue(mockLLM as any);
      
      const generator = llmClient.streamOpenAI(messages);
      const result = await generator.next();
      
      expect(result.done).toBe(true);
      expect(result.value).toEqual({
        role: 'assistant',
        content: '',
        metadata: undefined,
      });
    });
  });

  describe('generateSystemPrompt', () => {
    it('should generate complete system prompt', async () => {
      const prompt = await llmClient.generateSystemPrompt();
      
      expect(prompt).toContain('AI assistant');
      expect(prompt).toContain('Test user bio');
      expect(prompt).toContain('Goal 1');
      expect(prompt).toContain('Goal 2');
      expect(prompt).toContain('Area 1');
      expect(prompt).toContain('Area 2');
      expect(prompt).toContain('Cover info');
    });

    it('should handle missing profile data', async () => {
      vi.mocked(profileService.getSynthesizedProfile).mockResolvedValue({
        bio: '',
        goals: [],
        expertise: [],
      });
      
      const prompt = await llmClient.generateSystemPrompt();
      
      expect(prompt).toContain('AI assistant');
      expect(prompt).not.toContain('Goals:');
      expect(prompt).not.toContain('Areas of expertise:');
    });

    it('should include search results context', async () => {
      const searchResults = [
        { title: 'Test', summary: 'Summary', url: 'http://example.com' },
      ];
      
      const prompt = await llmClient.generateSystemPrompt(searchResults);
      
      expect(prompt).toContain('Search results for context');
      expect(prompt).toContain('Test');
      expect(prompt).toContain('Summary');
    });
  });

  describe('message conversion', () => {
    it('should convert to base messages correctly', () => {
      const openAIMessages: OpenAIMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' },
        { role: 'assistant', content: 'Assistant response' },
      ];
      
      const baseMessages = llmClient.convertToBaseMessages(openAIMessages);
      
      expect(baseMessages).toHaveLength(3);
      expect(baseMessages[0].constructor.name).toContain('SystemMessage');
      expect(baseMessages[1].constructor.name).toContain('HumanMessage');
      expect(baseMessages[2].constructor.name).toContain('AIMessage');
    });

    it('should convert from base messages correctly', () => {
      const mockBaseMessage = {
        content: 'Test response',
        additional_kwargs: { model: 'gpt-4' },
      };
      
      const openAIMessage = llmClient.convertFromBaseMessage(mockBaseMessage as any);
      
      expect(openAIMessage).toEqual({
        role: 'assistant',
        content: 'Test response',
        metadata: { model: 'gpt-4' },
      });
    });

    it('should handle invalid role types', () => {
      const invalidMessages = [
        { role: 'invalid' as any, content: 'Test' },
      ];
      
      expect(() => {
        llmClient.convertToBaseMessages(invalidMessages);
      }).toThrow('Unknown message role');
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
      };
      
      const createOpenAI = await import('../../../utils/llm');
      vi.mocked(createOpenAI.createOpenAI).mockReturnValue(mockLLM as any);
      
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
      };
      
      const createOpenAI = await import('../../../utils/llm');
      vi.mocked(createOpenAI.createOpenAI).mockReturnValue(mockLLM as any);
      
      await llmClient.callOpenAI(messages);
      
      expect(mockLLM.invoke).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content: specialContent }),
        ])
      );
    });
  });
});