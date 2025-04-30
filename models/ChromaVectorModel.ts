import { OpenAIEmbeddings } from "@langchain/openai";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { Document } from "@langchain/core/documents";
import { logger } from '../utils/logger';
import type { VectorStoreRetriever } from "@langchain/core/vectorstores"; // Import Retriever type
// Add this import for raw Chroma Client if needed for metadata checks, but ideally avoid
// import { ChromaClient, CollectionMetadata } from 'chromadb';

// Remove direct chromadb client imports
// import { ChromaClient, Collection, type Embedding, type Metadata } from 'chromadb';
// Keep ObjectChunk if it's used elsewhere, otherwise can remove if only used for old types
// import { ObjectChunk } from '../shared/types';

// Define a more flexible type for metadata filtering, allowing Chroma operators
type ChromaWhereFilterValue = string | number | boolean | string[] | number[] | { $in?: (string | number)[]; $nin?: (string | number)[] } | { $gt?: number; $lt?: number; $gte?: number; $lte?: number; };
type ChromaWhereFilter = Record<string, ChromaWhereFilterValue | { $and?: ChromaWhereFilter[]; $or?: ChromaWhereFilter[] }>;
// Or simply use Record<string, any> for maximum flexibility:
// type ChromaWhereFilter = Record<string, any>;

/**
 * Generic interface for vector store operations.
 * Decouples services/agents from specific implementations (Chroma, etc.).
 */
export interface IVectorStoreModel {
    initialize(): Promise<void>;
    addDocuments(documents: Document[], documentIds?: string[]): Promise<string[]>;
    querySimilarByText(queryText: string, k: number, filter?: ChromaWhereFilter): Promise<[Document, number][]>;
    querySimilarByVector(queryVector: number[], k: number, filter?: ChromaWhereFilter): Promise<[Document, number][]>;
    deleteDocumentsByIds(documentIds: string[]): Promise<void>;
    getRetriever(k?: number, filter?: ChromaWhereFilter): Promise<VectorStoreRetriever>;
    isReady(): boolean;
}

const COLLECTION_NAME = 'jeffers_embeddings'; // Consistent collection name
const EMBEDDING_MODEL = "text-embedding-3-small"; // Configurable embedding model

/**
 * Model for interacting with the Chroma vector database using LangChain integration.
 * Handles connection, collection management, and vector operations via LangChain abstractions.
 */
export class ChromaVectorModel implements IVectorStoreModel {
    private vectorStore?: Chroma;
    private initializationPromise: Promise<void> | null = null;
    private embeddings?: OpenAIEmbeddings;
    private isInitialized = false;
    private initializationError: Error | null = null;

    constructor() {
        const apiKeyPresent = !!process.env.OPENAI_API_KEY;
        logger.info(`[ChromaVectorModel Constructor] Checking for OpenAI API Key at construction: ${apiKeyPresent ? 'Found' : 'MISSING!'}`);
        if (!apiKeyPresent) {
             logger.warn('[ChromaVectorModel Constructor] OpenAI API Key is MISSING in environment variables during constructor call!');
        }
        logger.info(`[ChromaVectorModel Constructor] Instance created. Embeddings will be initialized later.`);
    }

    isReady(): boolean {
        return this.isInitialized && !!this.embeddings && !this.initializationError;
    }
    
    async initialize(): Promise<void> {
        if (this.isInitialized && this.embeddings) {
            logger.debug('[ChromaVectorModel Initialize] Already initialized successfully.');
            return;
        }
        if (this.initializationError) {
             logger.warn('[ChromaVectorModel Initialize] Initialization previously failed. Throwing stored error.');
             throw this.initializationError;
        }
        if (this.initializationPromise) {
            logger.debug('[ChromaVectorModel Initialize] Initialization already in progress. Returning existing promise.');
            return this.initializationPromise;
        }

        logger.info('[ChromaVectorModel Initialize] Starting vector store initialization...');
        
        this.initializationPromise = (async () => {
            try {
                const chromaUrl = process.env.CHROMA_URL;
                if (!chromaUrl) {
                    throw new Error('CHROMA_URL environment variable is not set.');
                }
                
                const apiKey = process.env.OPENAI_API_KEY;
                logger.info(`[ChromaVectorModel Initialize] Checking OpenAI API Key inside initialize: ${apiKey ? 'Found' : 'MISSING!'}`);
                 if (!apiKey) {
                     throw new Error('OpenAI API Key is MISSING. Cannot initialize embeddings.');
                 }
                 
                 this.embeddings = new OpenAIEmbeddings({
                    modelName: EMBEDDING_MODEL,
                    openAIApiKey: apiKey,
                 });
                 logger.info(`[ChromaVectorModel Initialize] Initialized OpenAIEmbeddings with model: ${EMBEDDING_MODEL}`);

                logger.info(`[ChromaVectorModel Initialize] Connecting to Chroma: ${chromaUrl}, collection: ${COLLECTION_NAME}`);
                const collectionMetadata = { embedding_model_name: EMBEDDING_MODEL };

                const store = new Chroma(this.embeddings, {
                    collectionName: COLLECTION_NAME,
                    url: chromaUrl,
                    collectionMetadata: collectionMetadata,
                });

                await store.collection?.peek({ limit: 1 });
                logger.info(`[ChromaVectorModel Initialize] Chroma vector store ready for collection '${COLLECTION_NAME}'.`);

                this.vectorStore = store;
                this.isInitialized = true;
                this.initializationError = null;
                logger.info('[ChromaVectorModel Initialize] Initialization successful.');

            } catch (error) {
                this.isInitialized = false;
                this.vectorStore = undefined;
                this.embeddings = undefined;
                this.initializationError = new Error(`Failed to initialize Chroma vector store. Check URL/server status and logs. Original error: ${error instanceof Error ? error.message : String(error)}`);
                logger.error('[ChromaVectorModel Initialize] Initialization failed:', this.initializationError);
                throw this.initializationError;
            } finally {
            }
        })();

        return this.initializationPromise;
    }

