import { ActivityLogModel } from '../models/ActivityLogModel';
import { ActivityType, UserActivity, ActivityLogPayload } from '../shared/types';
import { BaseService } from './base/BaseService';
import Database from 'better-sqlite3';

interface ActivityLogServiceDeps {
  db: Database.Database;
  activityLogModel: ActivityLogModel;
}

export class ActivityLogService extends BaseService<ActivityLogServiceDeps> {
  private activityQueue: ActivityLogPayload[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 5000; // Batch writes every 5 seconds
  private readonly MAX_QUEUE_SIZE = 100; // Force flush if queue gets too large

  constructor(deps: ActivityLogServiceDeps) {
    super('ActivityLogService', deps);
    this.logger.info("[ActivityLogService] Initialized.");
  }

  /**
   * Log a user activity. Activities are batched for performance.
   */
  async logActivity(payload: ActivityLogPayload): Promise<void> {
    try {
      const userId = payload.userId || 'default_user';
      
      this.logger.debug("[ActivityLogService] Queueing activity:", { 
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
      this.logger.error("[ActivityLogService] Error logging activity:", error);
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

      return this.deps.activityLogModel.getActivities(
        userId,
        options?.startTime,
        options?.endTime,
        options?.activityTypes,
        options?.limit
      );
    } catch (error) {
      this.logger.error("[ActivityLogService] Error getting activities:", error);
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

      return this.deps.activityLogModel.getRecentActivities(userId, hoursAgo, limit);
    } catch (error) {
      this.logger.error("[ActivityLogService] Error getting recent activities:", error);
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

      const counts = this.deps.activityLogModel.getActivityCounts(userId, startTime, endTime);
      
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
      this.logger.error("[ActivityLogService] Error getting activity stats:", error);
      throw error;
    }
  }

  /**
   * Count recent activities for a user.
   */
  async countRecentActivities(
    userId: string = 'default_user',
    hoursAgo: number = 24
  ): Promise<number> {
    try {
      // Flush any pending activities first
      await this.flushQueue();

      return this.deps.activityLogModel.countRecentActivities(userId, hoursAgo);
    } catch (error) {
      this.logger.error("[ActivityLogService] Error counting recent activities:", error);
      throw error;
    }
  }

  /**
   * Helper method to log common activities with standardized details.
   */
  async logNotebookVisit(notebookId: string, notebookTitle?: string): Promise<void> {
    await this.logActivity({
      activityType: 'notebook_visit',
      details: { notebookId, notebookTitle },
    });
  }

  async logIntentSelected(intentText: string, context: string, notebookId?: string): Promise<void> {
    await this.logActivity({
      activityType: 'intent_selected',
      details: { intentText, context, notebookId },
    });
  }

  async logChatSessionStarted(sessionId: string, notebookId: string): Promise<void> {
    await this.logActivity({
      activityType: 'chat_session_started',
      details: { sessionId, notebookId },
    });
  }

  async logSearchPerformed(query: string, resultsCount: number, notebookId?: string): Promise<void> {
    await this.logActivity({
      activityType: 'search_performed',
      details: { query, resultsCount, notebookId },
    });
  }

  async logBrowserNavigation(url: string, title?: string, notebookId?: string): Promise<void> {
    await this.logActivity({
      activityType: 'browser_navigation',
      details: { url, title, notebookId },
    });
  }

  async logInfoSliceSelected(chunkId: number, sourceObjectId: string, notebookId?: string): Promise<void> {
    await this.logActivity({
      activityType: 'info_slice_selected',
      details: { chunkId, sourceObjectId, notebookId },
    });
  }

  async logStatedGoalAdded(goalId: string, goalText: string, priority?: number): Promise<void> {
    await this.logActivity({
      activityType: 'stated_goal_added',
      details: { goalId, goalText, priority },
    });
  }

  async logStatedGoalUpdated(goalId: string, goalText: string, status: string): Promise<void> {
    await this.logActivity({
      activityType: 'stated_goal_updated',
      details: { goalId, goalText, status },
    });
  }

  async logStatedGoalCompleted(goalId: string, goalText: string): Promise<void> {
    await this.logActivity({
      activityType: 'stated_goal_completed',
      details: { goalId, goalText },
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
      const deletedCount = this.deps.activityLogModel.deleteOldActivities(userId, daysToKeep);
      this.logger.info("[ActivityLogService] Cleaned up old activities:", { 
        userId, 
        deletedCount, 
        daysToKeep 
      });
      return deletedCount;
    } catch (error) {
      this.logger.error("[ActivityLogService] Error cleaning up activities:", error);
      throw error;
    }
  }

  /**
   * Cleanup resources used by the service.
   * Force flush any pending activities and clear timers.
   */
  async cleanup(): Promise<void> {
    try {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      await this.flushQueue();
      this.logger.info("[ActivityLogService] Cleanup complete.");
    } catch (error) {
      this.logger.error("[ActivityLogService] Error during cleanup:", error);
      throw error;
    }
  }

  /**
   * Backward compatibility alias for cleanup().
   * @deprecated Use cleanup() instead
   */
  async shutdown(): Promise<void> {
    return this.cleanup();
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
        this.deps.activityLogModel.addActivity(
          activity.activityType,
          activity.details,
          userId
        );
      }

      this.logger.debug("[ActivityLogService] Flushed activities:", { 
        count: activitiesToFlush.length 
      });
    } catch (error) {
      // On error, add activities back to queue for retry
      this.activityQueue.unshift(...activitiesToFlush);
      this.logger.error("[ActivityLogService] Error flushing queue, will retry:", error);
      throw error;
    }
  }
}

