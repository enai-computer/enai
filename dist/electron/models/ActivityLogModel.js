"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivityLogModel = void 0;
const uuid_1 = require("uuid");
const logger_1 = require("../utils/logger");
function mapRecordToActivity(record) {
    return {
        id: record.id,
        timestamp: new Date(record.timestamp),
        activityType: record.activity_type,
        detailsJson: record.details_json,
        userId: record.user_id,
    };
}
class ActivityLogModel {
    constructor(db) {
        this.db = db;
        logger_1.logger.info("[ActivityLogModel] Initialized.");
    }
    /**
     * Add a new activity log entry.
     */
    addActivity(activityType, details, userId = 'default_user') {
        const id = (0, uuid_1.v4)();
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
            logger_1.logger.debug("[ActivityLogModel] Activity logged:", { id, activityType, userId });
        }
        catch (error) {
            logger_1.logger.error("[ActivityLogModel] Error adding activity:", error);
            throw error;
        }
    }
    /**
     * Get activities for a user within a time range.
     */
    getActivities(userId = 'default_user', startTime, endTime, activityTypes, limit) {
        try {
            let query = `
        SELECT * FROM user_activities
        WHERE user_id = $userId
      `;
            const params = { userId };
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
            const records = stmt.all(params);
            return records.map(mapRecordToActivity);
        }
        catch (error) {
            logger_1.logger.error("[ActivityLogModel] Error getting activities:", error);
            throw error;
        }
    }
    /**
     * Get recent activities for a user.
     */
    getRecentActivities(userId = 'default_user', hoursAgo = 24, limit) {
        const startTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
        return this.getActivities(userId, startTime, undefined, undefined, limit);
    }
    /**
     * Get activity count by type for analytics.
     */
    getActivityCounts(userId = 'default_user', startTime, endTime) {
        try {
            let query = `
        SELECT activity_type, COUNT(*) as count
        FROM user_activities
        WHERE user_id = $userId
      `;
            const params = { userId };
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
            const results = stmt.all(params);
            const counts = {};
            results.forEach(row => {
                counts[row.activity_type] = row.count;
            });
            return counts;
        }
        catch (error) {
            logger_1.logger.error("[ActivityLogModel] Error getting activity counts:", error);
            throw error;
        }
    }
    /**
     * Delete old activities for cleanup.
     */
    deleteOldActivities(userId = 'default_user', daysToKeep = 90) {
        try {
            const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
            const stmt = this.db.prepare(`
        DELETE FROM user_activities
        WHERE user_id = $userId AND timestamp < $cutoffTime
      `);
            const result = stmt.run({ userId, cutoffTime });
            logger_1.logger.info("[ActivityLogModel] Deleted old activities:", {
                userId,
                deletedCount: result.changes,
                daysToKeep,
            });
            return result.changes;
        }
        catch (error) {
            logger_1.logger.error("[ActivityLogModel] Error deleting old activities:", error);
            throw error;
        }
    }
}
exports.ActivityLogModel = ActivityLogModel;
//# sourceMappingURL=ActivityLogModel.js.map