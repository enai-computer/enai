import { ipcMain } from 'electron';
import { BOOKMARKS_IMPORT } from '../../shared/ipcChannels';
// Note: BookmarksService will be created in the next step in services/bookmarkService.ts
// We are assuming it will have a static async method importFromFile
import { BookmarksService } from '../../services/bookmarkService'; 
import { logger } from '../../utils/logger'; // Assuming a logger utility exists

export function registerImportBookmarksHandler() {
  // Use ipcMain.handle for request/response
  ipcMain.handle(BOOKMARKS_IMPORT, async (_event, filePath: string) => {
    logger.info(`[IPC Handler][${BOOKMARKS_IMPORT}] Received request for path: ${filePath}`);

    // Basic validation (check if filePath is a non-empty string)
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      logger.error(`[IPC Handler][${BOOKMARKS_IMPORT}] Invalid file path received.`);
      throw new Error('Invalid file path provided.');
    }

    try {
      // Delegate to Service
      // Assuming BookmarksService is a class with a static method for simplicity as per the plan
      // If it's instance-based, adjust accordingly (e.g., import an instance)
      const count = await BookmarksService.importFromFile(filePath);
      logger.info(`[IPC Handler][${BOOKMARKS_IMPORT}] Service call successful. Imported ${count} bookmarks.`);
      // Return success result (implicitly resolves the promise on renderer side)
      return count; // Return the count directly as per the plan
    } catch (serviceError) {
      logger.error(`[IPC Handler Error][${BOOKMARKS_IMPORT}] Service failed to import bookmarks:`, serviceError);
      // Rethrow a user-friendly or sanitized error
      // Avoid leaking internal details if serviceError might contain sensitive info
      throw new Error('Failed to import bookmarks. Please check the file and try again.');
    }
  });

  logger.info(`[IPC Handler] Registered handler for ${BOOKMARKS_IMPORT}`);
} 