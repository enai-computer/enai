import { ChromaClient, Collection, IEmbeddingFunction } from 'chromadb'; // Add IEmbeddingFunction
import { Database } from 'better-sqlite3'; // Assuming better-sqlite3
import { logger } from './logger'; // Assuming logger path

const SAMPLE_SIZE = 5; // How many IDs to check (adjust as needed)
const CHROMA_COLLECTION_NAME = 'chunks'; // Define collection name centrally

/**
 * Verifies that a sample of chunk IDs from SQLite exists in ChromaDB.
 * Throws an error if inconsistency is detected, preventing API server startup.
 * @param chromaClient Initialized ChromaDB client instance.
 * @param db Initialized SQLite database instance (e.g., from better-sqlite3).
 * @param embeddingFunction The embedding function used for the Chroma collection.
 */
export async function checkChunkIdConsistency(
    chromaClient: ChromaClient,
    db: Database,
    embeddingFunction: IEmbeddingFunction // Added parameter
): Promise<void> {
    logger.info('[Startup Check] Performing Chunk ID consistency check...');
    let sampleChunkIds: string[] = [];

    try {
        // 1. Get a sample of chunk IDs from SQLite
        // IMPORTANT: Ensure your chunks table *actually* has a column named 'chunk_id'
        // Based on migration 0004, the primary key is 'id' (autoincrement) and object_id maps to objects.
        // If the canonical ID stored in Chroma is the OBJECT id + chunk index, we need to query differently.
        // **Assuming** the `chunk_id` column *was* added later or the intent is to check a different ID.
        // **If `chunk_id` is NOT the correct column storing the ID that's put into Chroma, this query MUST be changed.**
        const rows = db.prepare(`SELECT chunk_id FROM chunks LIMIT ${SAMPLE_SIZE}`).all() as { chunk_id: string }[];
        sampleChunkIds = rows.map(row => row.chunk_id);

        if (sampleChunkIds.length === 0) {
            logger.info('[Startup Check] No chunks found in SQLite, skipping consistency check.');
            return; // Nothing to check if DB is empty
        }
        logger.debug(`[Startup Check] Sample SQLite chunk IDs: [${sampleChunkIds.join(', ')}]`);

        // 2. Get the Chroma collection
        let collection: Collection;
        try {
            // Pass the embedding function here
            collection = await chromaClient.getCollection({ 
                name: CHROMA_COLLECTION_NAME, 
                embeddingFunction: embeddingFunction 
            });
        } catch (collectionError: any) {
            // Handle specific error for collection not found
            if (collectionError.message?.includes('Could not find collection')) {
                logger.warn(`[Startup Check] Chroma collection '${CHROMA_COLLECTION_NAME}' not found. Skipping check (likely first run or empty collection).`);
                return; // Allow startup if collection doesn't exist yet
            }
            // Rethrow other errors related to getting the collection
            throw new Error(`Failed to get Chroma collection '${CHROMA_COLLECTION_NAME}': ${collectionError.message}`);
        }

        // 3. Attempt to retrieve these IDs from the Chroma Collection
        // We only need to check existence, so don't need embeddings/metadata
        const chromaResult = await collection.get({
            ids: sampleChunkIds,
            include: [], // Don't include embedding, metadata, or document
        });

        // 4. Validate results
        const foundIds = new Set(chromaResult.ids);
        const missingIds = sampleChunkIds.filter(id => !foundIds.has(id));

        if (missingIds.length > 0) {
            logger.error(`[Startup Check] FAILED: Found ${missingIds.length} chunk ID(s) in SQLite that are MISSING in Chroma collection '${CHROMA_COLLECTION_NAME}'!`);
            logger.error(`[Startup Check] Missing IDs: [${missingIds.join(', ')}]`);
            logger.error('[Startup Check] This indicates a potential problem with the ingestion pipeline or data corruption.');
            throw new Error('Chunk ID consistency check failed. Mismatch between SQLite and ChromaDB.');
        }

        logger.info(`[Startup Check] PASSED: Verified ${sampleChunkIds.length} chunk IDs exist in both SQLite and Chroma collection '${CHROMA_COLLECTION_NAME}'.`);

    } catch (error: any) {
        // Catch errors from SQLite query or the rethrown Chroma errors
        logger.error(`[Startup Check] Error during consistency check: ${error.message}`);
        // Rethrow the error to prevent startup unless it was the handled 'collection not found' case
        throw new Error(`Chunk ID consistency check failed: ${error.message}`);
    }
} 