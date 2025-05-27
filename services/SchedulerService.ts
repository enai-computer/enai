import { logger } from '../utils/logger';

interface ScheduledTask {
  intervalId: NodeJS.Timeout;
  taskFunction: () => Promise<void>;
  intervalMs: number;
  isRunning: boolean;
}

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
        logger.error(`[SchedulerService] Error in scheduled task '${taskName}':`, error);
      } finally {
        if (task) task.isRunning = false;
      }
    };
    
    if (runImmediately) {
      logger.info(`[SchedulerService] Running task '${taskName}' immediately.`);
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
    // Add a small delay to ensure intervals are cleared
    await new Promise(resolve => setTimeout(resolve, 100)); 
    logger.info("[SchedulerService] All scheduled tasks stopped.");
  }
}

let _schedulerService: SchedulerService | null = null;

export function getSchedulerService(): SchedulerService {
  if (!_schedulerService) {
    _schedulerService = new SchedulerService();
  }
  return _schedulerService;
}