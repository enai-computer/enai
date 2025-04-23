"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerImportBookmarksHandler = registerImportBookmarksHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger_1 = require("../../utils/logger"); // Assuming a logger utility exists
// Accept the service instance as an argument
function registerImportBookmarksHandler(bookmarksServiceInstance) {
    // Use ipcMain.handle for request/response
    electron_1.ipcMain.handle(ipcChannels_1.BOOKMARKS_IMPORT, async (_event, filePath) => {
        logger_1.logger.info(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Received request for path: ${filePath}`);
        // Basic validation (check if filePath is a non-empty string)
        if (typeof filePath !== 'string' || filePath.trim() === '') {
            logger_1.logger.error(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Invalid file path received.`);
            throw new Error('Invalid file path provided.');
        }
        try {
            // Delegate to Service
            // Assuming BookmarksService is a class with a static method for simplicity as per the plan
            // If it's instance-based, adjust accordingly (e.g., import an instance)
            // const count = await BookmarksService.importFromFile(filePath); // Remove static call
            // Use the passed instance
            const count = await bookmarksServiceInstance.importFromFile(filePath);
            logger_1.logger.info(`[IPC Handler][${ipcChannels_1.BOOKMARKS_IMPORT}] Service call successful. Imported ${count} bookmarks.`);
            // Return success result (implicitly resolves the promise on renderer side)
            return count; // Return the count directly as per the plan
        }
        catch (serviceError) {
            logger_1.logger.error(`[IPC Handler Error][${ipcChannels_1.BOOKMARKS_IMPORT}] Service failed to import bookmarks:`, serviceError);
            // Rethrow a user-friendly or sanitized error
            // Avoid leaking internal details if serviceError might contain sensitive info
            throw new Error('Failed to import bookmarks. Please check the file and try again.');
        }
    });
    logger_1.logger.info(`[IPC Handler] Registered handler for ${ipcChannels_1.BOOKMARKS_IMPORT}`);
}
//# sourceMappingURL=bookmarks.js.map