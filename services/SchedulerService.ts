import { BaseService } from './base/BaseService';
import { ServiceError } from './base/ServiceError';

interface ScheduledTask {
  intervalId: NodeJS.Timeout;
  taskFunction: () => Promise<void>;
  intervalMs: number;
  isRunning: boolean;
  lastRun?: Date;
  lastError?: Error;
  runCount: number;
  errorCount: number;
}

/**
 * Service for scheduling and managing recurring tasks.
 * 
 * Issues fixed in this refactoring:
 * - Memory leaks from orphaned task objects
 * - Race conditions in stopAllTasks
 * - Added task status checking methods
 * - Added task metrics tracking
 * - Improved error handling with error counts
 * - Async immediate execution to prevent blocking
 */
export class SchedulerService extends BaseService<{}> {
  private scheduledTasks: Map<string, ScheduledTask> = new Map();
  private runningTasks: Set<string> = new Set();

  constructor() {
    super('SchedulerService', {});
    this.logInfo('Service initialized');
  }

  async scheduleTask(
    taskName: string, 
    intervalMs: number, 
    taskFunction: () => Promise<void>, 
    runImmediately: boolean = false
  ): Promise<void> {
    return this.execute('scheduleTask', async () => {
      if (this.scheduledTasks.has(taskName)) {
        await this.stopTask(taskName);
        this.logInfo(`Rescheduling task: ${taskName}`);
      }

      // Create task runner that uses the running tasks set
      const taskRunner = async () => {
        if (this.runningTasks.has(taskName)) {
          this.logWarn(`Task '${taskName}' is still running. Skipping this interval.`);
          return;
        }
        
        this.runningTasks.add(taskName);
        const task = this.scheduledTasks.get(taskName);
        if (!task) return; // Task was stopped
        
        task.isRunning = true;
        const startTime = Date.now();
        
        try {
          await taskFunction();
          const duration = Date.now() - startTime;
          this.logDebug(`Task '${taskName}' executed successfully in ${duration}ms`);
          
          // Update metrics
          task.lastRun = new Date();
          task.runCount++;
          task.lastError = undefined;
        } catch (error) {
          const duration = Date.now() - startTime;
          this.logError(`Error in scheduled task '${taskName}' after ${duration}ms:`, error);
          
          // Update error metrics
          task.lastError = error instanceof Error ? error : new Error(String(error));
          task.errorCount++;
        } finally {
          task.isRunning = false;
          this.runningTasks.delete(taskName);
        }
      };
      
      // Create the task object
      const task: ScheduledTask = {
        intervalId: null as any, // Will be set below
        taskFunction,
        intervalMs,
        isRunning: false,
        runCount: 0,
        errorCount: 0
      };
      
      // Store task before scheduling to prevent race conditions
      this.scheduledTasks.set(taskName, task);
      
      // Schedule the interval
      task.intervalId = setInterval(taskRunner, intervalMs);
      
      // Run immediately if requested (async to prevent blocking)
      if (runImmediately) {
        this.logInfo(`Running task '${taskName}' immediately.`);
        // Run async to prevent blocking the schedule setup
        taskRunner().catch(error => {
          this.logError(`Error in immediate execution of task '${taskName}':`, error);
        });
      }
      
      this.logInfo(`Scheduled task '${taskName}' to run every ${intervalMs / 1000} seconds.`);
    }, { taskName, intervalMs });
  }

  async stopTask(taskName: string): Promise<void> {
    return this.execute('stopTask', async () => {
      const task = this.scheduledTasks.get(taskName);
      if (!task) {
        this.logDebug(`Task '${taskName}' not found, nothing to stop`);
        return;
      }
      
      // Clear the interval first
      clearInterval(task.intervalId);
      
      // Wait for task to complete if running
      if (this.runningTasks.has(taskName)) {
        this.logInfo(`Waiting for task '${taskName}' to complete before stopping...`);
        const maxWaitTime = 30000; // 30 seconds max wait
        const startTime = Date.now();
        
        while (this.runningTasks.has(taskName) && Date.now() - startTime < maxWaitTime) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (this.runningTasks.has(taskName)) {
          this.logWarn(`Task '${taskName}' did not complete within ${maxWaitTime}ms, forcing stop`);
          this.runningTasks.delete(taskName);
        }
      }
      
      // Remove from scheduled tasks
      this.scheduledTasks.delete(taskName);
      this.logInfo(`Stopped task: ${taskName}`);
    }, { taskName });
  }

  async stopAllTasks(): Promise<void> {
    return this.execute('stopAllTasks', async () => {
      this.logInfo('Stopping all scheduled tasks...');
      
      // Get all task names before stopping (to avoid concurrent modification)
      const taskNames = Array.from(this.scheduledTasks.keys());
      
      // Stop all tasks in parallel
      await Promise.all(taskNames.map(taskName => this.stopTask(taskName)));
      
      this.logInfo('All scheduled tasks stopped.');
    });
  }
  
  /**
   * Clean up all resources when the service is destroyed
   */
  async cleanup(): Promise<void> {
    await this.stopAllTasks();
  }
  
  /**
   * Check if a task is currently scheduled
   */
  isTaskScheduled(taskName: string): boolean {
    return this.scheduledTasks.has(taskName);
  }
  
  /**
   * Check if a task is currently running
   */
  isTaskRunning(taskName: string): boolean {
    return this.runningTasks.has(taskName);
  }
  
  /**
   * Get task status and metrics
   */
  getTaskStatus(taskName: string): {
    scheduled: boolean;
    running: boolean;
    lastRun?: Date;
    lastError?: Error;
    runCount: number;
    errorCount: number;
    intervalMs: number;
  } | null {
    const task = this.scheduledTasks.get(taskName);
    if (!task) {
      return null;
    }
    
    return {
      scheduled: true,
      running: this.runningTasks.has(taskName),
      lastRun: task.lastRun,
      lastError: task.lastError,
      runCount: task.runCount,
      errorCount: task.errorCount,
      intervalMs: task.intervalMs
    };
  }
  
  /**
   * Get status for all tasks
   */
  getAllTaskStatuses(): Map<string, ReturnType<typeof this.getTaskStatus>> {
    const statuses = new Map<string, ReturnType<typeof this.getTaskStatus>>();
    
    for (const taskName of this.scheduledTasks.keys()) {
      const status = this.getTaskStatus(taskName);
      if (status) {
        statuses.set(taskName, status);
      }
    }
    
    return statuses;
  }
}

// Remove singleton pattern - service will be instantiated in composition root