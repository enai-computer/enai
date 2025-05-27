"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerService = void 0;
exports.getSchedulerService = getSchedulerService;
const logger_1 = require("../utils/logger");
class SchedulerService {
    constructor() {
        this.scheduledTasks = new Map();
        logger_1.logger.info("[SchedulerService] Initialized.");
    }
    scheduleTask(taskName, intervalMs, taskFunction, runImmediately = false) {
        if (this.scheduledTasks.has(taskName)) {
            this.stopTask(taskName);
            logger_1.logger.info(`[SchedulerService] Rescheduling task: ${taskName}`);
        }
        const taskRunner = async () => {
            const task = this.scheduledTasks.get(taskName);
            if (task && task.isRunning) {
                logger_1.logger.warn(`[SchedulerService] Task '${taskName}' is still running. Skipping this interval.`);
                return;
            }
            if (task)
                task.isRunning = true;
            try {
                await taskFunction();
                logger_1.logger.debug(`[SchedulerService] Task '${taskName}' executed successfully.`);
            }
            catch (error) {
                logger_1.logger.error(`[SchedulerService] Error in scheduled task '${taskName}':`, error);
            }
            finally {
                if (task)
                    task.isRunning = false;
            }
        };
        if (runImmediately) {
            logger_1.logger.info(`[SchedulerService] Running task '${taskName}' immediately.`);
            taskRunner();
        }
        const intervalId = setInterval(taskRunner, intervalMs);
        this.scheduledTasks.set(taskName, {
            intervalId,
            taskFunction,
            intervalMs,
            isRunning: false
        });
        logger_1.logger.info(`[SchedulerService] Scheduled task '${taskName}' to run every ${intervalMs / 1000} seconds.`);
    }
    stopTask(taskName) {
        const task = this.scheduledTasks.get(taskName);
        if (task) {
            clearInterval(task.intervalId);
            this.scheduledTasks.delete(taskName);
            logger_1.logger.info(`[SchedulerService] Stopped task: ${taskName}`);
        }
    }
    async stopAllTasks() {
        logger_1.logger.info("[SchedulerService] Stopping all scheduled tasks...");
        for (const taskName of this.scheduledTasks.keys()) {
            this.stopTask(taskName);
        }
        // Add a small delay to ensure intervals are cleared
        await new Promise(resolve => setTimeout(resolve, 100));
        logger_1.logger.info("[SchedulerService] All scheduled tasks stopped.");
    }
}
exports.SchedulerService = SchedulerService;
let _schedulerService = null;
function getSchedulerService() {
    if (!_schedulerService) {
        _schedulerService = new SchedulerService();
    }
    return _schedulerService;
}
//# sourceMappingURL=SchedulerService.js.map