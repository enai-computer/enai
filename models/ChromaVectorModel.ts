import { ChromaClient, Collection, type Embedding, type Metadata } from 'chromadb';
import { logger } from '../utils/logger';
import { ObjectChunk } from '../shared/types'; // Assuming this type exists/will exist

const COLLECTION_NAME = 'jeffers_embeddings'; // Consistent collection name

/**
 * Model for interacting with the Chroma vector database.
 * Handles connection, collection management, and vector operations.
 */
export class ChromaVectorModel {
    private client?: ChromaClient;
    private collection?: Collection;
    private isInitializing = false; // Lock flag for initialization
    private isInitialized = false;  // Status flag

    /**
     * Ensures the Chroma client is connected and the collection handle is cached.
     * Uses a lock to prevent concurrent initialization attempts.
     * Needs CHROMA_URL environment variable.
     * Optionally uses CHROMA_API_KEY for Chroma Cloud authentication.
     * @throws {Error} If connection or collection retrieval fails.
     */
    private async ensureCollection(): Promise<Collection> {
        // Short-circuit if already initialized
        if (this.collection) {
            return this.collection;
        }

        // Prevent concurrent initialization attempts
        if (this.isInitializing) {
            // Wait for initialization to complete
            // Basic busy-wait loop (consider a more robust promise-based lock if needed)
            logger.debug('[ChromaVectorModel] Waiting for ongoing initialization...');
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
            }
            // If initialization succeeded elsewhere, collection should now be set
            if (this.collection) {
                return this.collection;
            }
            // If initialization failed elsewhere, throw an error
            throw new Error('[ChromaVectorModel] Previous initialization attempt failed.');
        }

        // Set lock
        this.isInitializing = true;

