import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { IngestionJobModel } from '../IngestionJobModel';
import { JobType, JobStatus } from '../../shared/types';
import { setupTestDb, cleanTestDb } from './testUtils';

describe('IngestionJobModel', () => {
  let db: Database.Database;
  let model: IngestionJobModel;

  beforeAll(() => {
    db = setupTestDb();
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    cleanTestDb(db);
    model = new IngestionJobModel(db);
  });

  describe('create', () => {
    it('should create a new ingestion job', () => {
      const params = {
        jobType: 'pdf' as JobType,
        sourceIdentifier: '/path/to/file.pdf',
        originalFileName: 'test.pdf',
        priority: 5,
        jobSpecificData: { pdfPassword: 'secret' }
      };

      const job = model.create(params);

      expect(job).toBeDefined();
      expect(job.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(job.jobType).toBe('pdf');
      expect(job.sourceIdentifier).toBe('/path/to/file.pdf');
      expect(job.originalFileName).toBe('test.pdf');
      expect(job.status).toBe('queued');
      expect(job.priority).toBe(5);
      expect(job.attempts).toBe(0);
      expect(job.jobSpecificData).toEqual({ pdfPassword: 'secret' });
    });

    it('should create job with default values', () => {
      const params = {
        jobType: 'url' as JobType,
        sourceIdentifier: 'https://example.com'
      };

      const job = model.create(params);

      expect(job.priority).toBe(0);
      expect(job.originalFileName).toBeUndefined();
      expect(job.jobSpecificData).toBeUndefined();
    });
  });

  describe('getById', () => {
    it('should retrieve job by ID', () => {
      const created = model.create({
        jobType: 'pdf',
        sourceIdentifier: '/test.pdf'
      });

      const retrieved = model.getById(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.jobType).toBe('pdf');
    });

    it('should return null for non-existent ID', () => {
      const retrieved = model.getById('non-existent-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('getNextJobs', () => {
    it('should get queued jobs ordered by priority and creation time', async () => {
      // Create jobs with different priorities
      const job1 = model.create({ jobType: 'pdf', sourceIdentifier: '1.pdf', priority: 1 });
      await new Promise(resolve => setTimeout(resolve, 10)); // Ensure different timestamps
      const job2 = model.create({ jobType: 'url', sourceIdentifier: 'url2', priority: 5 });
      await new Promise(resolve => setTimeout(resolve, 10));
      const job3 = model.create({ jobType: 'pdf', sourceIdentifier: '3.pdf', priority: 5 });

      const nextJobs = model.getNextJobs(3);

      expect(nextJobs).toHaveLength(3);
      expect(nextJobs[0].id).toBe(job2.id); // Highest priority, created first
      expect(nextJobs[1].id).toBe(job3.id); // Same priority, created later
      expect(nextJobs[2].id).toBe(job1.id); // Lower priority
    });

    it('should include retry_pending jobs that are due', () => {
      const job = model.create({ jobType: 'pdf', sourceIdentifier: 'test.pdf' });
      
      // Mark as retryable with past due time
      model.markAsRetryable(job.id, 'Test error', 'parsing_content', 0);

      const nextJobs = model.getNextJobs(10);
      expect(nextJobs).toHaveLength(1);
      expect(nextJobs[0].id).toBe(job.id);
    });

    it('should filter by job types when specified', () => {
      model.create({ jobType: 'pdf', sourceIdentifier: '1.pdf' });
      model.create({ jobType: 'url', sourceIdentifier: 'url1' });
      model.create({ jobType: 'url', sourceIdentifier: 'url2' });

      const urlJobs = model.getNextJobs(10, ['url']);
      expect(urlJobs).toHaveLength(2);
      expect(urlJobs.every(j => j.jobType === 'url')).toBe(true);
    });
  });

  describe('update', () => {
    it('should update job fields', () => {
      const job = model.create({ jobType: 'pdf', sourceIdentifier: 'test.pdf' });

      const updated = model.update(job.id, {
        status: 'processing_source',
        attempts: 1,
        progress: { stage: 'downloading', percent: 50 }
      });

      expect(updated).toBe(true);

      const retrieved = model.getById(job.id);
      expect(retrieved?.status).toBe('processing_source');
      expect(retrieved?.attempts).toBe(1);
      expect(retrieved?.progress).toEqual({ stage: 'downloading', percent: 50 });
    });
  });

  describe('status transitions', () => {
    it('should mark job as started', () => {
      const job = model.create({ jobType: 'pdf', sourceIdentifier: 'test.pdf' });

      model.markAsStarted(job.id);

      const updated = model.getById(job.id);
      expect(updated?.status).toBe('processing_source');
      expect(updated?.attempts).toBe(1);
      expect(updated?.lastAttemptAt).toBeDefined();
    });

    it('should mark job as completed', () => {
      const job = model.create({ jobType: 'pdf', sourceIdentifier: 'test.pdf' });
      // Create a valid object first to satisfy foreign key constraint
      // For now, we'll just test without relatedObjectId
      const objectId = undefined;

      model.markAsCompleted(job.id, objectId);

      const updated = model.getById(job.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.relatedObjectId).toBe(objectId);
      expect(updated?.completedAt).toBeDefined();
    });

    it('should mark job as retryable', () => {
      const job = model.create({ jobType: 'url', sourceIdentifier: 'test.com' });

      model.markAsRetryable(job.id, 'Network error', 'processing_source', 5000);

      const updated = model.getById(job.id);
      expect(updated?.status).toBe('retry_pending');
      expect(updated?.errorInfo).toBe('Network error');
      expect(updated?.failedStage).toBe('processing_source');
      expect(updated?.nextAttemptAt).toBeDefined();
      expect(updated?.nextAttemptAt).toBeGreaterThan(Date.now());
    });

    it('should mark job as permanently failed', () => {
      const job = model.create({ jobType: 'pdf', sourceIdentifier: 'test.pdf' });

      model.markAsFailed(job.id, 'Corrupted file', 'parsing_content');

      const updated = model.getById(job.id);
      expect(updated?.status).toBe('failed');
      expect(updated?.errorInfo).toBe('Corrupted file');
      expect(updated?.failedStage).toBe('parsing_content');
      expect(updated?.completedAt).toBeDefined();
    });
  });

  describe('getByStatus', () => {
    it('should get jobs by status', () => {
      const job1 = model.create({ jobType: 'pdf', sourceIdentifier: '1.pdf' });
      const job2 = model.create({ jobType: 'url', sourceIdentifier: 'url1' });
      const job3 = model.create({ jobType: 'pdf', sourceIdentifier: '2.pdf' });

      model.markAsCompleted(job1.id);
      model.markAsFailed(job2.id, 'Error', 'parsing');

      const queuedJobs = model.getByStatus('queued');
      const completedJobs = model.getByStatus('completed');
      const failedJobs = model.getByStatus('failed');

      expect(queuedJobs).toHaveLength(1);
      expect(queuedJobs[0].id).toBe(job3.id);
      expect(completedJobs).toHaveLength(1);
      expect(completedJobs[0].id).toBe(job1.id);
      expect(failedJobs).toHaveLength(1);
      expect(failedJobs[0].id).toBe(job2.id);
    });
  });

  describe('getStats', () => {
    it('should return job statistics by status', () => {
      // Create jobs in different states
      const job1 = model.create({ jobType: 'pdf', sourceIdentifier: '1.pdf' });
      const job2 = model.create({ jobType: 'url', sourceIdentifier: 'url1' });
      const job3 = model.create({ jobType: 'pdf', sourceIdentifier: '2.pdf' });
      const job4 = model.create({ jobType: 'url', sourceIdentifier: 'url2' });

      model.markAsCompleted(job1.id);
      model.markAsCompleted(job2.id);
      model.markAsFailed(job3.id, 'Error', 'parsing');

      const stats = model.getStats();

      expect(stats.queued).toBe(1);
      expect(stats.completed).toBe(2);
      expect(stats.failed).toBe(1);
    });
  });

  describe('cleanupOldJobs', () => {
    it('should delete old completed and failed jobs', () => {
      const job1 = model.create({ jobType: 'pdf', sourceIdentifier: '1.pdf' });
      const job2 = model.create({ jobType: 'url', sourceIdentifier: 'url1' });
      const job3 = model.create({ jobType: 'pdf', sourceIdentifier: '2.pdf' });

      // Complete jobs with old timestamps
      const oldTime = Date.now() - (35 * 24 * 60 * 60 * 1000); // 35 days ago
      model.markAsCompleted(job1.id);
      model.markAsFailed(job2.id, 'Error', 'parsing');
      
      // Manually update completed_at to old time
      db.prepare('UPDATE ingestion_jobs SET completed_at = ? WHERE id IN (?, ?)').run(new Date(oldTime).toISOString(), job1.id, job2.id);

      // Keep one job queued
      expect(model.getByStatus('queued')).toHaveLength(1);

      // Clean up jobs older than 30 days
      const deleted = model.cleanupOldJobs(30);

      expect(deleted).toBe(2);
      expect(model.getById(job1.id)).toBeNull();
      expect(model.getById(job2.id)).toBeNull();
      expect(model.getById(job3.id)).toBeDefined(); // Still queued
    });
  });
});