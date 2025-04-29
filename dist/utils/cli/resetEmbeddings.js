"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chromadb_1 = require("chromadb"); // Import the raw client
const db_js_1 = require("../../models/db.js"); // Import initDb and rename closeDb
const logger_js_1 = require("../logger.js"); // Adjust path as needed - ADDED .js
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url"); // Import fileURLToPath
// Calculate __dirname for ESM
const __filename = (0, url_1.fileURLToPath)(import.meta.url);
const __dirname = path_1.default.dirname(__filename);
// Load .env from root using calculated __dirname
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
// --- Configuration ---
// Ensure this matches the name used in ChromaVectorModel.ts
const COLLECTION_NAME = 'jeffers_embeddings';
// Statuses to reset so they get picked up by the embedding process again
const STATUSES_TO_RESET_FROM = ['chunked', 'embedding', 'embedded', 'embedding_failed'];
// The status to set objects to, triggering re-embedding
const RESET_STATUS_TO = 'parsed';
// --- End Configuration ---
/**
 * Deletes the Chroma collection, clears the SQL embeddings table,
 * and resets relevant object statuses to trigger re-embedding.
 */
async function resetAllEmbeddings() {
    var _a;
    logger_js_1.logger.info('--- Starting Embedding Reset ---');
    let db = null; // Variable to hold script's DB connection
    // --- 1. Initialize DB for this script ---
    try {
        // initDb() without path uses getDbPath() which checks env or uses default
        db = (0, db_js_1.initDb)();
        logger_js_1.logger.info(`[Reset Script] Database connection initialized for script.`);
    }
    catch (dbInitError) {
        logger_js_1.logger.error('[Reset Script] CRITICAL: Failed to initialize database for script:', dbInitError);
        // Cannot proceed without DB
        return;
    }
    // --- 2. Delete Chroma Collection ---
    const chromaUrl = process.env.CHROMA_URL;
    if (!chromaUrl) {
        logger_js_1.logger.error('[Reset Script] CHROMA_URL environment variable is not set. Cannot reset Chroma.');
        // Optionally, decide if you want to proceed with SQL cleanup anyway
        // return; // Exit if Chroma URL is missing
    }
    else {
        logger_js_1.logger.info(`Attempting to delete Chroma collection '${COLLECTION_NAME}' at ${chromaUrl}...`);
        try {
            // Note: Ensure CHROMA_URL is the correct HTTP URL for the client
            const chromaClient = new chromadb_1.ChromaClient({ path: chromaUrl });
            await chromaClient.deleteCollection({ name: COLLECTION_NAME });
            logger_js_1.logger.info(`Chroma collection '${COLLECTION_NAME}' deleted successfully (or did not exist).`);
        }
        catch (error) {
            // Handle cases where deletion might fail (e.g., permissions)
            // ChromaClient might throw specific errors if the collection doesn't exist,
            // depending on the client version. Adjust logging if needed.
            if ((_a = error.message) === null || _a === void 0 ? void 0 : _a.includes('does not exist')) { // Example error check
                logger_js_1.logger.warn(`Chroma collection '${COLLECTION_NAME}' did not exist.`);
            }
            else {
                logger_js_1.logger.error(`Failed to delete Chroma collection '${COLLECTION_NAME}':`, error);
                // Decide if you want to stop the script here
                // return;
            }
        }
    }
    // --- 3. Delete SQL Embedding Records ---
    // Use the db handle initialized specifically for this script
    logger_js_1.logger.info('Attempting to delete all records from SQL `embeddings` table...');
    try {
        const deleteEmbeddingsStmt = db.prepare('DELETE FROM embeddings');
        const info = deleteEmbeddingsStmt.run();
        logger_js_1.logger.info(`Deleted ${info.changes} records from the SQL \`embeddings\` table.`);
    }
    catch (error) {
        logger_js_1.logger.error('Failed to delete records from SQL `embeddings` table:', error);
        // Decide if you want to stop the script here
        // return;
    }
    // --- 4. Reset Object Statuses ---
    // Use the script's db handle
    if (STATUSES_TO_RESET_FROM.length > 0) {
        logger_js_1.logger.info(`Attempting to reset object statuses from [${STATUSES_TO_RESET_FROM.join(', ')}] to '${RESET_STATUS_TO}'...`);
        try {
            const placeholders = STATUSES_TO_RESET_FROM.map(() => '?').join(', ');
            const resetStatusStmt = db.prepare(`UPDATE objects SET status = ? WHERE status IN (${placeholders})`);
            const info = resetStatusStmt.run(RESET_STATUS_TO, ...STATUSES_TO_RESET_FROM);
            logger_js_1.logger.info(`Reset status to '${RESET_STATUS_TO}' for ${info.changes} objects.`);
        }
        catch (error) {
            logger_js_1.logger.error('Failed to reset object statuses in SQL `objects` table:', error);
        }
    }
    else {
        logger_js_1.logger.warn('No statuses defined to reset. Skipping object status reset.');
    }
    logger_js_1.logger.info('--- Embedding Reset Script Finished ---');
    // --- 5. Close the script's DB connection ---
    if (db && db.open) {
        logger_js_1.logger.info('[Reset Script] Closing script-specific database connection...');
        // Note: We renamed the imported closeDb to avoid name clash if it operates on singleton
        // Here we directly call close() on the instance we created.
        db.close();
        logger_js_1.logger.info('[Reset Script] Script database connection closed.');
    }
}
// --- Execute the reset ---
resetAllEmbeddings()
    .catch(err => {
    logger_js_1.logger.error('Unhandled error during embedding reset:', err);
    process.exit(1); // Exit with error code
});
//# sourceMappingURL=resetEmbeddings.js.map