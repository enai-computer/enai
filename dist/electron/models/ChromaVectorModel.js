"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chromaVectorModel = exports.ChromaVectorModel = void 0;
const openai_1 = require("@langchain/openai");
const chroma_1 = require("@langchain/community/vectorstores/chroma");
const logger_1 = require("../utils/logger");
const COLLECTION_NAME = 'jeffers_embeddings'; // Consistent collection name
const EMBEDDING_MODEL = "text-embedding-3-small"; // Configurable embedding model
/**
 * Model for interacting with the Chroma vector database using LangChain integration.
 * Handles connection, collection management, and vector operations via LangChain abstractions.
 */
class ChromaVectorModel {
    constructor() {
        this.isInitializing = false; // Lock flag for initialization
        this.isInitialized = false; // Status flag
        // Initialize embeddings instance (ensure OPENAI_API_KEY is in env)
        this.embeddings = new openai_1.OpenAIEmbeddings({
            modelName: EMBEDDING_MODEL,
            openAIApiKey: process.env.OPENAI_API_KEY, // Explicitly pass key if needed, though often picked up
            // batchSize: 512, // Optional: Adjust batch size if needed
        });
        logger_1.logger.info(`[ChromaVectorModel] Initialized OpenAIEmbeddings with model: ${EMBEDDING_MODEL}`);
    }
    /**
     * Ensures the LangChain Chroma vector store client is initialized.
     * Uses a lock to prevent concurrent initialization attempts.
     * Needs CHROMA_URL environment variable.
     * @throws {Error} If connection fails.
     */
    async ensureVectorStore() {
        if (this.vectorStore) {
            return this.vectorStore;
        }
        if (this.isInitializing) {
            logger_1.logger.debug('[ChromaVectorModel] Waiting for ongoing initialization...');
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (this.vectorStore) {
                return this.vectorStore;
            }
            throw new Error('[ChromaVectorModel] Previous initialization attempt failed.');
        }
        this.isInitializing = true;
        try {
            const chromaUrl = process.env.CHROMA_URL;
            if (!chromaUrl) {
                throw new Error('[ChromaVectorModel] CHROMA_URL environment variable is not set.');
            }
            logger_1.logger.info(`[ChromaVectorModel] Initializing LangChain Chroma store connection to: ${chromaUrl}, collection: ${COLLECTION_NAME}`);
            // Instantiate LangChain's Chroma Vector Store
            // It handles connecting and getting/creating the collection implicitly
            this.vectorStore = new chroma_1.Chroma(this.embeddings, {
                collectionName: COLLECTION_NAME,
                url: chromaUrl,
                // Authentication (if needed for Chroma Cloud) might require specific config
                // depending on LangChain version and Chroma setup. Check LangChain docs.
            });
            // Optional: Perform a simple check if possible/needed.
            // LangChain's Chroma doesn't have an explicit 'heartbeat'.
            // A small, inexpensive operation like counting items could serve as a check,
            // but might be overkill. Initialization itself is usually sufficient.
            // try {
            //    const count = await this.vectorStore.collection?.count();
            //    logger.info(`[ChromaVectorModel] Connection check: Collection '${COLLECTION_NAME}' has ${count} items.`);
            // } catch (checkError) {
            //     logger.warn(`[ChromaVectorModel] Initial connection check failed (might be expected if collection is new):`, checkError);
            //     // Decide whether to throw or just warn
            // }
            logger_1.logger.info(`[ChromaVectorModel] LangChain Chroma vector store ready for collection '${COLLECTION_NAME}'.`);
            this.isInitialized = true;
            return this.vectorStore;
        }
        catch (error) {
            this.isInitialized = false;
            logger_1.logger.error('[ChromaVectorModel] Failed to initialize LangChain Chroma store:', error);
            throw new Error(`Failed to connect to Chroma or initialize collection '${COLLECTION_NAME}' via LangChain. Check URL/server status.`);
        }
        finally {
            this.isInitializing = false;
        }
    }
    /**
     * Adds LangChain Document objects to the Chroma collection.
     * LangChain handles embedding the document.pageContent using the configured embeddings.
     * Returns the IDs used for the added documents.
     *
     * @param documents - An array of LangChain Document objects.
     * @param documentIds - Optional: An array of unique string IDs for each document. If not provided, Chroma generates UUIDs. It's STRONGLY recommended to provide your own IDs (e.g., "<objectId>_<chunkIdx>").
     * @returns A Promise resolving to an array of the document IDs used (either provided or generated by Chroma).
     */
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
            // Use the addDocuments method from LangChain Chroma store
            // The method itself returns the IDs used.
            const usedIds = await store.addDocuments(documents, documentIds ? { ids: documentIds } : undefined);
            logger_1.logger.info(`[ChromaVectorModel] Successfully added ${documents.length} documents. IDs: [${usedIds.slice(0, 5).join(', ')}...]`);
            return usedIds; // Return the IDs
        }
        catch (error) {
            logger_1.logger.error(`[ChromaVectorModel] Failed to add documents via LangChain store:`, error);
            throw error; // Re-throw for the caller to handle
        }
    }
    /**
     * Performs a similarity search based on a query text.
     * Returns documents with their scores.
     *
     * @param queryText - The text to search for.
     * @param k - The number of nearest neighbors to return.
     * @param filter - Optional metadata filter (e.g., { objectId: "some-id" }).
     * @returns A Promise resolving to an array of [Document, score] tuples.
     */
    async querySimilarByText(queryText, k, filter) {
        const store = await this.ensureVectorStore();
        logger_1.logger.debug(`[ChromaVectorModel] Querying collection '${COLLECTION_NAME}' for ${k} nearest neighbors to text: "${queryText.substring(0, 50)}..."`);
        try {
            // Use similaritySearchWithScore for scores
            const results = await store.similaritySearchWithScore(queryText, k, filter);
            logger_1.logger.debug(`[ChromaVectorModel] Text query returned ${results.length} results.`);
            return results;
        }
        catch (error) {
            logger_1.logger.error(`[ChromaVectorModel] Failed to query collection by text:`, error);
            throw error;
        }
    }
    /**
    * Performs a similarity search based on a query vector.
    * Returns documents with their scores.
    *
    * @param queryVector - The embedding vector to search for.
    * @param k - The number of nearest neighbors to return.
    * @param filter - Optional metadata filter.
    * @returns A Promise resolving to an array of [Document, score] tuples.
    */
    async querySimilarByVector(queryVector, k, filter) {
        const store = await this.ensureVectorStore();
        logger_1.logger.debug(`[ChromaVectorModel] Querying collection '${COLLECTION_NAME}' for ${k} nearest neighbors to vector.`);
        try {
            // Use similaritySearchVectorWithScore for scores
            const results = await store.similaritySearchVectorWithScore(queryVector, k, filter);
            logger_1.logger.debug(`[ChromaVectorModel] Vector query returned ${results.length} results.`);
            return results;
        }
        catch (error) {
            logger_1.logger.error(`[ChromaVectorModel] Failed to query collection by vector:`, error);
            throw error;
        }
    }
    /**
     * Deletes documents from the collection by their IDs.
     * Note: Ensure the IDs provided match those used when adding documents.
     *
     * @param documentIds - An array of document IDs to delete.
     */
    async deleteDocumentsByIds(documentIds) {
        if (documentIds.length === 0) {
            logger_1.logger.debug("[ChromaVectorModel] deleteDocumentsByIds called with empty array.");
            return;
        }
        const store = await this.ensureVectorStore();
        logger_1.logger.warn(`[ChromaVectorModel] Attempting to delete ${documentIds.length} documents by ID from collection '${COLLECTION_NAME}' via LangChain: ${documentIds.join(', ')}`);
        try {
            // Use the delete method from LangChain Chroma store
            await store.delete({ ids: documentIds });
            logger_1.logger.info(`[ChromaVectorModel] Successfully requested deletion of ${documentIds.length} documents.`);
        }
        catch (error) {
            // LangChain's delete might not throw if IDs don't exist, depending on version/implementation.
            // Log potential issues but might not need to re-throw unless it's a connection error.
            logger_1.logger.error(`[ChromaVectorModel] Failed to delete documents by ID via LangChain store:`, error);
            // Decide whether to re-throw based on error type
            if (error instanceof Error && error.message.includes('Connection')) {
                throw error;
            }
        }
    }
}
exports.ChromaVectorModel = ChromaVectorModel;
// Export a singleton instance
exports.chromaVectorModel = new ChromaVectorModel();
//# sourceMappingURL=ChromaVectorModel.js.map