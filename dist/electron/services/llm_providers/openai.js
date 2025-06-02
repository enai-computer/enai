"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAITextEmbedding3SmallProvider = exports.OpenAIGPT41NanoProvider = exports.OpenAIGPT4TurboProvider = exports.OpenAIGPT4oMiniProvider = void 0;
const openai_1 = require("@langchain/openai");
const messages_1 = require("@langchain/core/messages");
const logger_1 = require("../../utils/logger");
class BaseOpenAICompletionProvider {
    constructor(modelName, apiKey) {
        this.llm = new openai_1.ChatOpenAI({
            modelName,
            openAIApiKey: apiKey || process.env.OPENAI_API_KEY,
            temperature: 0.7,
        });
        logger_1.logger.info(`[${this.constructor.name}] Initialized ${modelName}`);
    }
    async complete(prompt, context, options) {
        logger_1.logger.debug(`[${this.providerName}] complete called`, {
            context,
            promptLength: prompt.length,
            options
        });
        try {
            const messages = [new messages_1.HumanMessage(prompt)];
            const llmConfig = {
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
        }
        catch (error) {
            logger_1.logger.error(`[${this.providerName}] complete error:`, error);
            throw error;
        }
    }
    async chat(messages, context, options) {
        logger_1.logger.debug(`[${this.providerName}] chat called`, {
            context,
            messageCount: messages.length,
            options
        });
        try {
            const llmConfig = {
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
        }
        catch (error) {
            logger_1.logger.error(`[${this.providerName}] chat error:`, error);
            throw error;
        }
    }
    async *streamComplete(prompt, context, options) {
        logger_1.logger.debug(`[${this.providerName}] streamComplete called`, {
            context,
            promptLength: prompt.length,
            options
        });
        try {
            const messages = [new messages_1.HumanMessage(prompt)];
            const llmConfig = {
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
        }
        catch (error) {
            logger_1.logger.error(`[${this.providerName}] streamComplete error:`, error);
            throw error;
        }
    }
    async *streamChat(messages, context, options) {
        logger_1.logger.debug(`[${this.providerName}] streamChat called`, {
            context,
            messageCount: messages.length,
            options
        });
        try {
            const llmConfig = {
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
        }
        catch (error) {
            logger_1.logger.error(`[${this.providerName}] streamChat error:`, error);
            throw error;
        }
    }
    getLangchainModel() {
        return this.llm;
    }
}
class OpenAIGPT4oMiniProvider extends BaseOpenAICompletionProvider {
    constructor(apiKey) {
        super("gpt-4o-mini", apiKey);
        this.providerName = "OpenAI-GPT-4o-Mini";
        this.capabilities = {
            supportsStreaming: true,
            maxInputTokens: 128000,
            supportsJSONOutputMode: true,
            outputFormats: ['text', 'json_object', 'tool_calls']
        };
    }
}
exports.OpenAIGPT4oMiniProvider = OpenAIGPT4oMiniProvider;
class OpenAIGPT4TurboProvider extends BaseOpenAICompletionProvider {
    constructor(apiKey) {
        super("gpt-4-turbo", apiKey);
        this.providerName = "OpenAI-GPT-4-Turbo";
        this.capabilities = {
            supportsStreaming: true,
            maxInputTokens: 128000,
            supportsJSONOutputMode: true,
            outputFormats: ['text', 'json_object', 'tool_calls']
        };
    }
}
exports.OpenAIGPT4TurboProvider = OpenAIGPT4TurboProvider;
class OpenAIGPT41NanoProvider extends BaseOpenAICompletionProvider {
    constructor(apiKey) {
        super("gpt-4.1-nano", apiKey);
        this.providerName = "OpenAI-GPT-4.1-Nano";
        this.capabilities = {
            supportsStreaming: true,
            maxInputTokens: 128000,
            supportsJSONOutputMode: true,
            outputFormats: ['text', 'json_object', 'tool_calls']
        };
    }
}
exports.OpenAIGPT41NanoProvider = OpenAIGPT41NanoProvider;
class OpenAITextEmbedding3SmallProvider {
    constructor(apiKey) {
        this.providerName = "OpenAI-text-embedding-3-small";
        this.capabilities = {
            dimensions: 1536,
            maxInputTokensPerDocument: 8191
        };
        this.embeddings = new openai_1.OpenAIEmbeddings({
            openAIApiKey: apiKey || process.env.OPENAI_API_KEY,
            modelName: "text-embedding-3-small",
        });
        logger_1.logger.info(`[OpenAITextEmbedding3SmallProvider] Initialized`);
    }
    async embedDocuments(texts, context) {
        logger_1.logger.debug(`[${this.providerName}] embedDocuments called`, {
            textCount: texts.length,
            context
        });
        try {
            return await this.embeddings.embedDocuments(texts);
        }
        catch (error) {
            logger_1.logger.error(`[${this.providerName}] embedDocuments error:`, error);
            throw error;
        }
    }
    async embedQuery(text, context) {
        logger_1.logger.debug(`[${this.providerName}] embedQuery called`, {
            textLength: text.length,
            context
        });
        try {
            return await this.embeddings.embedQuery(text);
        }
        catch (error) {
            logger_1.logger.error(`[${this.providerName}] embedQuery error:`, error);
            throw error;
        }
    }
    getLangchainEmbeddings() {
        return this.embeddings;
    }
}
exports.OpenAITextEmbedding3SmallProvider = OpenAITextEmbedding3SmallProvider;
//# sourceMappingURL=openai.js.map