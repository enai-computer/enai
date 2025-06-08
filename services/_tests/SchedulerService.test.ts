import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchedulerService } from '../SchedulerService';
import { logger } from '../../utils/logger';

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SchedulerService', () => {
  let schedulerService: SchedulerService;
  let mockTask: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    schedulerService = new SchedulerService();
    mockTask = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await schedulerService.stopAllTasks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize the service', () => {
      expect(logger.info).toHaveBeenCalledWith('[SchedulerService] Initialized.');
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

  describe('getSchedulerService singleton', () => {
    it('should return a singleton instance', async () => {
      // Dynamically import to test singleton
      const module = await import('../SchedulerService');
      const { getSchedulerService } = module;
      
      const instance1 = getSchedulerService();
      const instance2 = getSchedulerService();

      expect(instance1).toBe(instance2);
      expect(instance1).toBeInstanceOf(SchedulerService);
    });
  });
});