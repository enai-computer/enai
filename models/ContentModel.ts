import Database from 'better-sqlite3'; // Import type
import getDb from './db';
import { logger } from '../utils/logger';
import { ReadabilityParsed } from '../shared/types'; // Assuming types will be defined here

export type ContentStatus = 'pending' | 'ok' | 'timeout' | 'too_large' | 'parse_fail' | 'http_error' | 'fetch_error' | 'fetch_fail';

export interface ContentRecordInput {
  bookmarkId: string; // Changed from number to string to match schema draft
  sourceUrl: string;
  status: ContentStatus;
  parsedContent?: ReadabilityParsed | null; // Make parsed content optional based on status
  fetchedAt?: Date; // Allow overriding fetched_at
  errorInfo?: string | null; // Added optional error info field
}

export interface ContentRecord extends ContentRecordInput {
  title: string | null;
  byline: string | null;
  body: string | null; // Renamed from text
  length: number | null;
  fetchedAt: Date; // Ensure fetchedAt is always present in the output record
  errorInfo?: string | null; // Also add here for consistency
}


/**
 * Inserts or replaces a record in the content table.
 * Uses bookmark_id as the primary key.
 * @returns The RunResult object from better-sqlite3.
 */
export function upsertContent(record: ContentRecordInput): Database.RunResult {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO content (
      bookmark_id, title, byline, body, length, source_url, fetched_at, status, error_info
    ) VALUES (
      @bookmarkId, @title, @byline, @body, @length, @sourceUrl, @fetchedAt, @status, @errorInfo
    )
  `);

  try {
    const info = stmt.run({
      bookmarkId: record.bookmarkId,
      title: record.parsedContent?.title ?? null,
      byline: record.parsedContent?.byline ?? null,
      body: record.parsedContent?.textContent ?? null, // Map Readability's textContent to the 'body' column
      length: record.parsedContent?.length ?? null,
      sourceUrl: record.sourceUrl,
      fetchedAt: (record.fetchedAt ?? new Date()).toISOString(),
      status: record.status,
      errorInfo: record.errorInfo ?? null, // Add errorInfo here, defaulting to null
    });
    if (info.changes > 0) {
        logger.debug(`[ContentModel] Upserted content for bookmark ID ${record.bookmarkId} with status ${record.status}. Changes: ${info.changes}`);
    } else {
        logger.debug(`[ContentModel] Content for bookmark ID ${record.bookmarkId} likely unchanged. Status: ${record.status}. Changes: ${info.changes}`);
    }
    return info;
  } catch (error) {
    logger.error(`[ContentModel] Failed to upsert content for bookmark ID ${record.bookmarkId}:`, error);
    throw error; // Re-throw for the service layer to handle
  }
}

/**
 * Updates the status of a content record.
 * @returns The RunResult object from better-sqlite3.
 */
export function updateContentStatus(bookmarkId: string, status: ContentStatus, fetchedAt?: Date): Database.RunResult {
    const db = getDb();
    const stmt = db.prepare(`
        UPDATE content
        SET status = @status, fetched_at = @fetchedAt
        WHERE bookmark_id = @bookmarkId
    `);

    try {
        const info = stmt.run({
            bookmarkId: bookmarkId,
            status: status,
            fetchedAt: (fetchedAt ?? new Date()).toISOString(),
        });
        if (info.changes > 0) {
            logger.debug(`[ContentModel] Updated status for bookmark ID ${bookmarkId} to ${status}`);
        } else {
             logger.warn(`[ContentModel] Attempted to update status for non-existent bookmark ID ${bookmarkId}`);
        }
        return info;
    } catch (error) {
        logger.error(`[ContentModel] Failed to update status for bookmark ID ${bookmarkId}:`, error);
        throw error;
    }
}

/**
 * Finds content records matching a list of statuses.
 * Primarily used for re-queuing stale jobs on startup.
 * @param statuses - An array of ContentStatus values to query for.
 * @returns An array of objects containing bookmark_id and source_url.
 */
export function findByStatuses(statuses: ContentStatus[]): { bookmark_id: string; source_url: string }[] {
    if (!statuses || statuses.length === 0) {
        return [];
    }

    const db = getDb();
    // Create placeholders for the IN clause (?, ?, ?)
    const placeholders = statuses.map(() => '?').join(', ');
    const stmt = db.prepare(`
        SELECT bookmark_id, source_url
        FROM content
        WHERE status IN (${placeholders})
    `);

    try {
        // Type assertion: better-sqlite3 returns any[], we expect this structure.
        const rows = stmt.all(...statuses) as { bookmark_id: string; source_url: string }[];
        logger.debug(`[ContentModel] Found ${rows.length} content records with statuses: ${statuses.join(', ')}`);
        return rows;
    } catch (error) {
        logger.error(`[ContentModel] Failed to find content by statuses (${statuses.join(', ')}):`, error);
        throw error; // Re-throw for the caller (main.ts) to handle
    }
}

// Add other necessary functions here later, e.g., getContentById, getContentByStatus, etc. 