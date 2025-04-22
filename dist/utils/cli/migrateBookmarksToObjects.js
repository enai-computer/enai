#!/usr/bin/env node
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path")); // Import path
const db_1 = __importStar(require("../../models/db")); // Adjusted path relative to utils/cli, ADDED initDb import
const BookmarkModel = __importStar(require("../../models/BookmarkModel")); // Adjusted path
const logger_1 = require("../../utils/logger"); // Adjusted path
async function migrate(dryRun) {
    logger_1.logger.info(`[MigrateBookmarks] Starting migration ${dryRun ? '(DRY RUN)' : ''}...`);
    // Initialize DB connection first for standalone script context
    try {
        // Construct the default path relative to the project root
        // __dirname will be dist/utils/cli, so ../../.. goes to project root
        const dbPath = path_1.default.resolve(__dirname, '../../..', 'data', 'jeffers.db');
        logger_1.logger.info(`[MigrateBookmarks] Initializing database at: ${dbPath}`);
        (0, db_1.initDb)(dbPath); // Pass the calculated path
        logger_1.logger.info('[MigrateBookmarks] Database initialized by script.');
    }
    catch (initError) {
        logger_1.logger.error('[MigrateBookmarks] CRITICAL: Failed to initialize database for migration script:', initError);
        throw initError; // Stop if DB can't be initialized
    }
    const db = (0, db_1.default)(); // Now this call should succeed
    let insertedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const insertedUris = new Set();
    try {
        // 1. Fetch all existing bookmarks (ID and URL)
        logger_1.logger.info('[MigrateBookmarks] Fetching existing bookmarks...');
        const bookmarks = BookmarkModel.getAllBookmarksForMigration();
        logger_1.logger.info(`[MigrateBookmarks] Found ${bookmarks.length} bookmarks.`);
        if (bookmarks.length === 0) {
            logger_1.logger.info('[MigrateBookmarks] No bookmarks found to migrate.');
            return;
        }
        // 2. Fetch relevant content data in bulk (keyed by bookmark_id)
        logger_1.logger.info('[MigrateBookmarks] Fetching associated content data...');
        const contentStmt = db.prepare('SELECT bookmark_id, title, status, fetched_at FROM content');
        const contentRows = contentStmt.all();
        const contentMap = new Map();
        contentRows.forEach(row => {
            // Ensure bookmark_id is treated as string for map key consistency
            const key = String(row.bookmark_id);
            contentMap.set(key, { title: row.title, status: row.status, fetched_at: row.fetched_at });
        });
        logger_1.logger.info(`[MigrateBookmarks] Found content data for ${contentMap.size} bookmarks.`);
        // 3. Prepare insert statement
        const insertStmt = db.prepare(`
      INSERT INTO objects (id, object_type, source_uri, title, status, parsed_at, created_at, updated_at, raw_content_ref)
      VALUES (@id, @object_type, @source_uri, @title, @status, @parsed_at, @created_at, @updated_at, @raw_content_ref)
    `);
        // 4. Define the transaction function
        const runMigrationTransaction = db.transaction(() => {
            var _a, _b;
            const now = new Date().toISOString();
            for (const bookmark of bookmarks) {
                const bookmarkIdStr = String(bookmark.bookmark_id);
                const content = contentMap.get(bookmarkIdStr);
                const sourceUri = bookmark.url;
                logger_1.logger.debug(`[MigrateBookmarks] PENDING: Processing bookmark ID ${bookmarkIdStr}, URL: ${sourceUri}`);
                // Check for duplicate source_uri
                if (insertedUris.has(sourceUri)) {
                    logger_1.logger.warn(`[MigrateBookmarks] SKIPPED-DUP: Duplicate source_uri found: ${sourceUri} (Bookmark ID: ${bookmarkIdStr})`);
                    skippedCount++;
                    continue;
                }
                try {
                    const objectId = (0, uuid_1.v4)();
                    const objectType = 'bookmark';
                    // Status based on content status: 'ok' maps to 'parsed', others map to 'error'
                    const objectStatus = (content === null || content === void 0 ? void 0 : content.status) === 'ok' ? 'parsed' : 'error';
                    // Use content title if available, otherwise null
                    const title = (_a = content === null || content === void 0 ? void 0 : content.title) !== null && _a !== void 0 ? _a : null;
                    // Use content fetched_at as parsed_at, fallback to now()
                    const parsedAt = (_b = content === null || content === void 0 ? void 0 : content.fetched_at) !== null && _b !== void 0 ? _b : now;
                    // Timestamps: Default to now() as reliable source timestamps aren't readily available
                    const createdAt = now;
                    const updatedAt = now;
                    // raw_content_ref is not available from old schema, set to null
                    const rawContentRef = null;
                    if (dryRun) {
                        logger_1.logger.info(`[MigrateBookmarks] DRY RUN: Would insert object ID ${objectId} for URL ${sourceUri} with status ${objectStatus}`);
                    }
                    else {
                        insertStmt.run({
                            id: objectId,
                            object_type: objectType,
                            source_uri: sourceUri,
                            title: title,
                            status: objectStatus,
                            parsed_at: parsedAt,
                            created_at: createdAt,
                            updated_at: updatedAt,
                            raw_content_ref: rawContentRef,
                        });
                    }
                    insertedUris.add(sourceUri);
                    insertedCount++;
                    logger_1.logger.debug(`[MigrateBookmarks] OK: Processed bookmark ID ${bookmarkIdStr}`);
                }
                catch (insertError) {
                    logger_1.logger.error(`[MigrateBookmarks] ERROR: Failed to process bookmark ID ${bookmarkIdStr} (URL: ${sourceUri}):`, insertError);
                    errorCount++;
                    // Continue processing other bookmarks even if one fails
                }
            } // End loop
        }); // End transaction definition
        // 5. Execute the transaction
        logger_1.logger.info('[MigrateBookmarks] Starting migration transaction...');
        runMigrationTransaction();
        logger_1.logger.info('[MigrateBookmarks] Migration transaction finished.');
    }
    catch (error) {
        logger_1.logger.error('[MigrateBookmarks] CRITICAL: Migration script failed:', error);
        errorCount++; // Increment error count for the final summary
        throw error; // Re-throw to be caught by the main execution block
    }
    finally {
        // 6. Log final counts
        logger_1.logger.info('--- Migration Summary ---');
        // logger.info(`Attempted: ${bookmarks?.length ?? 0}`); // Error: bookmarks not in scope here
        // We need to declare bookmarks outside the try block to access its length here.
        // However, it's less critical than the other counts. We'll log it inside the try block if needed.
        logger_1.logger.info(`Inserted:  ${insertedCount}`);
        logger_1.logger.info(`Skipped:   ${skippedCount} (Duplicate URIs)`);
        logger_1.logger.info(`Errors:    ${errorCount}`);
        logger_1.logger.info('-------------------------');
        if (!dryRun && errorCount === 0 && insertedCount > 0) {
            logger_1.logger.info('[MigrateBookmarks] Migration completed successfully.');
            logger_1.logger.info('Recommendation: Run `.schema objects` and `SELECT COUNT(*) FROM objects WHERE object_type=\'bookmark\';` in sqlite3 to verify.');
        }
        else if (dryRun) {
            logger_1.logger.info('[MigrateBookmarks] Dry run completed.');
        }
        else {
            logger_1.logger.error('[MigrateBookmarks] Migration finished with errors.');
        }
    }
}
// --- Main Execution Block ---
if (require.main === module) {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run') || args.includes('--dry');
    migrate(dryRun)
        .then(() => {
        process.exit(0);
    })
        .catch(err => {
        logger_1.logger.error('[MigrateBookmarks] Uncaught error during migration:', err);
        process.exit(1);
    });
}
//# sourceMappingURL=migrateBookmarksToObjects.js.map