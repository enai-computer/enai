import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ActivityLogService } from '../ActivityLogService';
import { ActivityLogModel } from '../../models/ActivityLogModel';
import { ActivityType, UserActivity, ActivityLogPayload } from '../../shared/types';
import { initDb, closeDb } from '../../models/db';
import runMigrations from '../../models/runMigrations';
import { logger } from '../../utils/logger';

// Mock logger to prevent console output during tests
vi.mock('../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('ActivityLogService', () => {
    let db: Database.Database;
    let activityLogModel: ActivityLogModel;
    let activityLogService: ActivityLogService;

    beforeEach(async () => {
        // Ensure JEFFERS_DB_PATH is :memory: so initDb() uses an in-memory DB
        vi.stubEnv('JEFFERS_DB_PATH', ':memory:');
        
        // Initialize the global dbInstance to an in-memory database
        db = initDb();
        await runMigrations(db);
        
        // Initialize model and service
        activityLogModel = new ActivityLogModel(db);
        activityLogService = new ActivityLogService(activityLogModel);
    });

    afterEach(async () => {
        // Make sure to flush any pending activities before closing
        try {
            await activityLogService.shutdown();
        } catch (error) {
            // Ignore shutdown errors in cleanup
        }
        closeDb(); // Use the global helper to close and nullify the singleton instance
        vi.unstubAllEnvs(); // Restore original environment variables
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    describe('logActivity', () => {
        it('should queue activities for batch processing', async () => {
            const payload: ActivityLogPayload = {
                activityType: 'notebook_visit',
                details: { notebookId: 'test-notebook', title: 'Test' }
            };

            await activityLogService.logActivity(payload);
            
            // Activity should be queued, not immediately written
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(0);
            
            // Force flush
            await activityLogService.shutdown();
            
            // Now activity should be in database
            const activitiesAfterFlush = activityLogModel.getActivities();
            expect(activitiesAfterFlush).toHaveLength(1);
            expect(activitiesAfterFlush[0].activityType).toBe('notebook_visit');
        });

        it('should use default userId if not provided', async () => {
            await activityLogService.logActivity({
                activityType: 'intent_selected',
                details: { intentText: 'test intent' }
            });
            
            await activityLogService.shutdown();
            
            const activities = activityLogModel.getActivities('default_user');
            expect(activities).toHaveLength(1);
            expect(activities[0].userId).toBe('default_user');
        });

        it('should use provided userId', async () => {
            await activityLogService.logActivity({
                userId: 'custom_user',
                activityType: 'search_performed',
                details: { query: 'test query', resultsCount: 5 }
            });
            
            await activityLogService.shutdown();
            
            const activities = activityLogModel.getActivities('custom_user');
            expect(activities).toHaveLength(1);
            expect(activities[0].userId).toBe('custom_user');
        });

        it('should force flush when queue reaches MAX_QUEUE_SIZE', async () => {
            // The MAX_QUEUE_SIZE is 100 according to the service
            const promises: Promise<void>[] = [];
            for (let i = 0; i < 100; i++) {
                promises.push(activityLogService.logActivity({
                    activityType: 'notebook_visit',
                    details: { notebookId: `notebook-${i}` }
                }));
            }
            
            await Promise.all(promises);
            
            // Should have flushed automatically
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(100);
        });

        it('should handle errors during flush and re-queue activities', async () => {
            // Mock addActivity to throw error once
            const originalAddActivity = activityLogModel.addActivity.bind(activityLogModel);
            let callCount = 0;
            vi.spyOn(activityLogModel, 'addActivity').mockImplementation((...args) => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('Database error');
                }
                return originalAddActivity(...args);
            });

            await activityLogService.logActivity({
                activityType: 'notebook_visit',
                details: { notebookId: 'test' }
            });
            
            // Force flush - should fail
            await expect(activityLogService.shutdown()).rejects.toThrow('Database error');
            
            // Restore mock and try again
            vi.mocked(activityLogModel.addActivity).mockRestore();
            
            // Activity should still be in queue and flush successfully now
            await activityLogService.shutdown();
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(1);
        });
    });

    describe('getActivities', () => {
        beforeEach(async () => {
            // Add some test activities directly to the model
            activityLogModel.addActivity('notebook_visit', { notebookId: '1' }, 'user1');
            activityLogModel.addActivity('search_performed', { query: 'test' }, 'user1');
            activityLogModel.addActivity('intent_selected', { intentText: 'create' }, 'user2');
        });

        it('should flush pending activities before returning', async () => {
            // Add an activity through the service (will be queued)
            await activityLogService.logActivity({
                userId: 'user1',
                activityType: 'browser_navigation',
                details: { url: 'https://example.com' }
            });

            // Get activities - should flush first
            const activities = await activityLogService.getActivities('user1');
            
            expect(activities).toHaveLength(3); // 2 existing + 1 flushed
            expect(activities.some(a => a.activityType === 'browser_navigation')).toBe(true);
        });

        it('should filter by time range', async () => {
            const now = Date.now();
            const hourAgo = now - 60 * 60 * 1000;
            
            const activities = await activityLogService.getActivities('user1', {
                startTime: hourAgo,
                endTime: now
            });
            
            expect(activities).toHaveLength(2);
        });

        it('should filter by activity types', async () => {
            const activities = await activityLogService.getActivities('user1', {
                activityTypes: ['notebook_visit']
            });
            
            expect(activities).toHaveLength(1);
            expect(activities[0].activityType).toBe('notebook_visit');
        });

        it('should respect limit parameter', async () => {
            const activities = await activityLogService.getActivities('user1', {
                limit: 1
            });
            
            expect(activities).toHaveLength(1);
        });
    });

    describe('getRecentActivities', () => {
        it('should get activities from last N hours', async () => {
            // Add an old activity
            const stmt = db.prepare(`
                INSERT INTO user_activities (id, timestamp, activity_type, details_json, user_id)
                VALUES ($id, $timestamp, $activityType, $detailsJson, $userId)
            `);
            stmt.run({
                id: 'old-activity',
                timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
                activityType: 'notebook_visit',
                detailsJson: JSON.stringify({ notebookId: 'old' }),
                userId: 'test_user',
            });

            // Add a recent activity
            activityLogModel.addActivity('search_performed', { query: 'recent' }, 'test_user');

            const recentActivities = await activityLogService.getRecentActivities('test_user', 24);
            
            expect(recentActivities).toHaveLength(1);
            expect(recentActivities[0].activityType).toBe('search_performed');
        });

        it('should respect limit parameter', async () => {
            // Add multiple activities
            for (let i = 0; i < 5; i++) {
                activityLogModel.addActivity('notebook_visit', { notebookId: `nb-${i}` });
            }

            const activities = await activityLogService.getRecentActivities('default_user', 24, 3);
            
            expect(activities).toHaveLength(3);
        });
    });

    describe('getActivityStats', () => {
        beforeEach(async () => {
            // Add various activities directly to model (not through service to avoid queueing)
            activityLogModel.addActivity('notebook_visit', { id: '1' });
            activityLogModel.addActivity('notebook_visit', { id: '2' });
            activityLogModel.addActivity('search_performed', { query: 'test' });
            activityLogModel.addActivity('intent_selected', { intent: 'create' });
            activityLogModel.addActivity('intent_selected', { intent: 'delete' });
            activityLogModel.addActivity('intent_selected', { intent: 'update' });
            
            // Make sure no activities are queued in the service
            await activityLogService.shutdown();
            // Recreate service to clear any state
            activityLogService = new ActivityLogService(activityLogModel);
        });

        it('should calculate activity statistics', async () => {
            const stats = await activityLogService.getActivityStats();
            
            expect(stats.totalCount).toBe(6);
            expect(stats.countByType['notebook_visit']).toBe(2);
            expect(stats.countByType['search_performed']).toBe(1);
            expect(stats.countByType['intent_selected']).toBe(3);
            expect(stats.mostFrequentType).toBe('intent_selected');
        });

        it('should filter stats by time range', async () => {
            const now = Date.now();
            const oneHourAgo = now - 3600000;
            const twoHoursAgo = now - 7200000;
            
            // Clear existing activities and add some with specific timestamps
            db.exec('DELETE FROM user_activities');
            
            // Add old activities (2 hours ago)
            const stmt = db.prepare(`
                INSERT INTO user_activities (id, timestamp, activity_type, details_json, user_id)
                VALUES ($id, $timestamp, $activityType, $detailsJson, $userId)
            `);
            
            stmt.run({
                id: 'old-1',
                timestamp: twoHoursAgo,
                activityType: 'notebook_visit',
                detailsJson: JSON.stringify({ id: 'old1' }),
                userId: 'default_user'
            });
            
            // Add recent activity (within the hour)
            stmt.run({
                id: 'recent-1',
                timestamp: now - 1000, // 1 second ago
                activityType: 'search_performed',
                detailsJson: JSON.stringify({ query: 'recent' }),
                userId: 'default_user'
            });
            
            // Stats for last hour should only include recent activity
            const recentStats = await activityLogService.getActivityStats('default_user', oneHourAgo, now);
            expect(recentStats.totalCount).toBe(1);
            expect(recentStats.mostFrequentType).toBe('search_performed');
            
            // Stats for future time range should be empty
            const futureStats = await activityLogService.getActivityStats('default_user', now + 1000, now + 60000);
            expect(futureStats.totalCount).toBe(0);
            expect(futureStats.mostFrequentType).toBeNull();
        });
    });

    describe('countRecentActivities', () => {
        it('should count activities in time window', async () => {
            // Add activities
            for (let i = 0; i < 5; i++) {
                activityLogModel.addActivity('notebook_visit', { id: `nb-${i}` });
            }

            const count = await activityLogService.countRecentActivities('default_user', 24);
            
            expect(count).toBe(5);
        });
    });

    describe('helper methods', () => {
        it('should log notebook visit', async () => {
            await activityLogService.logNotebookVisit('notebook-123', 'My Notebook');
            await activityLogService.shutdown();
            
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(1);
            expect(activities[0].activityType).toBe('notebook_visit');
            const details = JSON.parse(activities[0].detailsJson);
            expect(details.notebookId).toBe('notebook-123');
            expect(details.notebookTitle).toBe('My Notebook');
        });

        it('should log intent selected', async () => {
            await activityLogService.logIntentSelected('create notebook Test', 'chat', 'notebook-123');
            await activityLogService.shutdown();
            
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(1);
            expect(activities[0].activityType).toBe('intent_selected');
            const details = JSON.parse(activities[0].detailsJson);
            expect(details.intentText).toBe('create notebook Test');
            expect(details.context).toBe('chat');
            expect(details.notebookId).toBe('notebook-123');
        });

        it('should log chat session started', async () => {
            await activityLogService.logChatSessionStarted('session-123', 'notebook-123');
            await activityLogService.shutdown();
            
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(1);
            expect(activities[0].activityType).toBe('chat_session_started');
            const details = JSON.parse(activities[0].detailsJson);
            expect(details.sessionId).toBe('session-123');
            expect(details.notebookId).toBe('notebook-123');
        });

        it('should log search performed', async () => {
            await activityLogService.logSearchPerformed('TypeScript tutorial', 10, 'notebook-123');
            await activityLogService.shutdown();
            
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(1);
            expect(activities[0].activityType).toBe('search_performed');
            const details = JSON.parse(activities[0].detailsJson);
            expect(details.query).toBe('TypeScript tutorial');
            expect(details.resultsCount).toBe(10);
            expect(details.notebookId).toBe('notebook-123');
        });

        it('should log browser navigation', async () => {
            await activityLogService.logBrowserNavigation('https://example.com', 'Example Site', 'notebook-123');
            await activityLogService.shutdown();
            
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(1);
            expect(activities[0].activityType).toBe('browser_navigation');
            const details = JSON.parse(activities[0].detailsJson);
            expect(details.url).toBe('https://example.com');
            expect(details.title).toBe('Example Site');
            expect(details.notebookId).toBe('notebook-123');
        });

        it('should log info slice selected', async () => {
            await activityLogService.logInfoSliceSelected(123, 'object-456', 'notebook-789');
            await activityLogService.shutdown();
            
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(1);
            expect(activities[0].activityType).toBe('info_slice_selected');
            const details = JSON.parse(activities[0].detailsJson);
            expect(details.chunkId).toBe(123);
            expect(details.sourceObjectId).toBe('object-456');
            expect(details.notebookId).toBe('notebook-789');
        });

        it('should log stated goal operations', async () => {
            // Add goal
            await activityLogService.logStatedGoalAdded('goal-1', 'Learn TypeScript', 1);
            
            // Update goal
            await activityLogService.logStatedGoalUpdated('goal-1', 'Learn TypeScript', 'in_progress');
            
            // Complete goal
            await activityLogService.logStatedGoalCompleted('goal-1', 'Learn TypeScript');
            
            await activityLogService.shutdown();
            
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(3);
            
            expect(activities[0].activityType).toBe('stated_goal_added');
            expect(activities[1].activityType).toBe('stated_goal_updated');
            expect(activities[2].activityType).toBe('stated_goal_completed');
        });
    });

    describe('cleanupOldActivities', () => {
        it('should delete activities older than specified days', async () => {
            // Add old activities
            const stmt = db.prepare(`
                INSERT INTO user_activities (id, timestamp, activity_type, details_json, user_id)
                VALUES ($id, $timestamp, $activityType, $detailsJson, $userId)
            `);
            
            const now = Date.now();
            const oldTimestamp = now - 100 * 24 * 60 * 60 * 1000; // 100 days ago
            
            stmt.run({
                id: 'old-1',
                timestamp: oldTimestamp,
                activityType: 'notebook_visit',
                detailsJson: JSON.stringify({ id: 'old' }),
                userId: 'test_user',
            });
            
            // Add recent activity
            activityLogModel.addActivity('notebook_visit', { id: 'recent' }, 'test_user');
            
            const deletedCount = await activityLogService.cleanupOldActivities('test_user', 90);
            
            expect(deletedCount).toBe(1);
            
            const remainingActivities = activityLogModel.getActivities('test_user');
            expect(remainingActivities).toHaveLength(1);
            expect(JSON.parse(remainingActivities[0].detailsJson).id).toBe('recent');
        });
    });

    describe('shutdown', () => {
        it('should clear timer and flush queue on shutdown', async () => {
            vi.useFakeTimers();
            
            // Add some activities
            await activityLogService.logActivity({
                activityType: 'notebook_visit',
                details: { id: '1' }
            });
            
            await activityLogService.logActivity({
                activityType: 'search_performed',
                details: { query: 'test' }
            });
            
            // Activities should be queued
            const activitiesBeforeShutdown = activityLogModel.getActivities();
            expect(activitiesBeforeShutdown).toHaveLength(0);
            
            // Shutdown
            vi.useRealTimers(); // Need real timers for async operations
            await activityLogService.shutdown();
            
            // Activities should be flushed
            const activitiesAfterShutdown = activityLogModel.getActivities();
            expect(activitiesAfterShutdown).toHaveLength(2);
            
            expect(logger.info).toHaveBeenCalledWith('[ActivityLogService] Shutdown complete.');
        });

        it('should handle errors during shutdown', async () => {
            // Add an activity to the queue first
            await activityLogService.logActivity({
                activityType: 'notebook_visit',
                details: { id: '1' }
            });
            
            // Mock addActivity to throw error when flushing
            vi.spyOn(activityLogModel, 'addActivity').mockImplementation(() => {
                throw new Error('Shutdown error');
            });
            
            // Shutdown should reject with the error
            await expect(activityLogService.shutdown()).rejects.toThrow('Shutdown error');
            
            expect(logger.error).toHaveBeenCalledWith(
                '[ActivityLogService] Error during shutdown:',
                expect.any(Error)
            );
        });
    });

    describe('automatic flush timer', () => {
        it('should automatically flush after FLUSH_INTERVAL_MS', async () => {
            vi.useFakeTimers();
            
            // Add an activity
            await activityLogService.logActivity({
                activityType: 'notebook_visit',
                details: { id: '1' }
            });
            
            // Should not be in database yet
            let activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(0);
            
            // Advance time by flush interval (5 seconds)
            vi.advanceTimersByTime(5000);
            
            // Wait for async flush to complete
            await vi.runAllTimersAsync();
            
            // Should now be in database
            activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(1);
            
            vi.useRealTimers();
        });

        it('should not schedule multiple flush timers', async () => {
            vi.useFakeTimers();
            
            // Add multiple activities quickly
            await activityLogService.logActivity({
                activityType: 'notebook_visit',
                details: { id: '1' }
            });
            
            await activityLogService.logActivity({
                activityType: 'search_performed',
                details: { query: 'test' }
            });
            
            await activityLogService.logActivity({
                activityType: 'intent_selected',
                details: { intent: 'create' }
            });
            
            // Advance time and flush
            vi.advanceTimersByTime(5000);
            await vi.runAllTimersAsync();
            
            // All activities should be flushed together
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(3);
            
            vi.useRealTimers();
        });
    });

    describe('singleton pattern', () => {
        it('should return the same instance from getActivityLogService', async () => {
            // Import fresh to test singleton pattern
            const module = await import('../ActivityLogService');
            const instance1 = module.getActivityLogService();
            const instance2 = module.getActivityLogService();
            
            expect(instance1).toBe(instance2);
        });

        it('should support legacy activityLogService.get() pattern', async () => {
            // Import fresh to test legacy pattern
            const module = await import('../ActivityLogService');
            const instance = module.activityLogService.get();
            
            expect(instance).toBeInstanceOf(ActivityLogService);
        });
    });
});