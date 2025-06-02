"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMService = void 0;
const logger_1 = require("../utils/logger");
class LLMService {
    constructor(config) {
        this.completionProviders = config.completionProviders;
        this.embeddingProviders = config.embeddingProviders;
        this.defaultCompletionModel = config.defaultCompletionModel;
        this.defaultEmbeddingModel = config.defaultEmbeddingModel;
        this.defaultVectorPrepModel = config.defaultVectorPrepModel || config.defaultCompletionModel;
        logger_1.logger.info("[LLMService] Initialized with providers:", {
            completionProviders: Array.from(this.completionProviders.keys()),
            embeddingProviders: Array.from(this.embeddingProviders.keys()),
            defaultCompletionModel: this.defaultCompletionModel,
            defaultEmbeddingModel: this.defaultEmbeddingModel,
            defaultVectorPrepModel: this.defaultVectorPrepModel
        });
    }
    _selectCompletionProvider(context) {
        logger_1.logger.debug("[LLMService] Selecting completion provider", { context });
        // Check if this is a vector prep task (chunking, summarization)
        const isVectorPrep = context.taskType === 'chunking_structure_extraction' ||
            context.taskType === 'summarization';
        const modelKey = isVectorPrep ? this.defaultVectorPrepModel : this.defaultCompletionModel;
        const provider = this.completionProviders.get(modelKey);
        if (!provider) {
            throw new Error(`Completion provider ${modelKey} not found`);
        }
        logger_1.logger.debug(`[LLMService] Selected provider: ${provider.providerName} for ${context.taskType}`);
        return provider;
    }
    _selectEmbeddingProvider(context) {
        logger_1.logger.debug("[LLMService] Selecting embedding provider", { context });
        const provider = this.embeddingProviders.get(this.defaultEmbeddingModel);
        if (!provider) {
            throw new Error(`Default embedding provider ${this.defaultEmbeddingModel} not found`);
        }
        logger_1.logger.debug(`[LLMService] Selected provider: ${provider.providerName}`);
        return provider;
    }
    async generateCompletion(prompt, context, options) {
        logger_1.logger.debug("[LLMService] generateCompletion called", {
            context,
            promptLength: prompt.length,
            options
        });
        const provider = this._selectCompletionProvider(context);
        try {
            return await provider.complete(prompt, context, options);
        }
        catch (error) {
            logger_1.logger.error("[LLMService] generateCompletion error:", error);
            const providerError = {
                name: 'LLMProviderError',
                message: `Error from ${provider.providerName}: ${error instanceof Error ? error.message : String(error)}`,
                providerName: provider.providerName,
                originalError: error instanceof Error ? error : undefined,
                isRetryable: this._isRetryableError(error)
            };
            throw providerError;
        }
    }
    async generateChatResponse(messages, context, options) {
        logger_1.logger.debug("[LLMService] generateChatResponse called", {
            context,
            messageCount: messages.length,
            options
        });
        const provider = this._selectCompletionProvider(context);
        try {
            return await provider.chat(messages, context, options);
        }
        catch (error) {
            logger_1.logger.error("[LLMService] generateChatResponse error:", error);
            const providerError = {
                name: 'LLMProviderError',
                message: `Error from ${provider.providerName}: ${error instanceof Error ? error.message : String(error)}`,
                providerName: provider.providerName,
                originalError: error instanceof Error ? error : undefined,
                isRetryable: this._isRetryableError(error)
            };
            throw providerError;
        }
    }
    async *streamCompletion(prompt, context, options) {
        logger_1.logger.debug("[LLMService] streamCompletion called", {
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
        }
        catch (error) {
            logger_1.logger.error("[LLMService] streamCompletion error:", error);
            const providerError = {
                name: 'LLMProviderError',
                message: `Error from ${provider.providerName}: ${error instanceof Error ? error.message : String(error)}`,
                providerName: provider.providerName,
                originalError: error instanceof Error ? error : undefined,
                isRetryable: this._isRetryableError(error)
            };
            throw providerError;
        }
    }
    async *streamChatResponse(messages, context, options) {
        logger_1.logger.debug("[LLMService] streamChatResponse called", {
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
        }
        catch (error) {
            logger_1.logger.error("[LLMService] streamChatResponse error:", error);
            const providerError = {
                name: 'LLMProviderError',
                message: `Error from ${provider.providerName}: ${error instanceof Error ? error.message : String(error)}`,
                providerName: provider.providerName,
                originalError: error instanceof Error ? error : undefined,
                isRetryable: this._isRetryableError(error)
            };
            throw providerError;
        }
    }
    async embedDocuments(texts, context) {
        logger_1.logger.debug("[LLMService] embedDocuments called", {
            textCount: texts.length,
            context
        });
        const provider = this._selectEmbeddingProvider(context);
        try {
            return await provider.embedDocuments(texts, context);
        }
        catch (error) {
            logger_1.logger.error("[LLMService] embedDocuments error:", error);
            const providerError = {
                name: 'LLMProviderError',
                message: `Error from ${provider.providerName}: ${error instanceof Error ? error.message : String(error)}`,
                providerName: provider.providerName,
                originalError: error instanceof Error ? error : undefined,
                isRetryable: this._isRetryableError(error)
            };
            throw providerError;
        }
    }
    async embedQuery(text, context) {
        logger_1.logger.debug("[LLMService] embedQuery called", {
            textLength: text.length,
            context
        });
        const provider = this._selectEmbeddingProvider(context);
        try {
            return await provider.embedQuery(text, context);
        }
        catch (error) {
            logger_1.logger.error("[LLMService] embedQuery error:", error);
            const providerError = {
                name: 'LLMProviderError',
                message: `Error from ${provider.providerName}: ${error instanceof Error ? error.message : String(error)}`,
                providerName: provider.providerName,
                originalError: error instanceof Error ? error : undefined,
                isRetryable: this._isRetryableError(error)
            };
            throw providerError;
        }
    }
    getCompletionProvider(context) {
        return this._selectCompletionProvider(context);
    }
    getEmbeddingProvider(context) {
        return this._selectEmbeddingProvider(context);
    }
    getLangchainModel(context) {
        const provider = this._selectCompletionProvider(context);
        if (!provider.getLangchainModel) {
            throw new Error(`Provider ${provider.providerName} does not expose a LangChain model`);
        }
        return provider.getLangchainModel();
    }
    getLangchainEmbeddings(context) {
        const provider = this._selectEmbeddingProvider(context);
        if (!provider.getLangchainEmbeddings) {
            throw new Error(`Provider ${provider.providerName} does not expose LangChain embeddings`);
        }
        return provider.getLangchainEmbeddings();
    }
    _isRetryableError(error) {
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
exports.LLMService = LLMService;
//# sourceMappingURL=LLMService.js.map