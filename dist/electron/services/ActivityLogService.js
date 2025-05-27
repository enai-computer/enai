"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activityLogService = exports.ActivityLogService = void 0;
exports.getActivityLogService = getActivityLogService;
const ActivityLogModel_1 = require("../models/ActivityLogModel");
const logger_1 = require("../utils/logger");
const db_1 = require("../models/db");
class ActivityLogService {
    constructor(activityLogModel) {
        this.activityQueue = [];
        this.flushTimer = null;
        this.FLUSH_INTERVAL_MS = 5000; // Batch writes every 5 seconds
        this.MAX_QUEUE_SIZE = 100; // Force flush if queue gets too large
        const db = (0, db_1.getDb)();
        this.activityLogModel = activityLogModel || new ActivityLogModel_1.ActivityLogModel(db);
        logger_1.logger.info("[ActivityLogService] Initialized.");
    }
    /**
     * Log a user activity. Activities are batched for performance.
     */
    async logActivity(payload) {
        try {
            const userId = payload.userId || 'default_user';
            logger_1.logger.debug("[ActivityLogService] Queueing activity:", {
                type: payload.activityType,
                userId
            });
            // Add to queue
            this.activityQueue.push(payload);
            // Check if we should flush immediately
            if (this.activityQueue.length >= this.MAX_QUEUE_SIZE) {
                await this.flushQueue();
            }
            else {
                // Schedule a flush if not already scheduled
                this.scheduleFlush();
            }
        }
        catch (error) {
            logger_1.logger.error("[ActivityLogService] Error logging activity:", error);
            throw error;
        }
    }
    /**
     * Get activities for analysis or display.
     */
    async getActivities(userId = 'default_user', options) {
        try {
            // Flush any pending activities first
            await this.flushQueue();
            return this.activityLogModel.getActivities(userId, options?.startTime, options?.endTime, options?.activityTypes, options?.limit);
        }
        catch (error) {
            logger_1.logger.error("[ActivityLogService] Error getting activities:", error);
            throw error;
        }
    }
    /**
     * Get recent activities for a user.
     */
    async getRecentActivities(userId = 'default_user', hoursAgo = 24, limit) {
        try {
            // Flush any pending activities first
            await this.flushQueue();
            return this.activityLogModel.getRecentActivities(userId, hoursAgo, limit);
        }
        catch (error) {
            logger_1.logger.error("[ActivityLogService] Error getting recent activities:", error);
            throw error;
        }
    }
    /**
     * Get activity statistics for a user.
     */
    async getActivityStats(userId = 'default_user', startTime, endTime) {
        try {
            // Flush any pending activities first
            await this.flushQueue();
            const counts = this.activityLogModel.getActivityCounts(userId, startTime, endTime);
            let totalCount = 0;
            let mostFrequentType = null;
            let maxCount = 0;
            Object.entries(counts).forEach(([type, count]) => {
                totalCount += count;
                if (count > maxCount) {
                    maxCount = count;
                    mostFrequentType = type;
                }
            });
            return {
                totalCount,
                countByType: counts,
                mostFrequentType,
            };
        }
        catch (error) {
            logger_1.logger.error("[ActivityLogService] Error getting activity stats:", error);
            throw error;
        }
    }
    /**
     * Helper method to log common activities with standardized details.
     */
    async logNotebookVisit(notebookId, notebookTitle) {
        await this.logActivity({
            activityType: 'notebook_visit',
            details: { notebookId, notebookTitle, timestamp: Date.now() },
        });
    }
    async logIntentSelected(intentText, context, notebookId) {
        await this.logActivity({
            activityType: 'intent_selected',
            details: { intentText, context, notebookId, timestamp: Date.now() },
        });
    }
    async logChatSessionStarted(sessionId, notebookId) {
        await this.logActivity({
            activityType: 'chat_session_started',
            details: { sessionId, notebookId, timestamp: Date.now() },
        });
    }
    async logSearchPerformed(query, resultsCount, notebookId) {
        await this.logActivity({
            activityType: 'search_performed',
            details: { query, resultsCount, notebookId, timestamp: Date.now() },
        });
    }
    async logBrowserNavigation(url, title, notebookId) {
        await this.logActivity({
            activityType: 'browser_navigation',
            details: { url, title, notebookId, timestamp: Date.now() },
        });
    }
    async logInfoSliceSelected(chunkId, sourceObjectId, notebookId) {
        await this.logActivity({
            activityType: 'info_slice_selected',
            details: { chunkId, sourceObjectId, notebookId, timestamp: Date.now() },
        });
    }
    async logStatedGoalAdded(goalId, goalText, priority) {
        await this.logActivity({
            activityType: 'stated_goal_added',
            details: { goalId, goalText, priority, timestamp: Date.now() },
        });
    }
    async logStatedGoalUpdated(goalId, goalText, status) {
        await this.logActivity({
            activityType: 'stated_goal_updated',
            details: { goalId, goalText, status, timestamp: Date.now() },
        });
    }
    async logStatedGoalCompleted(goalId, goalText) {
        await this.logActivity({
            activityType: 'stated_goal_completed',
            details: { goalId, goalText, timestamp: Date.now() },
        });
    }
    /**
     * Clean up old activities to prevent unbounded growth.
     */
    async cleanupOldActivities(userId = 'default_user', daysToKeep = 90) {
        try {
            const deletedCount = this.activityLogModel.deleteOldActivities(userId, daysToKeep);
            logger_1.logger.info("[ActivityLogService] Cleaned up old activities:", {
                userId,
                deletedCount,
                daysToKeep
            });
            return deletedCount;
        }
        catch (error) {
            logger_1.logger.error("[ActivityLogService] Error cleaning up activities:", error);
            throw error;
        }
    }
    /**
     * Force flush any pending activities (e.g., on shutdown).
     */
    async shutdown() {
        try {
            if (this.flushTimer) {
                clearTimeout(this.flushTimer);
                this.flushTimer = null;
            }
            await this.flushQueue();
            logger_1.logger.info("[ActivityLogService] Shutdown complete.");
        }
        catch (error) {
            logger_1.logger.error("[ActivityLogService] Error during shutdown:", error);
            throw error;
        }
    }
    /**
     * Schedule a flush of the activity queue.
     */
    scheduleFlush() {
        if (this.flushTimer) {
            return; // Already scheduled
        }
        this.flushTimer = setTimeout(async () => {
            this.flushTimer = null;
            await this.flushQueue();
        }, this.FLUSH_INTERVAL_MS);
    }
    /**
     * Flush the activity queue to the database.
     */
    async flushQueue() {
        if (this.activityQueue.length === 0) {
            return;
        }
        const activitiesToFlush = [...this.activityQueue];
        this.activityQueue = [];
        try {
            // Process each activity
            for (const activity of activitiesToFlush) {
                const userId = activity.userId || 'default_user';
                this.activityLogModel.addActivity(activity.activityType, activity.details, userId);
            }
            logger_1.logger.debug("[ActivityLogService] Flushed activities:", {
                count: activitiesToFlush.length
            });
        }
        catch (error) {
            // On error, add activities back to queue for retry
            this.activityQueue.unshift(...activitiesToFlush);
            logger_1.logger.error("[ActivityLogService] Error flushing queue, will retry:", error);
            throw error;
        }
    }
}
exports.ActivityLogService = ActivityLogService;
// Export a singleton instance with lazy initialization
let _activityLogService = null;
function getActivityLogService() {
    if (!_activityLogService) {
        _activityLogService = new ActivityLogService();
    }
    return _activityLogService;
}
// For backward compatibility, export a getter that initializes on first access
exports.activityLogService = {
    get() {
        return getActivityLogService();
    }
};
//# sourceMappingURL=ActivityLogService.js.map