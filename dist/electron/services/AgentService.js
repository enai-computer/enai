"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentService = void 0;
const logger_1 = require("../utils/logger");
const ExaService_1 = require("./ExaService");
const HybridSearchService_1 = require("./HybridSearchService");
const SearchResultFormatter_1 = require("./SearchResultFormatter");
const AgentService_constants_1 = require("./AgentService.constants");
class AgentService {
    constructor(notebookService, hybridSearchServiceParam = HybridSearchService_1.hybridSearchService, exaServiceParam = ExaService_1.exaService) {
        this.conversationHistory = new Map();
        this.notebookService = notebookService;
        this.hybridSearchService = hybridSearchServiceParam;
        this.exaService = exaServiceParam;
        this.formatter = new SearchResultFormatter_1.SearchResultFormatter();
        this.openAIKey = process.env.OPENAI_API_KEY;
        if (!this.openAIKey) {
            logger_1.logger.warn('[AgentService] OPENAI_API_KEY not found. AgentService will not be able to process complex intents.');
        }
        logger_1.logger.info('[AgentService] Initialized');
    }
    async processComplexIntent(payload, senderId) {
        const { intentText } = payload;
        const effectiveSenderId = senderId || '0';
        if (!this.openAIKey) {
            logger_1.logger.error('[AgentService] Cannot process intent: OPENAI_API_KEY is missing.');
            return { type: 'error', message: 'AI service is not configured. Please set the OPENAI_API_KEY environment variable.' };
        }
        logger_1.logger.info(`[AgentService] Processing complex intent: "${intentText}" from sender ${effectiveSenderId}`);
        try {
            // Get messages and ensure system prompt
            const messages = await this.prepareMessages(effectiveSenderId, intentText);
            // Call OpenAI
            const assistantMessage = await this.callOpenAI(messages);
            if (!assistantMessage) {
                return { type: 'error', message: 'No response from AI' };
            }
            // Store assistant message
            messages.push(assistantMessage);
            this.updateConversationHistory(effectiveSenderId, messages);
            // Handle tool calls if present
            if (assistantMessage.tool_calls?.length) {
                return await this.handleToolCalls(assistantMessage.tool_calls, messages, effectiveSenderId);
            }
            // Direct response
            if (assistantMessage.content) {
                return { type: 'chat_reply', message: assistantMessage.content };
            }
            return { type: 'error', message: 'No valid response from AI' };
        }
        catch (error) {
            logger_1.logger.error('[AgentService] Error processing complex intent:', error);
            return { type: 'error', message: 'An error occurred while processing your request.' };
        }
    }
    async prepareMessages(senderId, intentText) {
        let messages = this.conversationHistory.get(senderId) || [];
        // Add system prompt if new conversation
        if (messages.length === 0) {
            const notebooks = await this.notebookService.getAllNotebooks();
            messages.push({
                role: "system",
                content: (0, AgentService_constants_1.generateSystemPrompt)(notebooks)
            });
        }
        // Add user message
        messages.push({ role: "user", content: intentText });
        return messages;
    }
    async callOpenAI(messages) {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.openAIKey}`,
            },
            body: JSON.stringify({
                model: AgentService_constants_1.OPENAI_CONFIG.model,
                messages: this.filterValidMessages(messages),
                tools: AgentService_constants_1.TOOL_DEFINITIONS,
                tool_choice: "auto",
                temperature: AgentService_constants_1.OPENAI_CONFIG.temperature,
            }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            logger_1.logger.error(`[AgentService] OpenAI API error: ${response.status}`, errorData);
            throw new Error(errorData?.error?.message || response.statusText);
        }
        const data = await response.json();
        return data.choices?.[0]?.message || null;
    }
    async handleToolCalls(toolCalls, messages, senderId) {
        logger_1.logger.info(`[AgentService] Processing ${toolCalls.length} tool call(s)`);
        // Process all tool calls in parallel
        const toolPromises = toolCalls.map(tc => this.processToolCall(tc));
        const toolResults = await Promise.all(toolPromises);
        // Add tool responses to messages
        toolCalls.forEach((toolCall, index) => {
            messages.push({
                role: "tool",
                content: toolResults[index].content,
                tool_call_id: toolCall.id
            });
        });
        // Update history
        this.updateConversationHistory(senderId, messages);
        // Check for immediate returns
        const immediateReturn = toolResults.find(r => r.immediateReturn);
        if (immediateReturn?.immediateReturn) {
            return immediateReturn.immediateReturn;
        }
        // If we have search results, get AI summary
        const hasSearchResults = toolResults.some((result, index) => toolCalls[index].function.name === 'search_web' &&
            !result.content.startsWith('Error:'));
        if (hasSearchResults) {
            return await this.getAISummary(messages, senderId);
        }
        return { type: 'chat_reply', message: 'Request processed.' };
    }
    async processToolCall(toolCall) {
        const { name, arguments: argsJson } = toolCall.function;
        try {
            const args = JSON.parse(argsJson);
            logger_1.logger.info(`[AgentService] Processing tool: ${name}`, args);
            switch (name) {
                case 'open_notebook':
                    return await this.handleOpenNotebook(args);
                case 'create_notebook':
                    return await this.handleCreateNotebook(args);
                case 'delete_notebook':
                    return await this.handleDeleteNotebook(args);
                case 'search_web':
                    return await this.handleSearchWeb(args);
                case 'open_url':
                    return await this.handleOpenUrl(args);
                default:
                    logger_1.logger.warn(`[AgentService] Unknown tool: ${name}`);
                    return { content: `Unknown tool: ${name}` };
            }
        }
        catch (error) {
            logger_1.logger.error(`[AgentService] Tool call error:`, error);
            return { content: `Error: ${error instanceof Error ? error.message : 'Tool execution failed'}` };
        }
    }
    async handleOpenNotebook(args) {
        const { notebook_name } = args;
        if (!notebook_name) {
            return { content: "Error: Notebook name was unclear." };
        }
        const notebooks = await this.notebookService.getAllNotebooks();
        const found = notebooks.find(nb => nb.title.toLowerCase() === notebook_name.toLowerCase());
        if (found) {
            return {
                content: `Opened notebook: ${found.title}`,
                immediateReturn: {
                    type: 'open_notebook',
                    notebookId: found.id,
                    title: found.title,
                    message: `Right on, I'll open "${found.title}" for you.`
                }
            };
        }
        return { content: `Notebook "${notebook_name}" not found.` };
    }
    async handleCreateNotebook(args) {
        const { title } = args;
        if (!title) {
            return { content: "Error: Notebook title was unclear." };
        }
        try {
            const notebook = await this.notebookService.createNotebook(title);
            return {
                content: `Created notebook: ${notebook.title}`,
                immediateReturn: {
                    type: 'open_notebook',
                    notebookId: notebook.id,
                    title: notebook.title,
                    message: `Right on, I've created "${notebook.title}" and I'll open it for you now.`
                }
            };
        }
        catch (error) {
            logger_1.logger.error(`[AgentService] Error creating notebook:`, error);
            return { content: `Failed to create notebook: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
    }
    async handleDeleteNotebook(args) {
        const { notebook_name } = args;
        if (!notebook_name) {
            return { content: "Error: Notebook name was unclear." };
        }
        const notebooks = await this.notebookService.getAllNotebooks();
        const found = notebooks.find(nb => nb.title.toLowerCase() === notebook_name.toLowerCase());
        if (!found) {
            return { content: `Notebook "${notebook_name}" not found.` };
        }
        try {
            await this.notebookService.deleteNotebook(found.id);
            logger_1.logger.info(`[AgentService] Deleted notebook "${notebook_name}" (ID: ${found.id})`);
            return {
                content: `Deleted notebook: ${found.title}`,
                immediateReturn: {
                    type: 'chat_reply',
                    message: `I've deleted "${found.title}" for you.`
                }
            };
        }
        catch (error) {
            logger_1.logger.error(`[AgentService] Error deleting notebook:`, error);
            return { content: `Failed to delete notebook: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
    }
    async handleSearchWeb(args) {
        const { query, searchType = 'general' } = args;
        if (!query) {
            return { content: "Error: Search query was unclear." };
        }
        logger_1.logger.info(`[AgentService] Searching: "${query}" (type: ${searchType})`);
        try {
            let results;
            if (searchType === 'headlines' || searchType === 'news') {
                results = await this.searchNews(query);
                // Check if this was a multi-source search
                const sources = this.detectNewsSourcesInternal(query);
                const formatted = sources.length > 0
                    ? this.formatter.formatMultiSourceNews(results, sources)
                    : this.formatter.formatNewsResults(results);
                return { content: formatted };
            }
            else {
                results = await this.hybridSearchService.search(query, {
                    numResults: 10
                });
            }
            const formatted = this.formatter.formatSearchResults(results);
            return { content: formatted };
        }
        catch (error) {
            logger_1.logger.error(`[AgentService] Search error:`, error);
            return { content: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
    }
    async handleOpenUrl(args) {
        const { url } = args;
        if (!url) {
            return { content: "Error: URL was unclear." };
        }
        const formattedUrl = url.startsWith('http') ? url : `https://${url}`;
        return {
            content: `Opened URL: ${formattedUrl}`,
            immediateReturn: {
                type: 'open_url',
                url: formattedUrl,
                message: `Right on, I'll open that for you.`
            }
        };
    }
    async searchNews(query) {
        const sources = this.detectNewsSourcesInternal(query);
        if (sources.length > 0) {
            // Multi-source search
            const cleanedQuery = this.removeSourcesFromQuery(query, sources);
            const results = await this.searchMultipleSources(sources, cleanedQuery);
            return results;
        }
        // General news search
        return await this.hybridSearchService.searchNews(query, {
            numResults: 10
        });
    }
    removeSourcesFromQuery(query, sources) {
        let cleaned = query;
        for (const source of sources) {
            const aliases = AgentService_constants_1.NEWS_SOURCE_MAPPINGS[source] || [];
            for (const alias of aliases) {
                cleaned = cleaned.replace(new RegExp(alias, 'gi'), '');
            }
        }
        return cleaned
            .replace(/\b(and|from|in|the)\b/gi, ' ')
            .replace(/[,]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    async searchMultipleSources(sources, cleanedQuery) {
        const { cleanNewsContent } = await Promise.resolve().then(() => __importStar(require('./helpers/contentFilter')));
        const searchPromises = sources.map(async (source) => {
            try {
                const query = `site:${source} ${cleanedQuery || 'headlines'} today`;
                const response = await this.exaService.search(query, {
                    type: 'neural',
                    numResults: 3,
                    includeDomains: [source],
                    contents: { text: true, highlights: true, summary: true },
                });
                return response.results.map(result => ({
                    id: result.id,
                    title: result.title,
                    url: result.url,
                    content: result.text ? cleanNewsContent(result.text) : result.summary || '',
                    score: result.score,
                    source: 'exa',
                    publishedDate: result.publishedDate,
                    author: result.author,
                    highlights: result.highlights,
                }));
            }
            catch (error) {
                logger_1.logger.error(`[AgentService] Failed to search ${source}:`, error);
                return [];
            }
        });
        const results = await Promise.all(searchPromises);
        return results.flat();
    }
    async getAISummary(messages, senderId) {
        try {
            const summaryMessage = await this.callOpenAI(messages);
            if (summaryMessage?.content) {
                messages.push(summaryMessage);
                this.updateConversationHistory(senderId, messages);
                return { type: 'chat_reply', message: summaryMessage.content };
            }
        }
        catch (error) {
            logger_1.logger.error(`[AgentService] Summary error:`, error);
        }
        // Fallback
        const searchContents = messages
            .filter(m => m.role === 'tool' && m.content?.includes('Search Results'))
            .map(m => m.content)
            .join('\n\n');
        return {
            type: 'chat_reply',
            message: `I found search results but couldn't summarize them. Here's what I found:\n\n${searchContents}`
        };
    }
    updateConversationHistory(senderId, messages) {
        // Trim if too long
        if (messages.length > AgentService_constants_1.OPENAI_CONFIG.maxHistoryLength) {
            messages = [messages[0], ...messages.slice(-AgentService_constants_1.OPENAI_CONFIG.maxHistoryLength + 1)];
        }
        this.conversationHistory.set(senderId, this.filterValidMessages(messages));
    }
    filterValidMessages(messages) {
        const filtered = [];
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            if (message.role === 'tool') {
                // Ensure tool message has valid context
                const prevMessage = i > 0 ? messages[i - 1] : null;
                if (prevMessage?.role === 'assistant' && prevMessage.tool_calls?.some(tc => tc.id === message.tool_call_id)) {
                    filtered.push(message);
                }
            }
            else {
                filtered.push(message);
            }
        }
        return filtered;
    }
    clearConversation(senderId) {
        this.conversationHistory.delete(senderId);
        logger_1.logger.info(`[AgentService] Cleared conversation for sender ${senderId}`);
    }
    clearAllConversations() {
        this.conversationHistory.clear();
        logger_1.logger.info(`[AgentService] Cleared all conversations`);
    }
    getActiveConversationCount() {
        return this.conversationHistory.size;
    }
    // Public methods for testing
    detectNewsSources(query) {
        const sources = this.detectNewsSourcesInternal(query);
        const cleanedQuery = sources.length > 0 ? this.removeSourcesFromQuery(query, sources) : query;
        return { sources, cleanedQuery };
    }
    detectNewsSourcesInternal(query) {
        const lower = query.toLowerCase();
        const detected = [];
        for (const [domain, aliases] of Object.entries(AgentService_constants_1.NEWS_SOURCE_MAPPINGS)) {
            if (aliases.some(alias => lower.includes(alias))) {
                detected.push(domain);
            }
        }
        return detected;
    }
}
exports.AgentService = AgentService;
//# sourceMappingURL=AgentService.js.map