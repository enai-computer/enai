"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerImportBookmarksHandler = registerImportBookmarksHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger_1 = require("../../utils/logger");
const detect_1 = require("../../ingestion/parsers/detect");
// Helper function to send progress updates
function sendProgress(event, progress) {
    try {
        event.sender.send(ipcChannels_1.BOOKMARKS_PROGRESS, progress);
    }
    catch (error) {
        // Handle potential errors if the window is closed during import
        logger_1.logger.warn(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Failed to send progress update:`, error);
    }
}
// Accept ObjectModel and IngestionQueueService instances
function registerImportBookmarksHandler(objectModel, ingestionQueueService) {
    electron_1.ipcMain.handle(ipcChannels_1.BOOKMARKS_IMPORT, async (event, filePath) => {
        logger_1.logger.info(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Received request for path: ${filePath}`);
        if (typeof filePath !== 'string' || filePath.trim() === '') {
            logger_1.logger.error(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Invalid file path received.`);
            throw new Error('Invalid file path provided.');
        }
        let parsedUrls = [];
        let processedCount = 0;
        let newlyCreatedCount = 0;
        let totalBookmarks = 0;
        try {
            // Use the unified parsing function
            sendProgress(event, { processed: 0, total: 0, stage: 'Parsing file...' });
            parsedUrls = await (0, detect_1.parseBookmarkFile)(filePath);
            totalBookmarks = parsedUrls.length;
            logger_1.logger.info(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Parsed ${totalBookmarks} URLs from file.`);
            if (totalBookmarks === 0) {
                sendProgress(event, { processed: 0, total: 0, stage: 'Complete (No URLs found)' });
                return 0; // Nothing to import
            }
            sendProgress(event, { processed: 0, total: totalBookmarks, stage: 'Importing...' });
            // Process Bookmarks (URLs)
            for (const url of parsedUrls) {
                processedCount++;
                let isValidUrl = false;
                try {
                    new URL(url); // Validate URL structure and scheme
                    isValidUrl = url.startsWith('http'); // Ensure http/https
                }
                catch (_) {
                    isValidUrl = false;
                }
                if (!isValidUrl) {
                    logger_1.logger.trace(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Skipping invalid or non-http URL: ${url}`);
                    continue;
                }
                try {
                    let objectToProcess = null;
                    let wasNewlyCreated = false;
                    // 1. Check if object already exists
                    const existingObject = await objectModel.getBySourceUri(url);
                    if (!existingObject) {
                        // 2a. Create new object if it doesn't exist
                        objectToProcess = await objectModel.create({
                            objectType: 'bookmark',
                            sourceUri: url,
                            title: null, // Title is not extracted by parseBookmarkFile
                            status: 'new',
                            rawContentRef: null,
                            parsedContentJson: null,
                            errorInfo: null,
                        });
                        wasNewlyCreated = true;
                        newlyCreatedCount++;
                        logger_1.logger.debug(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Created new object for ${url} with ID ${objectToProcess.id}`);
                    }
                    else {
                        // 2b. Use existing object
                        objectToProcess = existingObject;
                        wasNewlyCreated = false;
                        logger_1.logger.debug(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Found existing object for ${url} with ID ${objectToProcess.id}, status: ${objectToProcess.status}`);
                    }
                    // 3. Queue for ingestion if status is 'new' or 'error'
                    if (objectToProcess && ('new' === objectToProcess.status || 'error' === objectToProcess.status)) {
                        if (objectToProcess.sourceUri) {
                            logger_1.logger.debug(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Queuing object ${objectToProcess.id} (status: ${objectToProcess.status}) for ingestion.`);
                            // Use queue system
                            await ingestionQueueService.addJob('url', objectToProcess.sourceUri, {
                                priority: 0,
                                jobSpecificData: {
                                    relatedObjectId: objectToProcess.id
                                }
                            });
                        }
                        else {
                            // Should not happen if created/fetched correctly
                            logger_1.logger.warn(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Object ${objectToProcess.id} selected for queueing but lacks a sourceUri.`);
                        }
                    }
                }
                catch (dbError) {
                    // Log DB errors but continue processing other bookmarks
                    logger_1.logger.error(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Failed to process object for URL ${url}:`, dbError);
                }
                // Send progress update periodically
                if (processedCount % 10 === 0 || processedCount === totalBookmarks) {
                    sendProgress(event, { processed: processedCount, total: totalBookmarks, stage: 'Importing...' });
                }
            }
            logger_1.logger.info(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Import processing complete. Newly created: ${newlyCreatedCount}/${totalBookmarks}`);
            sendProgress(event, { processed: totalBookmarks, total: totalBookmarks, stage: 'Complete' });
            return newlyCreatedCount;
        }
        catch (error) {
            logger_1.logger.error(`[IPC Handler Error][${ipcChannels_1.BOOKMARKS_IMPORT}] Failed during import process:`, error);
            // Determine if it's a file reading/parsing error vs. other
            const friendlyMessage = (error instanceof Error && error.message.includes('Failed to read bookmark file')) || (error instanceof Error && error.message.includes('Unsupported file type'))
                ? `Couldn't read bookmark file. Please ensure it's a standard Netscape HTML or Firefox JSON export. Error: ${error.message}`
                : `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
            sendProgress(event, { processed: processedCount, total: totalBookmarks, stage: `Error: ${friendlyMessage}` });
            throw new Error(friendlyMessage); // Throw the user-friendly message
        }
    });
    logger_1.logger.info(`[IPC Handler] Registered handler for ${ipcChannels_1.BOOKMARKS_IMPORT}`);
}
//# sourceMappingURL=bookmarks.js.map