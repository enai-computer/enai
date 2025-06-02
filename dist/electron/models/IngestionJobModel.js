"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IngestionJobModel = void 0;
const uuid_1 = require("uuid");
const logger_1 = require("../utils/logger");
class IngestionJobModel {
    constructor(db) {
        this.db = db;
        logger_1.logger.info('[IngestionJobModel] Initialized.');
    }
    /**
     * Create a new ingestion job
     */
    create(params) {
        const id = (0, uuid_1.v4)();
        const now = Date.now();
        logger_1.logger.debug('[IngestionJobModel] Creating job', { id, ...params });
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
            logger_1.logger.info('[IngestionJobModel] Job created', { id, jobType: params.jobType });
            return job;
        }
        catch (error) {
            logger_1.logger.error('[IngestionJobModel] Error creating job:', error);
            throw error;
        }
    }
    /**
     * Get a job by ID
     */
    getById(id) {
        try {
            const stmt = this.db.prepare(`
        SELECT * FROM ingestion_jobs WHERE id = ?
      `);
            const row = stmt.get(id);
            if (!row) {
                return null;
            }
            return this.rowToJob(row);
        }
        catch (error) {
            logger_1.logger.error('[IngestionJobModel] Error getting job by ID:', error);
            throw error;
        }
    }
    /**
     * Get next jobs to process (ordered by priority and creation time)
     */
    getNextJobs(limit = 10, jobTypes) {
        try {
            const now = Date.now();
            let query = `
        SELECT * FROM ingestion_jobs 
        WHERE (status = 'queued' OR (status = 'retry_pending' AND next_attempt_at <= ?))
      `;
            const params = [now];
            if (jobTypes && jobTypes.length > 0) {
                const placeholders = jobTypes.map(() => '?').join(',');
                query += ` AND job_type IN (${placeholders})`;
                params.push(...jobTypes);
            }
            query += ` ORDER BY priority DESC, created_at ASC LIMIT ?`;
            params.push(limit);
            const stmt = this.db.prepare(query);
            const rows = stmt.all(...params);
            return rows.map(row => this.rowToJob(row));
        }
        catch (error) {
            logger_1.logger.error('[IngestionJobModel] Error getting next jobs:', error);
            throw error;
        }
    }
    /**
     * Update a job
     */
    update(id, params) {
        logger_1.logger.debug('[IngestionJobModel] Updating job', { id, ...params });
        try {
            const updates = [];
            const values = { id };
            if (params.status !== undefined) {
                updates.push('status = $status');
                values.status = params.status;
            }
            if (params.chunking_status !== undefined) {
                updates.push('chunking_status = $chunking_status');
                values.chunking_status = params.chunking_status;
            }
            if (params.chunking_error_info !== undefined) {
                updates.push('chunking_error_info = $chunking_error_info');
                values.chunking_error_info = params.chunking_error_info;
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
            // Log at debug level for routine updates, info level for important state changes
            if (params.status === 'failed' || params.status === 'completed') {
                logger_1.logger.info('[IngestionJobModel] Job updated', { id, changes: result.changes, ...params });
            }
            else {
                logger_1.logger.debug('[IngestionJobModel] Job updated', { id, changes: result.changes, fields: Object.keys(params) });
            }
            return result.changes > 0;
        }
        catch (error) {
            logger_1.logger.error('[IngestionJobModel] Error updating job:', error);
            throw error;
        }
    }
    /**
     * Mark a job as started (transition from queued/retry_pending to processing_source)
     */
    markAsStarted(id) {
        const row = this.db.prepare('SELECT attempts FROM ingestion_jobs WHERE id = ?').get(id);
        return this.update(id, {
            status: 'processing_source',
            lastAttemptAt: Date.now(),
            attempts: (row?.attempts ?? 0) + 1
        });
    }
    /**
     * Mark a job as completed
     */
    markAsCompleted(id, relatedObjectId) {
        return this.update(id, {
            status: 'completed',
            completedAt: Date.now(),
            relatedObjectId: relatedObjectId
        });
    }
    /**
     * Mark a job as failed with retry
     */
    markAsRetryable(id, errorInfo, failedStage, nextAttemptDelayMs = 60000) {
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
    markAsFailed(id, errorInfo, failedStage) {
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
    getByStatus(status, limit) {
        try {
            let query = `SELECT * FROM ingestion_jobs WHERE status = ? ORDER BY created_at DESC`;
            if (limit) {
                query += ` LIMIT ${limit}`;
            }
            const stmt = this.db.prepare(query);
            const rows = stmt.all(status);
            return rows.map(row => this.rowToJob(row));
        }
        catch (error) {
            logger_1.logger.error('[IngestionJobModel] Error getting jobs by status:', error);
            throw error;
        }
    }
    /**
     * Get job statistics
     */
    getStats() {
        try {
            const stmt = this.db.prepare(`
        SELECT status, COUNT(*) as count 
        FROM ingestion_jobs 
        GROUP BY status
      `);
            const rows = stmt.all();
            const stats = {};
            rows.forEach(row => {
                stats[row.status] = row.count;
            });
            return stats;
        }
        catch (error) {
            logger_1.logger.error('[IngestionJobModel] Error getting stats:', error);
            throw error;
        }
    }
    /**
     * Clean up old completed/failed jobs
     */
    cleanupOldJobs(daysToKeep = 30) {
        try {
            const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
            const stmt = this.db.prepare(`
        DELETE FROM ingestion_jobs 
        WHERE status IN ('completed', 'failed', 'cancelled') 
        AND completed_at < ?
      `);
            const result = stmt.run(cutoffTime);
            logger_1.logger.info('[IngestionJobModel] Cleaned up old jobs', { deleted: result.changes });
            return result.changes;
        }
        catch (error) {
            logger_1.logger.error('[IngestionJobModel] Error cleaning up old jobs:', error);
            throw error;
        }
    }
    /**
     * Convert database row to IngestionJob object
     */
    rowToJob(row) {
        let progress;
        let jobSpecificData;
        // Safe JSON parsing with error handling
        if (row.progress) {
            try {
                progress = JSON.parse(row.progress);
            }
            catch (error) {
                logger_1.logger.error('[IngestionJobModel] Failed to parse progress JSON:', error);
                // progress remains undefined
            }
        }
        if (row.job_specific_data) {
            try {
                jobSpecificData = JSON.parse(row.job_specific_data);
            }
            catch (error) {
                logger_1.logger.error('[IngestionJobModel] Failed to parse jobSpecificData JSON:', error);
                // jobSpecificData remains undefined
            }
        }
        return {
            id: row.id,
            jobType: row.job_type,
            sourceIdentifier: row.source_identifier,
            originalFileName: row.original_file_name || undefined,
            status: row.status,
            priority: row.priority,
            attempts: row.attempts,
            lastAttemptAt: row.last_attempt_at || undefined,
            nextAttemptAt: row.next_attempt_at || undefined,
            progress,
            errorInfo: row.error_info || undefined,
            failedStage: row.failed_stage || undefined,
            chunking_status: row.chunking_status || undefined,
            chunking_error_info: row.chunking_error_info || undefined,
            jobSpecificData,
            relatedObjectId: row.related_object_id || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            completedAt: row.completed_at || undefined
        };
    }
    /**
     * Find a job that is awaiting chunking for a specific related object ID.
     * @param relatedObjectId The ID of the object that has been parsed.
     * @returns The IngestionJob or null if not found.
     */
    findJobAwaitingChunking(relatedObjectId) {
        try {
            const stmt = this.db.prepare(`
        SELECT * FROM ingestion_jobs
        WHERE related_object_id = ? 
        AND (chunking_status = 'pending' OR chunking_status IS NULL)
        AND status = 'vectorizing'
        LIMIT 1
      `);
            const row = stmt.get(relatedObjectId);
            return row ? this.rowToJob(row) : null;
        }
        catch (error) {
            logger_1.logger.error('[IngestionJobModel] Error finding job awaiting chunking:', error);
            throw error;
        }
    }
}
exports.IngestionJobModel = IngestionJobModel;
//# sourceMappingURL=IngestionJobModel.js.map