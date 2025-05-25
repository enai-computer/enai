"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exaService = exports.ExaService = void 0;
const logger_1 = require("../utils/logger");
/**
 * Service for interacting with the Exa.ai API.
 * Provides methods for neural search, content retrieval, and finding similar content.
 * This service is stateless and focuses purely on API interaction.
 */
class ExaService {
    constructor() {
        this.baseUrl = 'https://api.exa.ai/';
        this.apiKey = process.env.EXA_API_KEY;
        if (!this.apiKey) {
            logger_1.logger.warn('[ExaService] EXA_API_KEY not found in environment variables. ExaService will not be functional.');
        }
        logger_1.logger.info('[ExaService] Initialized.');
    }
    /**
     * Checks if the service is properly configured with an API key.
     */
    isConfigured() {
        return !!this.apiKey;
    }
    /**
     * Performs a search using Exa's neural search capabilities.
     * @param query The search query
     * @param options Additional search options
     * @returns Search results with scores and metadata
     */
    async search(query, options = {}) {
        if (!this.isConfigured()) {
            throw new Error('ExaService is not configured. Missing EXA_API_KEY.');
        }
        logger_1.logger.debug(`[ExaService] Searching for: "${query}" with options:`, options);
        try {
            const requestBody = {
                query,
                numResults: options.numResults || 10,
                type: options.type || 'neural',
                useAutoprompt: options.useAutoprompt ?? true,
                ...options,
            };
            const response = await fetch(`${this.baseUrl}search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                },
                body: JSON.stringify(requestBody),
            });
            if (!response.ok) {
                const errorData = await response.text();
                logger_1.logger.error(`[ExaService] Search API error: ${response.status} ${response.statusText}`, errorData);
                throw new Error(`Exa API Error: ${response.statusText}`);
            }
            const data = await response.json();
            logger_1.logger.info(`[ExaService] Search returned ${data.results.length} results for query: "${query}"`);
            return data;
        }
        catch (error) {
            logger_1.logger.error(`[ExaService] Error during search:`, error);
            throw error;
        }
    }
    /**
     * Retrieves the contents of specific URLs.
     * @param ids Array of Exa result IDs
     * @param options Content retrieval options
     * @returns Content for the requested IDs
     */
    async getContents(ids, options = {}) {
        if (!this.isConfigured()) {
            throw new Error('ExaService is not configured. Missing EXA_API_KEY.');
        }
        if (ids.length === 0) {
            logger_1.logger.debug('[ExaService] getContents called with empty IDs array.');
            return { results: [] };
        }
        logger_1.logger.debug(`[ExaService] Retrieving contents for ${ids.length} IDs with options:`, options);
        try {
            const requestBody = {
                ids,
                text: options.text ?? true,
                highlights: options.highlights ?? false,
                summary: options.summary ?? false,
            };
            const response = await fetch(`${this.baseUrl}contents`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                },
                body: JSON.stringify(requestBody),
            });
            if (!response.ok) {
                const errorData = await response.text();
                logger_1.logger.error(`[ExaService] Contents API error: ${response.status} ${response.statusText}`, errorData);
                throw new Error(`Exa API Error: ${response.statusText}`);
            }
            const data = await response.json();
            logger_1.logger.info(`[ExaService] Retrieved contents for ${data.results.length} items`);
            return data;
        }
        catch (error) {
            logger_1.logger.error(`[ExaService] Error retrieving contents:`, error);
            throw error;
        }
    }
    /**
     * Finds content similar to a given URL.
     * @param options Find similar options including the source URL
     * @returns Similar content results
     */
    async findSimilar(options) {
        if (!this.isConfigured()) {
            throw new Error('ExaService is not configured. Missing EXA_API_KEY.');
        }
        logger_1.logger.debug(`[ExaService] Finding similar content to: "${options.url}" with options:`, options);
        try {
            const { url, excludeSourceDomain = true, ...searchOptions } = options;
            const requestBody = {
                url,
                excludeSourceDomain,
                numResults: searchOptions.numResults || 10,
                ...searchOptions,
            };
            const response = await fetch(`${this.baseUrl}findSimilar`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                },
                body: JSON.stringify(requestBody),
            });
            if (!response.ok) {
                const errorData = await response.text();
                logger_1.logger.error(`[ExaService] FindSimilar API error: ${response.status} ${response.statusText}`, errorData);
                throw new Error(`Exa API Error: ${response.statusText}`);
            }
            const data = await response.json();
            logger_1.logger.info(`[ExaService] Found ${data.results.length} similar results for URL: "${url}"`);
            return data;
        }
        catch (error) {
            logger_1.logger.error(`[ExaService] Error finding similar content:`, error);
            throw error;
        }
    }
}
exports.ExaService = ExaService;
// Export singleton instance
exports.exaService = new ExaService();
//# sourceMappingURL=ExaService.js.map