import { logger } from '../utils/logger';

interface ScheduledTask {
  intervalId: NodeJS.Timeout;
  taskFunction: () => Promise<void>;
  intervalMs: number;
  isRunning: boolean;
}

/**
 * Service for scheduling and managing recurring tasks.
 * 
 * POTENTIAL ISSUES TO ADDRESS:
 * 
 * 1. Memory Leak Risk: When rescheduling a task (calling scheduleTask with the same taskName),
 *    the old task object's isRunning flag becomes orphaned in the closure of the old taskRunner.
 *    While the interval is cleared, the old task object remains in memory.
 * 
 * 2. Race Condition in stopAllTasks: The 100ms delay is arbitrary and might not be sufficient
 *    in all cases. This could lead to race conditions if the service is immediately reused.
 * 
 * 3. No Task Status Checking: No way to check if a specific task is currently scheduled
 *    or running, making it difficult to manage tasks programmatically.
 * 
 * 4. Error Swallowing: Task errors are logged but completely swallowed. Calling code has
 *    no way to know if a task is failing repeatedly.
 * 
 * 5. No Task Completion Tracking: No tracking of successful completions or metrics about
 *    task execution history.
 * 
 * 6. Potential Issue with runImmediately: When true, the task runs synchronously before
 *    the interval is set up. Long-running immediate execution could delay interval setup.
 */
export class SchedulerService {
  private scheduledTasks: Map<string, ScheduledTask> = new Map();

  constructor() {
    logger.info("[SchedulerService] Initialized.");
  }

  scheduleTask(
    taskName: string, 
    intervalMs: number, 
    taskFunction: () => Promise<void>, 
    runImmediately: boolean = false
  ): void {
    if (this.scheduledTasks.has(taskName)) {
      this.stopTask(taskName);
      logger.info(`[SchedulerService] Rescheduling task: ${taskName}`);
    }

    const taskRunner = async () => {
      const task = this.scheduledTasks.get(taskName);
      if (task && task.isRunning) {
        logger.warn(`[SchedulerService] Task '${taskName}' is still running. Skipping this interval.`);
        return;
      }
      if (task) task.isRunning = true;
      
      try {
        await taskFunction();
        logger.debug(`[SchedulerService] Task '${taskName}' executed successfully.`);
      } catch (error) {
        // ISSUE: Error is logged but swallowed - no way to track repeated failures
        logger.error(`[SchedulerService] Error in scheduled task '${taskName}':`, error);
      } finally {
        // ISSUE: When rescheduling, the old task's isRunning flag in the closure becomes orphaned
        if (task) task.isRunning = false;
      }
    };
    
    if (runImmediately) {
      logger.info(`[SchedulerService] Running task '${taskName}' immediately.`);
      // ISSUE: This runs synchronously and could delay interval setup if task is slow
      taskRunner();
    }

    const intervalId = setInterval(taskRunner, intervalMs);
    this.scheduledTasks.set(taskName, { 
      intervalId, 
      taskFunction, 
      intervalMs, 
      isRunning: false 
    });
    
    logger.info(`[SchedulerService] Scheduled task '${taskName}' to run every ${intervalMs / 1000} seconds.`);
  }

  stopTask(taskName: string): void {
    const task = this.scheduledTasks.get(taskName);
    if (task) {
      clearInterval(task.intervalId);
      this.scheduledTasks.delete(taskName);
      logger.info(`[SchedulerService] Stopped task: ${taskName}`);
    }
  }

  async stopAllTasks(): Promise<void> {
    logger.info("[SchedulerService] Stopping all scheduled tasks...");
    for (const taskName of this.scheduledTasks.keys()) {
      this.stopTask(taskName);
    }
    // ISSUE: Arbitrary 100ms delay might not be sufficient in all cases - potential race condition
    await new Promise(resolve => setTimeout(resolve, 100)); 
    logger.info("[SchedulerService] All scheduled tasks stopped.");
  }
  
  // ISSUE: No method to check if a task is scheduled or currently running
  // ISSUE: No method to get task execution metrics or history
}

let _schedulerService: SchedulerService | null = null;

export function getSchedulerService(): SchedulerService {
  if (!_schedulerService) {
    _schedulerService = new SchedulerService();
  }
  return _schedulerService;
}