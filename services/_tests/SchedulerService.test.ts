import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SchedulerService } from '../SchedulerService';
import { ProfileService } from '../ProfileService';
import { ActivityLogService } from '../ActivityLogService';
import { logger } from '../../utils/logger';
import runMigrations from '../../models/runMigrations';

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SchedulerService with BaseService', () => {
  let db: Database.Database;
  let schedulerService: SchedulerService;
  let mockProfileService: ProfileService;
  let mockActivityLogService: ActivityLogService;
  let mockTask: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    
    // Create in-memory database
    db = new Database(':memory:');
    await runMigrations(db);
    
    // Create mock services
    mockProfileService = {
      synthesizeProfile: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn(),
      cleanup: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true)
    } as unknown as ProfileService;
    
    mockActivityLogService = {
      synthesizeRecentActivity: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn(),
      cleanup: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true)
    } as unknown as ActivityLogService;
    
    // Create service with dependency injection
    schedulerService = new SchedulerService({
      db,
      profileService: mockProfileService,
      activityLogService: mockActivityLogService
    });
    
    // Initialize service
    await schedulerService.initialize();
    
    mockTask = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    // Cleanup service
    await schedulerService.cleanup();
    
    if (db && db.open) {
      db.close();
    }
    
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Constructor and BaseService integration', () => {
    it('should initialize with proper dependencies', () => {
      expect(schedulerService).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith('[SchedulerService] Initialized.');
    });

    it('should inherit BaseService functionality', async () => {
      // Test that execute wrapper works
      schedulerService.scheduleTask('test-task', 1000, mockTask);
      
      // Should log the operation with execute wrapper format
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[SchedulerService] scheduleTask started')
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[SchedulerService] scheduleTask completed')
      );
    });
  });

  describe('Lifecycle methods', () => {
    it('should support initialize method', async () => {
      // Already called in beforeEach, create a new instance to test
      const newService = new SchedulerService({
        db,
        profileService: mockProfileService,
        activityLogService: mockActivityLogService
      });
      await expect(newService.initialize()).resolves.toBeUndefined();
    });

    it('should support cleanup method with task cleanup', async () => {
      // Schedule some tasks
      schedulerService.scheduleTask('task-1', 1000, mockTask);
      schedulerService.scheduleTask('task-2', 2000, mockTask);
      
      // Verify tasks exist
      expect((schedulerService as any).tasks.size).toBe(2);
      
      // Cleanup should stop all tasks
      await schedulerService.cleanup();
      
      // Verify cleanup
      expect((schedulerService as any).tasks.size).toBe(0);
      expect(logger.info).toHaveBeenCalledWith('[SchedulerService] Cleanup completed. All tasks stopped.');
    });

    it('should clear all intervals on cleanup', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      
      // Schedule multiple tasks
      schedulerService.scheduleTask('task-1', 1000, mockTask);
      schedulerService.scheduleTask('task-2', 2000, mockTask);
      schedulerService.scheduleTask('task-3', 3000, mockTask);
      
      await schedulerService.cleanup();
      
      // Should have cleared all 3 intervals
      expect(clearIntervalSpy).toHaveBeenCalledTimes(3);
    });

    it('should support health check', async () => {
      const isHealthy = await schedulerService.healthCheck();
      expect(isHealthy).toBe(true);
    });
  });

  describe('Error handling with BaseService', () => {
    it('should use execute wrapper for error handling', async () => {
      const errorTask = vi.fn().mockRejectedValue(new Error('Task execution failed'));
      
      schedulerService.scheduleTask('error-task', 1000, errorTask);
      
      // Trigger the task
      await vi.advanceTimersByTimeAsync(1000);
      
      // Should log the error with proper context
      expect(logger.error).toHaveBeenCalledWith(
        "[SchedulerService] Error executing task 'error-task':",
        expect.any(Error)
      );
    });
  });

  describe('Dependency injection patterns', () => {
    it('should work with mocked dependencies', async () => {
      // Schedule the background tasks
      schedulerService.scheduleBackgroundTasks();
      
      // Advance time to trigger profile synthesis
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // 1 hour
      
      expect(mockProfileService.synthesizeProfile).toHaveBeenCalled();
    });

    it('should allow testing without real services', async () => {
      // Create service with minimal mocks
      const stubProfileService = {
        synthesizeProfile: vi.fn(),
        initialize: vi.fn(),
        cleanup: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true)
      } as unknown as ProfileService;
      
      const stubActivityService = {
        synthesizeRecentActivity: vi.fn(),
        initialize: vi.fn(),
        cleanup: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true)
      } as unknown as ActivityLogService;
      
      const serviceWithStubs = new SchedulerService({
        db: {} as Database.Database,
        profileService: stubProfileService,
        activityLogService: stubActivityService
      });
      
      // Should handle scheduling without errors
      serviceWithStubs.scheduleTask('stub-task', 1000, mockTask);
      expect((serviceWithStubs as any).tasks.has('stub-task')).toBe(true);
    });
  });

  describe('scheduleTask', () => {
    it('should schedule a task with the specified interval', () => {
      schedulerService.scheduleTask('test-task', 1000, mockTask);

      expect(logger.info).toHaveBeenCalledWith(
        "[SchedulerService] Scheduled task 'test-task' to run every 1 seconds."
      );
    });

    it('should run task immediately when runImmediately is true', async () => {
      schedulerService.scheduleTask('test-task', 1000, mockTask, true);

      expect(logger.info).toHaveBeenCalledWith(
        "[SchedulerService] Running task 'test-task' immediately."
      );
      
      // Wait for immediate execution
      await vi.runOnlyPendingTimersAsync();
      expect(mockTask).toHaveBeenCalledTimes(1);
    });

    it('should not run task immediately when runImmediately is false', async () => {
      schedulerService.scheduleTask('test-task', 1000, mockTask, false);

      // No immediate execution
      expect(mockTask).not.toHaveBeenCalled();
      
      // Advance time to trigger first execution
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockTask).toHaveBeenCalledTimes(1);
    });

    it('should reschedule existing task', () => {
      const mockTask2 = vi.fn().mockResolvedValue(undefined);
      
      schedulerService.scheduleTask('test-task', 1000, mockTask);
      schedulerService.scheduleTask('test-task', 2000, mockTask2);

      expect(logger.info).toHaveBeenCalledWith(
        '[SchedulerService] Rescheduling task: test-task'
      );
    });

    it('should execute task at specified intervals', async () => {
      schedulerService.scheduleTask('test-task', 1000, mockTask);

      // Run for 5 intervals
      for (let i = 1; i <= 5; i++) {
        await vi.advanceTimersByTimeAsync(1000);
        expect(mockTask).toHaveBeenCalledTimes(i);
      }
    });

    it('should log successful task execution', async () => {
      schedulerService.scheduleTask('test-task', 1000, mockTask);

      await vi.advanceTimersByTimeAsync(1000);
      
      expect(logger.debug).toHaveBeenCalledWith(
        "[SchedulerService] Task 'test-task' executed successfully."
      );
    });

    it('should handle task errors gracefully', async () => {
      const errorMessage = 'Task failed';
      const errorTask = vi.fn().mockRejectedValue(new Error(errorMessage));

      schedulerService.scheduleTask('error-task', 1000, errorTask);

      await vi.advanceTimersByTimeAsync(1000);

      expect(logger.error).toHaveBeenCalledWith(
        "[SchedulerService] Error in scheduled task 'error-task':",
        expect.any(Error)
      );
    });

    it('should skip execution if task is still running', async () => {
      let resolveTask: () => void;
      const longRunningTask = vi.fn().mockImplementation(() => 
        new Promise<void>(resolve => {
          resolveTask = resolve;
        })
      );

      schedulerService.scheduleTask('long-task', 500, longRunningTask);

      // First execution starts
      await vi.advanceTimersByTimeAsync(500);
      expect(longRunningTask).toHaveBeenCalledTimes(1);

      // Second interval triggers while first is still running
      await vi.advanceTimersByTimeAsync(500);
      expect(logger.warn).toHaveBeenCalledWith(
        "[SchedulerService] Task 'long-task' is still running. Skipping this interval."
      );
      expect(longRunningTask).toHaveBeenCalledTimes(1);

      // Complete the first task
      resolveTask!();
      await vi.runOnlyPendingTimersAsync();

      // Third interval should execute normally
      await vi.advanceTimersByTimeAsync(500);
      expect(longRunningTask).toHaveBeenCalledTimes(2);
    });
  });

  describe('stopTask', () => {
    it('should stop a scheduled task', () => {
      schedulerService.scheduleTask('test-task', 1000, mockTask);
      schedulerService.stopTask('test-task');

      expect(logger.info).toHaveBeenCalledWith(
        '[SchedulerService] Stopped task: test-task'
      );
    });

    it('should clear the interval when stopping a task', async () => {
      schedulerService.scheduleTask('test-task', 1000, mockTask);
      
      // Execute once
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockTask).toHaveBeenCalledTimes(1);

      // Stop the task
      schedulerService.stopTask('test-task');

      // Advance time - task should not execute
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockTask).toHaveBeenCalledTimes(1);
    });

    it('should handle stopping non-existent task gracefully', () => {
      schedulerService.stopTask('non-existent');
      // Should not throw error
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Stopped task')
      );
    });
  });

  describe('stopAllTasks', () => {
    it('should stop all scheduled tasks', async () => {
      const mockTask2 = vi.fn().mockResolvedValue(undefined);
      const mockTask3 = vi.fn().mockResolvedValue(undefined);

      schedulerService.scheduleTask('task-1', 1000, mockTask);
      schedulerService.scheduleTask('task-2', 1000, mockTask2);
      schedulerService.scheduleTask('task-3', 1000, mockTask3);

      await schedulerService.stopAllTasks();

      expect(logger.info).toHaveBeenCalledWith(
        '[SchedulerService] Stopping all scheduled tasks...'
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[SchedulerService] All scheduled tasks stopped.'
      );

      // Advance time - no tasks should execute
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockTask).not.toHaveBeenCalled();
      expect(mockTask2).not.toHaveBeenCalled();
      expect(mockTask3).not.toHaveBeenCalled();
    });

    it('should add delay after stopping all tasks', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      
      await schedulerService.stopAllTasks();

      // The setTimeout call happens inside stopAllTasks with a Promise wrapper
      // We need to check if setTimeout was called with 100ms delay
      const calls = setTimeoutSpy.mock.calls;
      const delayCall = calls.find(call => call[1] === 100);
      expect(delayCall).toBeDefined();
    });
  });

  describe('integration scenarios', () => {
    it('should handle multiple tasks running at different intervals', async () => {
      const fastTask = vi.fn().mockResolvedValue(undefined);
      const slowTask = vi.fn().mockResolvedValue(undefined);

      schedulerService.scheduleTask('fast-task', 500, fastTask);
      schedulerService.scheduleTask('slow-task', 1500, slowTask);

      // After 1 second
      await vi.advanceTimersByTimeAsync(1000);
      expect(fastTask).toHaveBeenCalledTimes(2);
      expect(slowTask).toHaveBeenCalledTimes(0);

      // After 1.5 seconds total
      await vi.advanceTimersByTimeAsync(500);
      expect(fastTask).toHaveBeenCalledTimes(3);
      expect(slowTask).toHaveBeenCalledTimes(1);

      // After 3 seconds total
      await vi.advanceTimersByTimeAsync(1500);
      expect(fastTask).toHaveBeenCalledTimes(6);
      expect(slowTask).toHaveBeenCalledTimes(2);
    });

    it('should handle task replacement correctly', async () => {
      const oldTask = vi.fn().mockResolvedValue(undefined);
      const newTask = vi.fn().mockResolvedValue(undefined);

      schedulerService.scheduleTask('replaceable-task', 1000, oldTask);
      
      // Execute old task once
      await vi.advanceTimersByTimeAsync(1000);
      expect(oldTask).toHaveBeenCalledTimes(1);

      // Replace with new task
      schedulerService.scheduleTask('replaceable-task', 1000, newTask);

      // Execute new task
      await vi.advanceTimersByTimeAsync(1000);
      expect(oldTask).toHaveBeenCalledTimes(1); // Old task should not execute again
      expect(newTask).toHaveBeenCalledTimes(1);
    });
  });

  describe('Background task scheduling', () => {
    it('should schedule profile synthesis task', async () => {
      schedulerService.scheduleBackgroundTasks();
      
      // Verify tasks were scheduled
      expect((schedulerService as any).tasks.has('profile-synthesis')).toBe(true);
      expect((schedulerService as any).tasks.has('activity-synthesis')).toBe(true);
      
      expect(logger.info).toHaveBeenCalledWith(
        '[SchedulerService] Background tasks scheduled.'
      );
    });

    it('should run activity synthesis more frequently than profile synthesis', async () => {
      schedulerService.scheduleBackgroundTasks();
      
      // Reset mocks
      vi.clearAllMocks();
      
      // Advance 30 minutes (activity synthesis interval)
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      
      // Activity synthesis should have run
      expect(mockActivityLogService.synthesizeRecentActivity).toHaveBeenCalledTimes(1);
      // Profile synthesis should not have run yet
      expect(mockProfileService.synthesizeProfile).toHaveBeenCalledTimes(0);
      
      // Advance another 30 minutes (total 60 minutes)
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      
      // Both should have run
      expect(mockActivityLogService.synthesizeRecentActivity).toHaveBeenCalledTimes(2);
      expect(mockProfileService.synthesizeProfile).toHaveBeenCalledTimes(1);
    });
  });

  describe('Integration with BaseService patterns', () => {
    it('should handle concurrent task execution', async () => {
      const task1 = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });
      const task2 = vi.fn().mockResolvedValue(undefined);
      
      schedulerService.scheduleTask('slow-task', 1000, task1);
      schedulerService.scheduleTask('fast-task', 1000, task2);
      
      // Advance timers
      await vi.advanceTimersByTimeAsync(1000);
      
      // Both tasks should execute
      expect(task1).toHaveBeenCalled();
      expect(task2).toHaveBeenCalled();
    });

    it('should continue running other tasks if one fails', async () => {
      const failingTask = vi.fn().mockRejectedValue(new Error('Task failed'));
      const successTask = vi.fn().mockResolvedValue(undefined);
      
      schedulerService.scheduleTask('failing-task', 1000, failingTask);
      schedulerService.scheduleTask('success-task', 1000, successTask);
      
      // Run multiple intervals
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
      
      // Both tasks should be called 3 times
      expect(failingTask).toHaveBeenCalledTimes(3);
      expect(successTask).toHaveBeenCalledTimes(3);
      
      // Error should be logged for failing task
      expect(logger.error).toHaveBeenCalledWith(
        "[SchedulerService] Error executing task 'failing-task':",
        expect.any(Error)
      );
    });
  });
});