        try {
            const chromaUrl = process.env.CHROMA_URL;
            if (!chromaUrl) {
                throw new Error('[ChromaVectorModel] CHROMA_URL environment variable is not set.');
            }

            logger.info(`[ChromaVectorModel] Initializing Chroma client with URL: ${chromaUrl}...`);

            // TODO: Confirm chromadb client version. If >= 0.4, prefer `baseUrl` over `path`.
            // `path` works in >= 0.4 but triggers deprecation warnings.
            this.client = new ChromaClient({ path: chromaUrl });

            // Optional: Add authentication for Chroma Cloud
            const chromaApiKey = process.env.CHROMA_API_KEY;
            if (chromaApiKey) {
                logger.info('[ChromaVectorModel] Using CHROMA_API_KEY for authentication.');
                // TODO: Verify correct auth method for Chroma Cloud (e.g., headers, specific client config)
                // this.client.configure({ headers: { 'Authorization': `Bearer ${chromaApiKey}` } });
            }

            // Ping server only on first successful initialization attempt
            if (!this.isInitialized) {
                 logger.debug('[ChromaVectorModel] Pinging Chroma server...');
                await this.client.heartbeat();
                logger.info('[ChromaVectorModel] Chroma server heartbeat successful.');
            }

            logger.info(`[ChromaVectorModel] Getting or creating collection: ${COLLECTION_NAME}...`);
            this.collection = await this.client.getOrCreateCollection({
                name: COLLECTION_NAME,
            });

            logger.info(`[ChromaVectorModel] Collection '${COLLECTION_NAME}' ready.`);
            this.isInitialized = true; // Mark as initialized successfully
            return this.collection;

        } catch (error) {
            this.isInitialized = false; // Ensure flag is false on error
            logger.error('[ChromaVectorModel] Failed to initialize Chroma client or collection:', error);
            // Rethrow a more specific error for the caller
            throw new Error(`Failed to connect to Chroma or get collection '${COLLECTION_NAME}'. Check URL/server status/auth.`);
        } finally {
            // Release lock regardless of outcome
            this.isInitializing = false;
        }
    }

    /**
     * Stores multiple embedding vectors with their associated metadata and documents.
     *
     * @param vectors - An array of objects, each containing:
     *   - vectorId: Unique ID for the vector (e.g., "<object_id>_<chunk_idx>_<model>").
     *   - embedding: The numerical embedding vector.
     *   - metadata: Key-value pairs (e.g., { objectId: '...', chunkIdx: 0 }).
     *   - document: The original text content of the chunk (optional but recommended).
     */
    async addEmbeddingVectors(
        vectors: { vectorId: string; embedding: Embedding; metadata: Metadata; document?: string }[]
    ): Promise<void> {
        if (vectors.length === 0) return;

        const collection = await this.ensureCollection();
        logger.debug(`[ChromaVectorModel] Adding ${vectors.length} vectors to collection '${COLLECTION_NAME}'...`);

        // Conditionally prepare documents array
        const includeDocuments = vectors.some(v => v.document !== undefined);
        const documentsPayload = includeDocuments ? vectors.map(v => v.document ?? null) : undefined;

        try {
            const addPayload: any = {
                ids: vectors.map(v => v.vectorId),
                embeddings: vectors.map(v => v.embedding),
                metadatas: vectors.map(v => v.metadata),
            };
            // Only include the documents key if there are documents to add
            if (documentsPayload !== undefined) {
                addPayload.documents = documentsPayload;
            }

            await collection.add(addPayload);
            logger.info(`[ChromaVectorModel] Successfully added ${vectors.length} vectors.`);
        } catch (error) {
            logger.error(`[ChromaVectorModel] Failed to add vectors:`, error);
            throw error; // Re-throw for the caller to handle
        }
    }

    /**
     * Stores a single embedding vector.
     * Convenience wrapper around addEmbeddingVectors.
     */
    async addEmbeddingVector(
        vectorId: string,
        embedding: Embedding,
        metadata: Metadata,
        document?: string
    ): Promise<void> {
        await this.addEmbeddingVectors([{ vectorId, embedding, metadata, document }]);
    }

    /**
     * Performs a nearest-neighbor search against the collection.
     */
    async queryNearest(
        queryVector: Embedding,
        k: number,
        where?: object,
        whereDocument?: object
    ): Promise<QueryResponse> {
        const collection = await this.ensureCollection();
        logger.debug(`[ChromaVectorModel] Querying collection '${COLLECTION_NAME}' for ${k} nearest neighbors...`);

        try {
            const results = await collection.query({
                query_embeddings: [queryVector],
                n_results: k,
                where: where,
                where_document: whereDocument
            });

            const response: QueryResponse = {
                ids: results.ids?.[0] ?? [],
                distances: results.distances?.[0] ?? [],
                metadatas: results.metadatas?.[0] ?? [],
                documents: results.documents?.[0] ?? [],
            };
            logger.debug(`[ChromaVectorModel] Query returned ${response.ids.length} results.`);
            return response;
        } catch (error) {
            logger.error(`[ChromaVectorModel] Failed to query collection:`, error);
            throw error;
        }
    }

    /**
     * Deletes vectors from the collection by their IDs.
     */
    async deleteVectors(vectorIds: string[]): Promise<void> {
        if (vectorIds.length === 0) return;

        const collection = await this.ensureCollection();
        logger.warn(`[ChromaVectorModel] Attempting to delete ${vectorIds.length} vectors from collection '${COLLECTION_NAME}': ${vectorIds.join(', ')}`);

        try {
            await collection.delete({ ids: vectorIds });
            logger.info(`[ChromaVectorModel] Successfully attempted deletion of ${vectorIds.length} vectors.`);
        } catch (error) {
            logger.error(`[ChromaVectorModel] Failed to delete vectors:`, error);
            throw error;
        }
    }

    /**
     * Deletes a single vector by its ID.
     */
    async deleteVector(vectorId: string): Promise<void> {
        await this.deleteVectors([vectorId]);
    }

    /**
     * Retrieves vectors by their IDs.
     */
    async getVectorsById(vectorIds: string[]): Promise<GetResult> {
        if (vectorIds.length === 0) return { ids: [], embeddings: [], metadatas: [], documents: [] };

        const collection = await this.ensureCollection();
        logger.debug(`[ChromaVectorModel] Getting ${vectorIds.length} vectors by ID...`);
        try {
            const results = await collection.get({
                ids: vectorIds,
            });
             logger.debug(`[ChromaVectorModel] Got ${results.ids.length} vectors.`);
            return results as GetResult;
        } catch (error) {
             logger.error(`[ChromaVectorModel] Failed to get vectors by ID:`, error);
            throw error;
        }
    }

}

// Define expected response structure for clarity
export interface QueryResponse {
    ids: string[];
    distances: number[];
    metadatas: (Metadata | null)[];
    documents: (string | null)[];
}

// Define expected GetResult structure (align with chromadb type if possible)
interface GetResult {
    ids: string[];
    embeddings: (Embedding | null)[] | null;
    metadatas: (Metadata | null)[] | null;
    documents: (string | null)[] | null;
}

// Export a singleton instance
export const chromaVectorModel = new ChromaVectorModel(); 