import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { logger } from '../utils/logger';
import { UserActivity, ActivityType } from '../shared/types';

interface ActivityLogRecord {
  id: string;
  timestamp: number;
  activity_type: string;
  details_json: string;
  user_id: string;
}

function mapRecordToActivity(record: ActivityLogRecord): UserActivity {
  return {
    id: record.id,
    timestamp: new Date(record.timestamp),
    activityType: record.activity_type as ActivityType,
    detailsJson: record.details_json,
    userId: record.user_id,
  };
}

export class ActivityLogModel {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    logger.info("[ActivityLogModel] Initialized.");
  }

  /**
   * Add a new activity log entry.
   */
  addActivity(
    activityType: ActivityType,
    details: Record<string, any>,
    userId: string = 'default_user'
  ): void {
    const id = uuidv4();
    const timestamp = Date.now();
    const detailsJson = JSON.stringify(details);

    try {
      const stmt = this.db.prepare(`
        INSERT INTO user_activities (id, timestamp, activity_type, details_json, user_id)
        VALUES ($id, $timestamp, $activityType, $detailsJson, $userId)
      `);

      stmt.run({
        id,
        timestamp,
        activityType,
        detailsJson,
        userId,
      });

      logger.debug("[ActivityLogModel] Activity logged:", { id, activityType, userId });
    } catch (error) {
      logger.error("[ActivityLogModel] Error adding activity:", error);
      throw error;
    }
  }

  /**
   * Get activities for a user within a time range.
   */
  getActivities(
    userId: string = 'default_user',
    startTime?: number,
    endTime?: number,
    activityTypes?: ActivityType[],
    limit?: number
  ): UserActivity[] {
    try {
      let query = `
        SELECT * FROM user_activities
        WHERE user_id = $userId
      `;

      const params: any = { userId };

      if (startTime) {
        query += ` AND timestamp >= $startTime`;
        params.startTime = startTime;
      }

      if (endTime) {
        query += ` AND timestamp <= $endTime`;
        params.endTime = endTime;
      }

      if (activityTypes && activityTypes.length > 0) {
        const placeholders = activityTypes.map((_, i) => `$type${i}`).join(', ');
        query += ` AND activity_type IN (${placeholders})`;
        activityTypes.forEach((type, i) => {
          params[`type${i}`] = type;
        });
      }

      query += ` ORDER BY timestamp DESC`;

      if (limit) {
        query += ` LIMIT $limit`;
        params.limit = limit;
      }

      const stmt = this.db.prepare(query);
      const records = stmt.all(params) as ActivityLogRecord[];

      return records.map(mapRecordToActivity);
    } catch (error) {
      logger.error("[ActivityLogModel] Error getting activities:", error);
      throw error;
    }
  }

  /**
   * Get recent activities for a user.
   */
  getRecentActivities(
    userId: string = 'default_user',
    hoursAgo: number = 24,
    limit?: number
  ): UserActivity[] {
    const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
    return this.getActivities(userId, startTime, undefined, undefined, limit);
  }

  /**
   * Get activity count by type for analytics.
   */
  getActivityCounts(
    userId: string = 'default_user',
    startTime?: number,
    endTime?: number
  ): Record<ActivityType, number> {
    try {
      let query = `
        SELECT activity_type, COUNT(*) as count
        FROM user_activities
        WHERE user_id = $userId
      `;

      const params: any = { userId };

      if (startTime) {
        query += ` AND timestamp >= $startTime`;
        params.startTime = startTime;
      }

      if (endTime) {
        query += ` AND timestamp <= $endTime`;
        params.endTime = endTime;
      }

      query += ` GROUP BY activity_type`;

      const stmt = this.db.prepare(query);
      const results = stmt.all(params) as { activity_type: string; count: number }[];

      const counts: Partial<Record<ActivityType, number>> = {};
      results.forEach(row => {
        counts[row.activity_type as ActivityType] = row.count;
      });

      return counts as Record<ActivityType, number>;
    } catch (error) {
      logger.error("[ActivityLogModel] Error getting activity counts:", error);
      throw error;
    }
  }

  /**
   * Delete old activities for cleanup.
   */
  deleteOldActivities(
    userId: string = 'default_user',
    daysToKeep: number = 90
  ): number {
    try {
      const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
      
      const stmt = this.db.prepare(`
        DELETE FROM user_activities
        WHERE user_id = $userId AND timestamp < $cutoffTime
      `);

      const result = stmt.run({ userId, cutoffTime });
      
      logger.info("[ActivityLogModel] Deleted old activities:", {
        userId,
        deletedCount: result.changes,
        daysToKeep,
      });

      return result.changes;
    } catch (error) {
      logger.error("[ActivityLogModel] Error deleting old activities:", error);
      throw error;
    }
  }
}