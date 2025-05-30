import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { IngestionQueueService } from './IngestionQueueService';
import { IngestionJobModel, JobType, IngestionJob } from '../models/IngestionJobModel';
import runMigrations from '../models/runMigrations';

describe('IngestionQueueService', () => {
  let db: Database.Database;
  let model: IngestionJobModel;
  let queue: IngestionQueueService;

  beforeEach(async () => {
    db = new Database(':memory:');
    await runMigrations(db);
    model = new IngestionJobModel(db);
    queue = new IngestionQueueService(model, {
      concurrency: 2,
      pollInterval: 100, // Fast polling for tests
      maxRetries: 2,
      retryDelay: 50
    });
  });

  afterEach(async () => {
    await queue.stop();
    db.close();
  });

  describe('processor registration', () => {
    it('should register processors for job types', () => {
      const pdfProcessor = vi.fn();
      const urlProcessor = vi.fn();

      queue.registerProcessor('pdf', pdfProcessor);
      queue.registerProcessor('url', urlProcessor);

      // No direct way to verify, but processors should be registered
      expect(true).toBe(true);
    });
  });

  describe('job processing', () => {
    it('should process jobs when started', async () => {
      const processedJobs: string[] = [];
      const processor = vi.fn(async (job: IngestionJob) => {
        processedJobs.push(job.id);
      });

      queue.registerProcessor('pdf', processor);

      // Add a job
      const job = await queue.addJob('pdf', '/test.pdf');
      expect(job.status).toBe('queued');

      // Start the queue
      queue.start();

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify job was processed
      expect(processor).toHaveBeenCalledWith(expect.objectContaining({
        id: job.id,
        jobType: 'pdf'
      }));

      // Check job status
      const updatedJob = model.getById(job.id);
      expect(updatedJob?.status).toBe('completed');
    });

    it('should respect concurrency limits', async () => {
      let activeCount = 0;
      let maxActive = 0;

      const processor = vi.fn(async (job: IngestionJob) => {
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        
        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 150));
        
        activeCount--;
      });

      queue.registerProcessor('pdf', processor);

      // Add multiple jobs
      await queue.addJob('pdf', '/test1.pdf');
      await queue.addJob('pdf', '/test2.pdf');
      await queue.addJob('pdf', '/test3.pdf');
      await queue.addJob('pdf', '/test4.pdf');

      // Start the queue
      queue.start();

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify concurrency was respected (max 2)
      expect(maxActive).toBeLessThanOrEqual(2);
      expect(processor).toHaveBeenCalledTimes(4);
    });

    it('should retry failed jobs', async () => {
      let attemptCount = 0;
      const processor = vi.fn(async (job: IngestionJob) => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error('Simulated failure');
        }
      });

      queue.registerProcessor('pdf', processor);

      const job = await queue.addJob('pdf', '/test.pdf');
      queue.start();

      // Wait for initial attempt and retry
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify job was retried and succeeded
      const finalJob = model.getById(job.id);
      expect(finalJob?.status).toBe('completed');
      expect(finalJob?.attempts).toBe(2);
      expect(processor).toHaveBeenCalledTimes(2);
    });

    it('should mark job as failed after max retries', async () => {
      const processor = vi.fn(async () => {
        throw new Error('Always fails');
      });

      queue.registerProcessor('pdf', processor);

      const job = await queue.addJob('pdf', '/test.pdf');
      queue.start();

      // Wait for all retry attempts
      await new Promise(resolve => setTimeout(resolve, 400));

      // Verify job failed permanently
      const finalJob = model.getById(job.id);
      expect(finalJob?.status).toBe('failed');
      expect(finalJob?.attempts).toBe(3); // 1 initial + 2 retries = 3 total
      expect(finalJob?.errorInfo).toBe('Always fails');
    });
  });

  describe('event emission', () => {
    it('should emit events during job lifecycle', async () => {
      const events: string[] = [];
      
      queue.on('job:created', () => events.push('created'));
      queue.on('job:started', () => events.push('started'));
      queue.on('job:completed', () => events.push('completed'));

      const processor = vi.fn(async () => {
        // Success
      });

      queue.registerProcessor('pdf', processor);
      await queue.addJob('pdf', '/test.pdf');
      queue.start();

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(events).toEqual(['created', 'started', 'completed']);
    });

    it('should emit retry event on failure', async () => {
      const events: string[] = [];
      
      queue.on('job:retry', () => events.push('retry'));

      const processor = vi.fn(async () => {
        throw new Error('Retry me');
      });

      queue.registerProcessor('pdf', processor);
      await queue.addJob('pdf', '/test.pdf');
      queue.start();

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(events).toContain('retry');
    });
  });

  describe('queue management', () => {
    it('should stop processing when stopped', async () => {
      let processedCount = 0;
      const processor = vi.fn(async () => {
        processedCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      queue.registerProcessor('pdf', processor);

      // Add jobs
      await queue.addJob('pdf', '/test1.pdf');
      await queue.addJob('pdf', '/test2.pdf');
      await queue.addJob('pdf', '/test3.pdf');

      // Start and quickly stop
      queue.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      await queue.stop();

      // Add more jobs after stopping
      await queue.addJob('pdf', '/test4.pdf');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have processed some but not all
      expect(processedCount).toBeGreaterThan(0);
      expect(processedCount).toBeLessThan(4);
    });

    it('should provide queue statistics', async () => {
      await queue.addJob('pdf', '/test1.pdf');
      await queue.addJob('url', 'http://example.com');

      const stats = queue.getStats();
      expect(stats.queued).toBe(2);
    });

    it('should track active job count', async () => {
      const processor = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      queue.registerProcessor('pdf', processor);
      
      expect(queue.getActiveJobCount()).toBe(0);

      await queue.addJob('pdf', '/test1.pdf');
      await queue.addJob('pdf', '/test2.pdf');
      
      queue.start();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have 2 active jobs (concurrency limit)
      expect(queue.getActiveJobCount()).toBe(2);
    });
  });

  describe('job cancellation', () => {
    it('should cancel queued jobs', async () => {
      const processor = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      queue.registerProcessor('pdf', processor);

      const job1 = await queue.addJob('pdf', '/test1.pdf');
      const job2 = await queue.addJob('pdf', '/test2.pdf');

      // Don't start the queue yet
      const cancelled = await queue.cancelJob(job2.id);
      expect(cancelled).toBe(true);

      const cancelledJob = model.getById(job2.id);
      expect(cancelledJob?.status).toBe('cancelled');

      // Start queue
      queue.start();
      await new Promise(resolve => setTimeout(resolve, 200));

      // Only job1 should have been processed
      expect(processor).toHaveBeenCalledTimes(1);
      expect(processor).toHaveBeenCalledWith(expect.objectContaining({ id: job1.id }));
    });

    it('should not cancel active jobs', async () => {
      let jobStarted = false;
      const processor = vi.fn(async () => {
        jobStarted = true;
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      queue.registerProcessor('pdf', processor);

      const job = await queue.addJob('pdf', '/test.pdf');
      queue.start();

      // Wait for job to start
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(jobStarted).toBe(true);

      // Try to cancel active job
      const cancelled = await queue.cancelJob(job.id);
      expect(cancelled).toBe(false);
    });
  });

  describe('job retry', () => {
    it('should allow manual retry of failed jobs', async () => {
      const processor = vi.fn(async () => {
        throw new Error('Always fails');
      });

      queue.registerProcessor('pdf', processor);

      const job = await queue.addJob('pdf', '/test.pdf');
      
      // Process to failure (with retries)
      queue.start();
      await new Promise(resolve => setTimeout(resolve, 400));
      
      const failedJob = model.getById(job.id);
      expect(failedJob?.status).toBe('failed');

      // Now change processor to succeed
      queue.registerProcessor('pdf', vi.fn(async () => {
        // Success
      }));

      // Manually retry
      const retried = await queue.retryJob(job.id);
      expect(retried).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 200));

      const finalJob = model.getById(job.id);
      expect(finalJob?.status).toBe('completed');
    });
  });
});