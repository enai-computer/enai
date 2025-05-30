import { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// Type definitions
export type JobType = 'pdf' | 'url' | 'text_snippet';

export type JobStatus = 
  | 'queued'
  | 'processing_source'
  | 'parsing_content'
  | 'ai_processing'
  | 'persisting_data'
  | 'vectorizing'
  | 'completed'
  | 'failed'
  | 'retry_pending'
  | 'cancelled';

export interface JobProgress {
  stage: string;
  percent: number;
  message?: string;
}

export interface JobSpecificData {
  // PDF specific
  pdfPassword?: string;
  fileSize?: number;
  
  // URL specific
  headers?: Record<string, string>;
  userAgent?: string;
  
  // Common
  relatedObjectId?: string;
  notebookId?: string;
  
  // Common options
  chunkingStrategy?: 'semantic' | 'summary_only' | 'fixed_size';
  maxRetries?: number;
}

// Database row type
interface IngestionJobRow {
  id: string;
  job_type: string;
  source_identifier: string;
  original_file_name: string | null;
  status: string;
  priority: number;
  attempts: number;
  last_attempt_at: number | null;
  next_attempt_at: number | null;
  progress: string | null;
  error_info: string | null;
  failed_stage: string | null;
  job_specific_data: string | null;
  related_object_id: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface IngestionJob {
  id: string;
  jobType: JobType;
  sourceIdentifier: string;
  originalFileName?: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  progress?: JobProgress;
  errorInfo?: string;
  failedStage?: string;
  jobSpecificData?: JobSpecificData;
  relatedObjectId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface CreateIngestionJobParams {
  jobType: JobType;
  sourceIdentifier: string;
  originalFileName?: string;
  priority?: number;
  jobSpecificData?: JobSpecificData;
}

export interface UpdateIngestionJobParams {
  status?: JobStatus;
  attempts?: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  progress?: JobProgress;
  errorInfo?: string;
  failedStage?: string;
  relatedObjectId?: string;
  completedAt?: number;
}

export class IngestionJobModel {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    logger.info('[IngestionJobModel] Initialized.');
  }

  /**
   * Create a new ingestion job
   */
  create(params: CreateIngestionJobParams): IngestionJob {
    const id = uuidv4();
    const now = Date.now();
    
    logger.debug('[IngestionJobModel] Creating job', { id, ...params });

    try {
      const stmt = this.db.prepare(`
        INSERT INTO ingestion_jobs (
          id, job_type, source_identifier, original_file_name,
          status, priority, attempts, job_specific_data,
          created_at, updated_at
        ) VALUES (
          $id, $jobType, $sourceIdentifier, $originalFileName,
          'queued', $priority, 0, $jobSpecificData,
          $createdAt, $updatedAt
        )
      `);

      stmt.run({
        id,
        jobType: params.jobType,
        sourceIdentifier: params.sourceIdentifier,
        originalFileName: params.originalFileName || null,
        priority: params.priority || 0,
        jobSpecificData: params.jobSpecificData ? JSON.stringify(params.jobSpecificData) : null,
        createdAt: now,
        updatedAt: now
      });

      const job = this.getById(id);
      if (!job) {
        throw new Error('Failed to retrieve created job');
      }

      logger.info('[IngestionJobModel] Job created', { id, jobType: params.jobType });
      return job;
    } catch (error) {
      logger.error('[IngestionJobModel] Error creating job:', error);
      throw error;
    }
  }

  /**
   * Get a job by ID
   */
  getById(id: string): IngestionJob | null {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM ingestion_jobs WHERE id = ?
      `);

      const row = stmt.get(id) as any;
      if (!row) {
        return null;
      }

      return this.rowToJob(row);
    } catch (error) {
      logger.error('[IngestionJobModel] Error getting job by ID:', error);
      throw error;
    }
  }

  /**
   * Get next jobs to process (ordered by priority and creation time)
   */
  getNextJobs(limit: number = 10, jobTypes?: JobType[]): IngestionJob[] {
    try {
      const now = Date.now();
      let query = `
        SELECT * FROM ingestion_jobs 
        WHERE (status = 'queued' OR (status = 'retry_pending' AND next_attempt_at <= ?))
      `;

      const params: any[] = [now];

      if (jobTypes && jobTypes.length > 0) {
        const placeholders = jobTypes.map(() => '?').join(',');
        query += ` AND job_type IN (${placeholders})`;
        params.push(...jobTypes);
      }

      query += ` ORDER BY priority DESC, created_at ASC LIMIT ?`;
      params.push(limit);

      const stmt = this.db.prepare(query);
      const rows = stmt.all(...params) as any[];

      return rows.map(row => this.rowToJob(row));
    } catch (error) {
      logger.error('[IngestionJobModel] Error getting next jobs:', error);
      throw error;
    }
  }

  /**
   * Update a job
   */
  update(id: string, params: UpdateIngestionJobParams): boolean {
    logger.debug('[IngestionJobModel] Updating job', { id, ...params });

    try {
      const updates: string[] = [];
      const values: any = { id };

      if (params.status !== undefined) {
        updates.push('status = $status');
        values.status = params.status;
      }

      if (params.attempts !== undefined) {
        updates.push('attempts = $attempts');
        values.attempts = params.attempts;
      }

      if (params.lastAttemptAt !== undefined) {
        updates.push('last_attempt_at = $lastAttemptAt');
        values.lastAttemptAt = params.lastAttemptAt;
      }

      if (params.nextAttemptAt !== undefined) {
        updates.push('next_attempt_at = $nextAttemptAt');
        values.nextAttemptAt = params.nextAttemptAt;
      }

      if (params.progress !== undefined) {
        updates.push('progress = $progress');
        values.progress = JSON.stringify(params.progress);
      }

      if (params.errorInfo !== undefined) {
        updates.push('error_info = $errorInfo');
        values.errorInfo = params.errorInfo;
      }

      if (params.failedStage !== undefined) {
        updates.push('failed_stage = $failedStage');
        values.failedStage = params.failedStage;
      }

      if (params.relatedObjectId !== undefined) {
        updates.push('related_object_id = $relatedObjectId');
        values.relatedObjectId = params.relatedObjectId;
      }

      if (params.completedAt !== undefined) {
        updates.push('completed_at = $completedAt');
        values.completedAt = params.completedAt;
      }

      if (updates.length === 0) {
        return true; // Nothing to update
      }

      const stmt = this.db.prepare(`
        UPDATE ingestion_jobs 
        SET ${updates.join(', ')}
        WHERE id = $id
      `);

      const result = stmt.run(values);
      
      logger.info('[IngestionJobModel] Job updated', { id, changes: result.changes });
      return result.changes > 0;
    } catch (error) {
      logger.error('[IngestionJobModel] Error updating job:', error);
      throw error;
    }
  }

  /**
   * Mark a job as started (transition from queued/retry_pending to processing_source)
   */
  markAsStarted(id: string): boolean {
    const row = this.db.prepare('SELECT attempts FROM ingestion_jobs WHERE id = ?').get(id) as { attempts: number } | undefined;
    return this.update(id, {
      status: 'processing_source',
      lastAttemptAt: Date.now(),
      attempts: (row?.attempts ?? 0) + 1
    });
  }

  /**
   * Mark a job as completed
   */
  markAsCompleted(id: string, relatedObjectId?: string): boolean {
    return this.update(id, {
      status: 'completed',
      completedAt: Date.now(),
      relatedObjectId: relatedObjectId
    });
  }

  /**
   * Mark a job as failed with retry
   */
  markAsRetryable(id: string, errorInfo: string, failedStage: string, nextAttemptDelayMs: number = 60000): boolean {
    return this.update(id, {
      status: 'retry_pending',
      errorInfo,
      failedStage,
      nextAttemptAt: Date.now() + nextAttemptDelayMs
    });
  }

  /**
   * Mark a job as permanently failed
   */
  markAsFailed(id: string, errorInfo: string, failedStage: string): boolean {
    return this.update(id, {
      status: 'failed',
      errorInfo,
      failedStage,
      completedAt: Date.now()
    });
  }

  /**
   * Get jobs by status
   */
  getByStatus(status: JobStatus, limit?: number): IngestionJob[] {
    try {
      let query = `SELECT * FROM ingestion_jobs WHERE status = ? ORDER BY created_at DESC`;
      if (limit) {
        query += ` LIMIT ${limit}`;
      }

      const stmt = this.db.prepare(query);
      const rows = stmt.all(status) as any[];

      return rows.map(row => this.rowToJob(row));
    } catch (error) {
      logger.error('[IngestionJobModel] Error getting jobs by status:', error);
      throw error;
    }
  }

  /**
   * Get job statistics
   */
  getStats(): Record<JobStatus, number> {
    try {
      const stmt = this.db.prepare(`
        SELECT status, COUNT(*) as count 
        FROM ingestion_jobs 
        GROUP BY status
      `);

      const rows = stmt.all() as Array<{ status: JobStatus; count: number }>;
      const stats: Record<JobStatus, number> = {} as any;

      rows.forEach(row => {
        stats[row.status] = row.count;
      });

      return stats;
    } catch (error) {
      logger.error('[IngestionJobModel] Error getting stats:', error);
      throw error;
    }
  }

  /**
   * Clean up old completed/failed jobs
   */
  cleanupOldJobs(daysToKeep: number = 30): number {
    try {
      const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
      
      const stmt = this.db.prepare(`
        DELETE FROM ingestion_jobs 
        WHERE status IN ('completed', 'failed', 'cancelled') 
        AND completed_at < ?
      `);

      const result = stmt.run(cutoffTime);
      
      logger.info('[IngestionJobModel] Cleaned up old jobs', { deleted: result.changes });
      return result.changes;
    } catch (error) {
      logger.error('[IngestionJobModel] Error cleaning up old jobs:', error);
      throw error;
    }
  }

  /**
   * Convert database row to IngestionJob object
   */
  private rowToJob(row: IngestionJobRow): IngestionJob {
    let progress: JobProgress | undefined;
    let jobSpecificData: JobSpecificData | undefined;
    
    // Safe JSON parsing with error handling
    if (row.progress) {
      try {
        progress = JSON.parse(row.progress);
      } catch (error) {
        logger.error('[IngestionJobModel] Failed to parse progress JSON:', error);
      }
    }
    
    if (row.job_specific_data) {
      try {
        jobSpecificData = JSON.parse(row.job_specific_data);
      } catch (error) {
        logger.error('[IngestionJobModel] Failed to parse jobSpecificData JSON:', error);
      }
    }
    
    return {
      id: row.id,
      jobType: row.job_type as JobType,
      sourceIdentifier: row.source_identifier,
      originalFileName: row.original_file_name || undefined,
      status: row.status as JobStatus,
      priority: row.priority,
      attempts: row.attempts,
      lastAttemptAt: row.last_attempt_at || undefined,
      nextAttemptAt: row.next_attempt_at || undefined,
      progress,
      errorInfo: row.error_info || undefined,
      failedStage: row.failed_stage || undefined,
      jobSpecificData,
      relatedObjectId: row.related_object_id || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined
    };
  }
}