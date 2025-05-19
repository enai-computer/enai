import { ChromaClient } from 'chromadb'; // Import the raw client
import { initDb, closeDb as closeSpecificDb } from '../../models/db.js'; // Import initDb and rename closeDb
import { logger } from '../logger.js'; // Adjust path as needed - ADDED .js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url'; // Import fileURLToPath
import type Database from 'better-sqlite3';

// Calculate __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root using calculated __dirname
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// --- Configuration ---
// Ensure this matches the name used in ChromaVectorModel.ts
const COLLECTION_NAME = 'jeffers_embeddings';
// Statuses to reset so they get picked up by the embedding process again
const STATUSES_TO_RESET_FROM: string[] = ['chunked', 'embedding', 'embedded', 'embedding_failed'];
// The status to set objects to, triggering re-embedding
const RESET_STATUS_TO: string = 'parsed';
// --- End Configuration ---

/**
 * Deletes the Chroma collection, clears the SQL embeddings table,
 * and resets relevant object statuses to trigger re-embedding.
 */
async function resetAllEmbeddings() {
    logger.info('--- Starting Embedding Reset ---');
    let db: Database | null = null; // Variable to hold script's DB connection

    // --- 1. Initialize DB for this script ---
    try {
        // initDb() without path uses getDbPath() which checks env or uses default
        db = initDb();
        logger.info(`[Reset Script] Database connection initialized for script.`);
    } catch (dbInitError) {
         logger.error('[Reset Script] CRITICAL: Failed to initialize database for script:', dbInitError);
         // Cannot proceed without DB
         return;
    }


    // --- 2. Delete Chroma Collection ---
    const chromaUrl = process.env.CHROMA_URL;
    if (!chromaUrl) {
        logger.error('[Reset Script] CHROMA_URL environment variable is not set. Cannot reset Chroma.');
        // Optionally, decide if you want to proceed with SQL cleanup anyway
        // return; // Exit if Chroma URL is missing
    } else {
        logger.info(`Attempting to delete Chroma collection '${COLLECTION_NAME}' at ${chromaUrl}...`);
        try {
            // Note: Ensure CHROMA_URL is the correct HTTP URL for the client
            const chromaClient = new ChromaClient({ path: chromaUrl });
            await chromaClient.deleteCollection({ name: COLLECTION_NAME });
            logger.info(`Chroma collection '${COLLECTION_NAME}' deleted successfully (or did not exist).`);
        } catch (error: any) {
            // Handle cases where deletion might fail (e.g., permissions)
            // ChromaClient might throw specific errors if the collection doesn't exist,
            // depending on the client version. Adjust logging if needed.
            if (error.message?.includes('does not exist')) { // Example error check
                 logger.warn(`Chroma collection '${COLLECTION_NAME}' did not exist.`);
            } else {
                logger.error(`Failed to delete Chroma collection '${COLLECTION_NAME}':`, error);
                // Decide if you want to stop the script here
                // return;
            }
        }
    }


    // --- 3. Delete SQL Embedding Records ---
    // Use the db handle initialized specifically for this script
    logger.info('Attempting to delete all records from SQL `embeddings` table...');
    try {
        const deleteEmbeddingsStmt = db.prepare('DELETE FROM embeddings');
        const info = deleteEmbeddingsStmt.run();
        logger.info(`Deleted ${info.changes} records from the SQL \`embeddings\` table.`);
    } catch (error) {
        logger.error('Failed to delete records from SQL `embeddings` table:', error);
        // Decide if you want to stop the script here
        // return;
    }

    // --- 4. Reset Object Statuses ---
    // Use the script's db handle
    if (STATUSES_TO_RESET_FROM.length > 0) {
        logger.info(`Attempting to reset object statuses from [${STATUSES_TO_RESET_FROM.join(', ')}] to '${RESET_STATUS_TO}'...`);
        try {
            const placeholders = STATUSES_TO_RESET_FROM.map(() => '?').join(', ');
            const resetStatusStmt = db.prepare(
                `UPDATE objects SET status = ? WHERE status IN (${placeholders})`
            );
            const info = resetStatusStmt.run(RESET_STATUS_TO, ...STATUSES_TO_RESET_FROM);
            logger.info(`Reset status to '${RESET_STATUS_TO}' for ${info.changes} objects.`);
        } catch (error) {
             logger.error('Failed to reset object statuses in SQL `objects` table:', error);
        }
    } else {
         logger.warn('No statuses defined to reset. Skipping object status reset.');
    }

    logger.info('--- Embedding Reset Script Finished ---');

    // --- 5. Close the script's DB connection ---
    if (db && db.open) {
        logger.info('[Reset Script] Closing script-specific database connection...');
        // Note: We renamed the imported closeDb to avoid name clash if it operates on singleton
        // Here we directly call close() on the instance we created.
        db.close();
        logger.info('[Reset Script] Script database connection closed.');
    }
}

// --- Execute the reset ---
resetAllEmbeddings()
    .catch(err => {
        logger.error('Unhandled error during embedding reset:', err);
        process.exit(1); // Exit with error code
    });
