import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { BOOKMARKS_IMPORT, BOOKMARKS_PROGRESS } from '../../shared/ipcChannels';
import { ObjectModel } from '../../models/ObjectModel';
import { logger } from '../../utils/logger';
import { parseBookmarkFile } from '../../ingestion/parsers/detect';
import { IngestionQueueService } from '../../services/ingestion/IngestionQueueService';
import { BookmarksProgressEvent, JeffersObject } from '../../shared/types';

// Helper function to send progress updates
function sendProgress(event: IpcMainInvokeEvent, progress: BookmarksProgressEvent) {
    try {
        event.sender.send(BOOKMARKS_PROGRESS, progress);
    } catch (error) {
        // Handle potential errors if the window is closed during import
        logger.warn(`[IPC Handler][${BOOKMARKS_IMPORT}] Failed to send progress update:`, error);
    }
}

// Accept ObjectModel and IngestionQueueService instances
export function registerImportBookmarksHandler(objectModel: ObjectModel, ingestionQueueService: IngestionQueueService) {
  ipcMain.handle(BOOKMARKS_IMPORT, async (event, filePath: string) => {
    logger.info(`[IPC Handler][${BOOKMARKS_IMPORT}] Received request for path: ${filePath}`);

    if (typeof filePath !== 'string' || filePath.trim() === '') {
      logger.error(`[IPC Handler][${BOOKMARKS_IMPORT}] Invalid file path received.`);
      throw new Error('Invalid file path provided.');
    }

    let parsedUrls: string[] = [];
    let processedCount = 0;
    let newlyCreatedCount = 0;
    let totalBookmarks = 0;

    try {
      // Use the unified parsing function
      sendProgress(event, { processed: 0, total: 0, stage: 'Parsing file...' });
      parsedUrls = await parseBookmarkFile(filePath);
      totalBookmarks = parsedUrls.length;

      logger.info(`[IPC Handler][${BOOKMARKS_IMPORT}] Parsed ${totalBookmarks} URLs from file.`);
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
        } catch (_) {
            isValidUrl = false;
        }

        if (!isValidUrl) {
          logger.trace(`[IPC Handler][${BOOKMARKS_IMPORT}] Skipping invalid or non-http URL: ${url}`);
          continue;
        }

        try {
            let objectToProcess: JeffersObject | null = null;
            let wasNewlyCreated = false;

            // 1. Check if object already exists
            const existingObject = await objectModel.getBySourceUri(url);

            if (!existingObject) {
                // 2a. Create new object if it doesn't exist
                objectToProcess = await objectModel.create({
                    objectType: 'bookmark',
                    sourceUri: url,
                    title: null, // Title is not extracted by parseBookmarkFile >> @claude pls note where it is extracted
                    status: 'new',
                    rawContentRef: null, // @claude what does this refer to?
                    parsedContentJson: null,
                    errorInfo: null,
                });
                wasNewlyCreated = true;
                newlyCreatedCount++;
                logger.debug(`[IPC Handler][${BOOKMARKS_IMPORT}] Created new object for ${url} with ID ${objectToProcess.id}`);
            } else {
                // 2b. Use existing object >> @claude what action are we taking on the existing object? hmw run a simple diff (existing db content vs current web content and only update if page has changed?) This adds complexity, so let's think about it and skip for now
                objectToProcess = existingObject;
                wasNewlyCreated = false;
                 logger.debug(`[IPC Handler][${BOOKMARKS_IMPORT}] Found existing object for ${url} with ID ${objectToProcess.id}, status: ${objectToProcess.status}`);
            }

            // 3. Queue for ingestion if status is 'new' or 'error' >> @claude hmw limit the number of errors before terminating? suggested limit = 3 tries. After that wipe the object from the queue & db then say "Ingestion faliure; wiped object ${objectToProcess.id}"
            if (objectToProcess && ('new' === objectToProcess.status || 'error' === objectToProcess.status)) {
                if (objectToProcess.sourceUri) {
                    logger.debug(`[IPC Handler][${BOOKMARKS_IMPORT}] Queuing object ${objectToProcess.id} (status: ${objectToProcess.status}) for ingestion.`);
                    
                    // Use queue system
                    await ingestionQueueService.addJob('url', objectToProcess.sourceUri, {
                        priority: 0,
                        jobSpecificData: {
                            relatedObjectId: objectToProcess.id
                        }
                    });
                } else {
                    // Should not happen if created/fetched correctly
                    logger.warn(`[IPC Handler][${BOOKMARKS_IMPORT}] Object ${objectToProcess.id} selected for queueing but lacks a sourceUri.`);
                }
            }

        } catch (dbError) {
          // Log DB errors but continue processing other bookmarks >> @claude this relates to my count to three then terminate comment above. please confirm whether or not similar logic already exists.
          logger.error(`[IPC Handler][${BOOKMARKS_IMPORT}] Failed to process object for URL ${url}:`, dbError);
        }

        // Send progress update periodically
        if (processedCount % 10 === 0 || processedCount === totalBookmarks) {
          sendProgress(event, { processed: processedCount, total: totalBookmarks, stage: 'Importing...' });
        }
      }

      logger.info(`[IPC Handler][${BOOKMARKS_IMPORT}] Ingestion process completed. Newly created: ${newlyCreatedCount}/${totalBookmarks}`);
      sendProgress(event, { processed: totalBookmarks, total: totalBookmarks, stage: 'Complete' });
      return newlyCreatedCount; // @claude please replace bookmarks with total attempted / succeded {returnAttempted&&returnSucceded}, URLs {urlsAttempted&&urlsSucceded}, PDFs: {pdfsAttempted&&pdfsSucceded}, so it says something like "total attempted / succeded / succeded after 2nd attempt: 40/39/1 - URLs: 20/19/1    PDFs: 20/20/0" or whatever the right attempt/success numbers are.

    } catch (error) {
      logger.error(`[IPC Handler Error][${BOOKMARKS_IMPORT}] Failed during import process:`, error);
      // Determine if it's a file reading/parsing error vs. other
      const friendlyMessage = (error instanceof Error && error.message.includes('Failed to read bookmark file')) || (error instanceof Error && error.message.includes('Unsupported file type'))
          ? `Couldn't read bookmark file. Please ensure it's a standard Netscape HTML or Firefox JSON export. Error: ${error.message}`
          : `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`;

      sendProgress(event, { processed: processedCount, total: totalBookmarks, stage: `Error: ${friendlyMessage}` });
      throw new Error(friendlyMessage); // Throw the user-friendly message
    }
  });

  logger.info(`[IPC Handler] Registered handler for ${BOOKMARKS_IMPORT}`);
} 