    private async ensureVectorStore(): Promise<Chroma> {
         if (this.isReady() && this.vectorStore) {
             return this.vectorStore;
         }

        if (this.initializationError) {
             logger.error('[ChromaVectorModel ensureVectorStore] Access attempted after failed initialization.');
             throw this.initializationError;
        }

        logger.warn('[ChromaVectorModel ensureVectorStore] Access attempted before explicit initialization. Calling initialize()...');
        await this.initialize();

        if (this.isReady() && this.vectorStore) {
            return this.vectorStore;
        } else {
             logger.error('[ChromaVectorModel ensureVectorStore] Initialization did not complete successfully.');
             throw this.initializationError || new Error("Vector store is not available after initialization attempt.");
        }
    }
    
    async addDocuments(documents: Document[], documentIds?: string[]): Promise<string[]> {
        if (documents.length === 0) {
            logger.debug("[ChromaVectorModel] addDocuments called with empty array.");
            return [];
        }
        if (documentIds && documents.length !== documentIds.length) {
            throw new Error("Number of documents and documentIds must match.");
        }

        const store = await this.ensureVectorStore();
        logger.debug(`[ChromaVectorModel] Adding ${documents.length} documents via LangChain store...`);

        try {
            const usedIds = await store.addDocuments(documents, documentIds ? { ids: documentIds } : undefined);
            logger.info(`[ChromaVectorModel] Successfully added ${documents.length} documents. IDs: [${usedIds.slice(0, 5).join(', ')}...]`);
            return usedIds;
        } catch (error) {
            logger.error(`[ChromaVectorModel] Failed to add documents via LangChain store:`, error);
            throw error;
        }
    }

    async querySimilarByText(
        queryText: string,
        k: number,
        filter?: ChromaWhereFilter
    ): Promise<[Document, number][]> {
        const store = await this.ensureVectorStore();
        logger.debug(`[ChromaVectorModel] Querying collection '${COLLECTION_NAME}' for ${k} nearest neighbors to text: "${queryText.substring(0, 50)}..."`);

        try {
            const results = await store.similaritySearchWithScore(queryText, k, filter);
            logger.debug(`[ChromaVectorModel] Text query returned ${results.length} results.`);
            return results;
        } catch (error) {
            logger.error(`[ChromaVectorModel] Failed to query collection by text:`, error);
            throw error;
        }
    }

     async querySimilarByVector(
        queryVector: number[],
        k: number,
        filter?: ChromaWhereFilter
    ): Promise<[Document, number][]> {
        const store = await this.ensureVectorStore();
        logger.debug(`[ChromaVectorModel] Querying collection '${COLLECTION_NAME}' for ${k} nearest neighbors to vector.`);

        try {
            const results = await store.similaritySearchVectorWithScore(queryVector, k, filter);
            logger.debug(`[ChromaVectorModel] Vector query returned ${results.length} results.`);
            return results;
        } catch (error) {
            logger.error(`[ChromaVectorModel] Failed to query collection by vector:`, error);
            throw error;
        }
    }

    async deleteDocumentsByIds(documentIds: string[]): Promise<void> {
        if (documentIds.length === 0) {
            logger.debug("[ChromaVectorModel] deleteDocumentsByIds called with empty array.");
            return;
        }

        const store = await this.ensureVectorStore();
        logger.warn(`[ChromaVectorModel] Attempting to delete ${documentIds.length} documents by ID from collection '${COLLECTION_NAME}' via LangChain: ${documentIds.join(', ')}`);

        try {
            await store.delete({ ids: documentIds });
            logger.info(`[ChromaVectorModel] Successfully requested deletion of ${documentIds.length} documents.`);
        } catch (error) {
            logger.error(`[ChromaVectorModel] Failed to delete documents by ID via LangChain store:`, error);
            if (error instanceof Error && error.message.includes('Connection')) {
                 throw error;
            }
        }
    }

    async getRetriever(k?: number, filter?: ChromaWhereFilter): Promise<VectorStoreRetriever> {
        const store = await this.ensureVectorStore();
        logger.debug(`[ChromaVectorModel] Getting retriever configured with k=${k}, filter=${JSON.stringify(filter)}`);
        return store.asRetriever(k, filter);
    }
}

export const chromaVectorModel = new ChromaVectorModel(); 