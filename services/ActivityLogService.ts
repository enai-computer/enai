import { ActivityLogModel } from '../models/ActivityLogModel';
import { ActivityType, UserActivity, ActivityLogPayload } from '../shared/types';
import { logger } from '../utils/logger';
import { getDb } from '../models/db';

export class ActivityLogService {
  private activityLogModel: ActivityLogModel;
  private activityQueue: ActivityLogPayload[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 5000; // Batch writes every 5 seconds
  private readonly MAX_QUEUE_SIZE = 100; // Force flush if queue gets too large

  constructor(activityLogModel?: ActivityLogModel) {
    const db = getDb();
    this.activityLogModel = activityLogModel || new ActivityLogModel(db);
    logger.info("[ActivityLogService] Initialized.");
  }

  /**
   * Log a user activity. Activities are batched for performance.
   */
  async logActivity(payload: ActivityLogPayload): Promise<void> {
    try {
      const userId = payload.userId || 'default_user';
      
      logger.debug("[ActivityLogService] Queueing activity:", { 
        type: payload.activityType, 
        userId 
      });

      // Add to queue
      this.activityQueue.push(payload);

      // Check if we should flush immediately
      if (this.activityQueue.length >= this.MAX_QUEUE_SIZE) {
        await this.flushQueue();
      } else {
        // Schedule a flush if not already scheduled
        this.scheduleFlush();
      }
    } catch (error) {
      logger.error("[ActivityLogService] Error logging activity:", error);
      throw error;
    }
  }

  /**
   * Get activities for analysis or display.
   */
  async getActivities(
    userId: string = 'default_user',
    options?: {
      startTime?: number;
      endTime?: number;
      activityTypes?: ActivityType[];
      limit?: number;
    }
  ): Promise<UserActivity[]> {
    try {
      // Flush any pending activities first
      await this.flushQueue();

      return this.activityLogModel.getActivities(
        userId,
        options?.startTime,
        options?.endTime,
        options?.activityTypes,
        options?.limit
      );
    } catch (error) {
      logger.error("[ActivityLogService] Error getting activities:", error);
      throw error;
    }
  }

  /**
   * Get recent activities for a user.
   */
  async getRecentActivities(
    userId: string = 'default_user',
    hoursAgo: number = 24,
    limit?: number
  ): Promise<UserActivity[]> {
    try {
      // Flush any pending activities first
      await this.flushQueue();

      return this.activityLogModel.getRecentActivities(userId, hoursAgo, limit);
    } catch (error) {
      logger.error("[ActivityLogService] Error getting recent activities:", error);
      throw error;
    }
  }

  /**
   * Get activity statistics for a user.
   */
  async getActivityStats(
    userId: string = 'default_user',
    startTime?: number,
    endTime?: number
  ): Promise<{
    totalCount: number;
    countByType: Record<ActivityType, number>;
    mostFrequentType: ActivityType | null;
  }> {
    try {
      // Flush any pending activities first
      await this.flushQueue();

      const counts = this.activityLogModel.getActivityCounts(userId, startTime, endTime);
      
      let totalCount = 0;
      let mostFrequentType: ActivityType | null = null;
      let maxCount = 0;

      Object.entries(counts).forEach(([type, count]) => {
        totalCount += count;
        if (count > maxCount) {
          maxCount = count;
          mostFrequentType = type as ActivityType;
        }
      });

      return {
        totalCount,
        countByType: counts,
        mostFrequentType,
      };
    } catch (error) {
      logger.error("[ActivityLogService] Error getting activity stats:", error);
      throw error;
    }
  }

  /**
   * Helper method to log common activities with standardized details.
   */
  async logNotebookVisit(notebookId: string, notebookTitle?: string): Promise<void> {
    await this.logActivity({
      activityType: 'notebook_visit',
      details: { notebookId, notebookTitle, timestamp: Date.now() },
    });
  }

  async logIntentSelected(intentText: string, context: string, notebookId?: string): Promise<void> {
    await this.logActivity({
      activityType: 'intent_selected',
      details: { intentText, context, notebookId, timestamp: Date.now() },
    });
  }

  async logChatSessionStarted(sessionId: string, notebookId: string): Promise<void> {
    await this.logActivity({
      activityType: 'chat_session_started',
      details: { sessionId, notebookId, timestamp: Date.now() },
    });
  }

  async logSearchPerformed(query: string, resultsCount: number, notebookId?: string): Promise<void> {
    await this.logActivity({
      activityType: 'search_performed',
      details: { query, resultsCount, notebookId, timestamp: Date.now() },
    });
  }

  async logBrowserNavigation(url: string, title?: string, notebookId?: string): Promise<void> {
    await this.logActivity({
      activityType: 'browser_navigation',
      details: { url, title, notebookId, timestamp: Date.now() },
    });
  }

  async logInfoSliceSelected(chunkId: number, sourceObjectId: string, notebookId?: string): Promise<void> {
    await this.logActivity({
      activityType: 'info_slice_selected',
      details: { chunkId, sourceObjectId, notebookId, timestamp: Date.now() },
    });
  }

  async logStatedGoalAdded(goalId: string, goalText: string, priority?: number): Promise<void> {
    await this.logActivity({
      activityType: 'stated_goal_added',
      details: { goalId, goalText, priority, timestamp: Date.now() },
    });
  }

  async logStatedGoalUpdated(goalId: string, goalText: string, status: string): Promise<void> {
    await this.logActivity({
      activityType: 'stated_goal_updated',
      details: { goalId, goalText, status, timestamp: Date.now() },
    });
  }

  async logStatedGoalCompleted(goalId: string, goalText: string): Promise<void> {
    await this.logActivity({
      activityType: 'stated_goal_completed',
      details: { goalId, goalText, timestamp: Date.now() },
    });
  }

  /**
   * Clean up old activities to prevent unbounded growth.
   */
  async cleanupOldActivities(
    userId: string = 'default_user',
    daysToKeep: number = 90
  ): Promise<number> {
    try {
      const deletedCount = this.activityLogModel.deleteOldActivities(userId, daysToKeep);
      logger.info("[ActivityLogService] Cleaned up old activities:", { 
        userId, 
        deletedCount, 
        daysToKeep 
      });
      return deletedCount;
    } catch (error) {
      logger.error("[ActivityLogService] Error cleaning up activities:", error);
      throw error;
    }
  }

  /**
   * Force flush any pending activities (e.g., on shutdown).
   */
  async shutdown(): Promise<void> {
    try {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      await this.flushQueue();
      logger.info("[ActivityLogService] Shutdown complete.");
    } catch (error) {
      logger.error("[ActivityLogService] Error during shutdown:", error);
      throw error;
    }
  }

  /**
   * Schedule a flush of the activity queue.
   */
  private scheduleFlush(): void {
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
  private async flushQueue(): Promise<void> {
    if (this.activityQueue.length === 0) {
      return;
    }

    const activitiesToFlush = [...this.activityQueue];
    this.activityQueue = [];

    try {
      // Process each activity
      for (const activity of activitiesToFlush) {
        const userId = activity.userId || 'default_user';
        this.activityLogModel.addActivity(
          activity.activityType,
          activity.details,
          userId
        );
      }

      logger.debug("[ActivityLogService] Flushed activities:", { 
        count: activitiesToFlush.length 
      });
    } catch (error) {
      // On error, add activities back to queue for retry
      this.activityQueue.unshift(...activitiesToFlush);
      logger.error("[ActivityLogService] Error flushing queue, will retry:", error);
      throw error;
    }
  }
}

// Export a singleton instance with lazy initialization
let _activityLogService: ActivityLogService | null = null;

export function getActivityLogService(): ActivityLogService {
  if (!_activityLogService) {
    _activityLogService = new ActivityLogService();
  }
  return _activityLogService;
}

// For backward compatibility, export a getter that initializes on first access
export const activityLogService = {
  get(): ActivityLogService {
    return getActivityLogService();
  }
};