import { logger } from "../utils/logger";
import { promises as fs } from 'fs'; // Import fs for file deletion
import * as BookmarkModel from '../models/BookmarkModel'; // Import model functions
import { ContentModel } from '../models/ContentModel'; // Import ContentModel class
import { canonicaliseUrl, sha256 } from './helpers/url'; // Import helpers
import { parseBookmarkFile } from '../ingestion/parsers/detect'; // Import the actual parser entry point
import { queueForContentIngestion } from './ingestionQueue'; // Import the queue function
// Import necessary types when parsing/deduping logic is added
// import { BookmarkData, BookmarkRecord } from '../shared/types';
// Deduplication logic is now handled within importFromFile

export class BookmarksService {
  private contentModel: ContentModel; // Add instance variable

  /**
   * Creates an instance of BookmarksService.
   * @param contentModelInstance - An initialized ContentModel instance.
   */
  constructor(contentModelInstance: ContentModel) {
    this.contentModel = contentModelInstance;
  }

  /**
   * Imports bookmarks from a given file path (HTML or JSON).
   * 1. Parses the file to extract URLs (using ingestion/parsers/detect).
   * 2. Canonicalises and hashes each URL.
   * 3. Inserts into the database if the hash is new.
   * 4. Deletes the temporary file.
   * 5. Returns the count of *new* bookmarks added to the DB.
   * @param filePath - The absolute path to the temporary bookmark export file.
   * @returns The number of new bookmarks successfully added.
   */
  async importFromFile(filePath: string): Promise<number> {
    logger.info(`[BookmarkService] Starting import from file: ${filePath}`);
    let newBookmarksCount = 0;

    try {
      // 1. Parse file content using the dedicated ingestion function
      const potentialUrls = await parseBookmarkFile(filePath);
      if (!potentialUrls.length) {
        logger.warn(`[BookmarkService] No potential URLs found or parsed from file: ${filePath}`);
        // Don't delete the file here, the finally block handles it
        return 0;
      }
      logger.info(`[BookmarkService] Parsed ${potentialUrls.length} potential bookmark entries via ingestion parser.`);

      // Process URLs and insert new ones
      const processedHashes = new Set<string>(); // Avoid processing same canonical URL twice from one file
      let invalidUrlCount = 0;

      for (const rawUrl of potentialUrls) {
        let canonicalUrl: string;
        try {
          canonicalUrl = canonicaliseUrl(rawUrl);
          // Basic check if canonicalization resulted in something usable
          if (!canonicalUrl.startsWith('http:') && !canonicalUrl.startsWith('https:')) {
            throw new Error('Invalid protocol after canonicalization');
          }
        } catch (e) {
          logger.warn(`[BookmarkService] Skipping invalid or non-HTTP(S) URL: ${rawUrl}`);
          invalidUrlCount++;
          continue;
        }

        const urlHash = sha256(canonicalUrl);

        if (processedHashes.has(urlHash)) {
          continue; // Already processed this canonical URL from this file
        }
        processedHashes.add(urlHash);

        // 3. Insert if new (delegates deduplication to the DB constraint)
        try {
          const { wasNew, id } = BookmarkModel.insertIfNew(canonicalUrl, urlHash);
          if (wasNew && id !== null) { // Ensure id is not null before converting
            newBookmarksCount++;
            const bookmarkIdString = String(id); // Convert number id to string
            logger.debug(`[BookmarkService] Added new bookmark: ID ${bookmarkIdString}, Hash ${urlHash}`);
            // Queue this ID (as string) and canonical URL for content ingestion
            queueForContentIngestion(bookmarkIdString, canonicalUrl, this.contentModel);
          }
        } catch (dbError) {
          logger.error(`[BookmarkService] Database error inserting hash ${urlHash} for URL ${canonicalUrl}:`, dbError);
          // Decide whether to continue or abort import on DB error
        }
      }

      logger.info(`[BookmarkService] Import processing complete. Added ${newBookmarksCount} new bookmarks. Skipped ${invalidUrlCount} invalid URLs.`);

      // 5. Return the count of new bookmarks added to the DB
      return newBookmarksCount;

    } catch (error) {
      // Catch errors from parsing (now in parseBookmarkFile) or unexpected issues
      logger.error(`[BookmarkService] Error during import processing for file ${filePath}:`, error);
      throw error; // Re-throw to be caught by the IPC handler
    } finally {
      // 4. Delete the temporary file regardless of success or failure
      try {
        logger.info(`[BookmarkService] Attempting to delete temporary file: ${filePath}`);
        await fs.unlink(filePath);
        logger.info(`[BookmarkService] Successfully deleted temporary file: ${filePath}`);
      } catch (unlinkError) {
        // Log failure to delete, but don't let it hide the original error (if any)
        logger.error(`[BookmarkService] Failed to delete temporary file ${filePath}:`, unlinkError);
      }
    }
  }
}

// Note: If the service becomes stateful, export an instance instead:
// export const bookmarkService = new BookmarksService(); 