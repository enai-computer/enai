"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChromaVectorModel = void 0;
const chroma_1 = require("@langchain/community/vectorstores/chroma");
const logger_1 = require("../utils/logger");
const COLLECTION_NAME = 'jeffers_embeddings'; // Consistent collection name
/**
 * Model for interacting with the Chroma vector database using LangChain integration.
 * Handles connection, collection management, and vector operations via LangChain abstractions.
 */
class ChromaVectorModel {
    constructor(llmService) {
        this.initializationPromise = null;
        this.isInitialized = false;
        this.initializationError = null;
        this.llmService = llmService;
        logger_1.logger.info(`[ChromaVectorModel Constructor] Initialized with LLMService`);
    }
    isReady() {
        return this.isInitialized && !!this.embeddings && !this.initializationError;
    }
    async initialize() {
        if (this.isInitialized && this.embeddings) {
            logger_1.logger.debug('[ChromaVectorModel Initialize] Already initialized successfully.');
            return;
        }
        if (this.initializationError) {
            logger_1.logger.warn('[ChromaVectorModel Initialize] Initialization previously failed. Throwing stored error.');
            throw this.initializationError;
        }
        if (this.initializationPromise) {
            logger_1.logger.debug('[ChromaVectorModel Initialize] Initialization already in progress. Returning existing promise.');
            return this.initializationPromise;
        }
        logger_1.logger.info('[ChromaVectorModel Initialize] Starting vector store initialization...');
        this.initializationPromise = (async () => {
            try {
                const chromaUrl = process.env.CHROMA_URL;
                if (!chromaUrl) {
                    throw new Error('CHROMA_URL environment variable is not set.');
                }
                // Get embeddings from LLMService
                this.embeddings = this.llmService.getLangchainEmbeddings();
                logger_1.logger.info(`[ChromaVectorModel Initialize] Retrieved embeddings from LLMService`);
                logger_1.logger.info(`[ChromaVectorModel Initialize] Connecting to Chroma: ${chromaUrl}, collection: ${COLLECTION_NAME}`);
                const collectionMetadata = { embedding_model_name: 'text-embedding-3-small' };
                const store = new chroma_1.Chroma(this.embeddings, {
                    collectionName: COLLECTION_NAME,
                    url: chromaUrl,
                    collectionMetadata: collectionMetadata,
                });
                await store.collection?.peek({ limit: 1 });
                logger_1.logger.info(`[ChromaVectorModel Initialize] Chroma vector store ready for collection '${COLLECTION_NAME}'.`);
                this.vectorStore = store;
                this.isInitialized = true;
                this.initializationError = null;
                logger_1.logger.info('[ChromaVectorModel Initialize] Initialization successful.');
            }
            catch (error) {
                this.isInitialized = false;
                this.vectorStore = undefined;
                this.embeddings = undefined;
                this.initializationError = new Error(`Failed to initialize Chroma vector store. Check URL/server status and logs. Original error: ${error instanceof Error ? error.message : String(error)}`);
                logger_1.logger.error('[ChromaVectorModel Initialize] Initialization failed:', this.initializationError);
                throw this.initializationError;
            }
            finally {
            }
        })();
        return this.initializationPromise;
    }
    async ensureVectorStore() {
        if (this.isReady() && this.vectorStore) {
            return this.vectorStore;
        }
        if (this.initializationError) {
            logger_1.logger.error('[ChromaVectorModel ensureVectorStore] Access attempted after failed initialization.');
            throw this.initializationError;
        }
        logger_1.logger.warn('[ChromaVectorModel ensureVectorStore] Access attempted before explicit initialization. Calling initialize()...');
        await this.initialize();
        if (this.isReady() && this.vectorStore) {
            return this.vectorStore;
        }
        else {
            logger_1.logger.error('[ChromaVectorModel ensureVectorStore] Initialization did not complete successfully.');
            throw this.initializationError || new Error("Vector store is not available after initialization attempt.");
        }
    }
    async addDocuments(documents, documentIds) {
        if (documents.length === 0) {
            logger_1.logger.debug("[ChromaVectorModel] addDocuments called with empty array.");
            return [];
        }
        if (documentIds && documents.length !== documentIds.length) {
            throw new Error("Number of documents and documentIds must match.");
        }
        const store = await this.ensureVectorStore();
        logger_1.logger.debug(`[ChromaVectorModel] Adding ${documents.length} documents via LangChain store...`);
        try {
            const usedIds = await store.addDocuments(documents, documentIds ? { ids: documentIds } : undefined);
            logger_1.logger.info(`[ChromaVectorModel] Successfully added ${documents.length} documents. IDs: [${usedIds.slice(0, 5).join(', ')}...]`);
            return usedIds;
        }
        catch (error) {
            logger_1.logger.error(`[ChromaVectorModel] Failed to add documents via LangChain store:`, error);
            throw error;
        }
    }
    async querySimilarByText(queryText, k, filter) {
        const store = await this.ensureVectorStore();
        logger_1.logger.debug(`[ChromaVectorModel] Querying collection '${COLLECTION_NAME}' for ${k} nearest neighbors to text: "${queryText.substring(0, 50)}..."`);
        try {
            const results = await store.similaritySearchWithScore(queryText, k, filter);
            logger_1.logger.debug(`[ChromaVectorModel] Text query returned ${results.length} results.`);
            return results;
        }
        catch (error) {
            logger_1.logger.error(`[ChromaVectorModel] Failed to query collection by text:`, error);
            throw error;
        }
    }
    async querySimilarByVector(queryVector, k, filter) {
        const store = await this.ensureVectorStore();
        logger_1.logger.debug(`[ChromaVectorModel] Querying collection '${COLLECTION_NAME}' for ${k} nearest neighbors to vector.`);
        try {
            const results = await store.similaritySearchVectorWithScore(queryVector, k, filter);
            logger_1.logger.debug(`[ChromaVectorModel] Vector query returned ${results.length} results.`);
            return results;
        }
        catch (error) {
            logger_1.logger.error(`[ChromaVectorModel] Failed to query collection by vector:`, error);
            throw error;
        }
    }
    async deleteDocumentsByIds(documentIds) {
        if (documentIds.length === 0) {
            logger_1.logger.debug("[ChromaVectorModel] deleteDocumentsByIds called with empty array.");
            return;
        }
        const store = await this.ensureVectorStore();
        logger_1.logger.warn(`[ChromaVectorModel] Attempting to delete ${documentIds.length} documents by ID from collection '${COLLECTION_NAME}' via LangChain: ${documentIds.join(', ')}`);
        try {
            await store.delete({ ids: documentIds });
            logger_1.logger.info(`[ChromaVectorModel] Successfully requested deletion of ${documentIds.length} documents.`);
        }
        catch (error) {
            logger_1.logger.error(`[ChromaVectorModel] Failed to delete documents by ID via LangChain store:`, error);
            if (error instanceof Error && error.message.includes('Connection')) {
                throw error;
            }
        }
    }
    async getRetriever(k, filter) {
        const store = await this.ensureVectorStore();
        logger_1.logger.debug(`[ChromaVectorModel] Getting retriever configured with k=${k}, filter=${JSON.stringify(filter)}`);
        return store.asRetriever(k, filter);
    }
}
exports.ChromaVectorModel = ChromaVectorModel;
//# sourceMappingURL=ChromaVectorModel.js.map