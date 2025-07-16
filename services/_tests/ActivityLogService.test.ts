import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ActivityLogService } from '../ActivityLogService';
import { ActivityLogModel } from '../../models/ActivityLogModel';
import { ObjectModelCore } from '../../models/ObjectModelCore';
import { LanceVectorModel } from '../../models/LanceVectorModel';
import { ActivityLogPayload } from '../../shared/types';
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
    let objectModelCore: ObjectModelCore;
    let lanceVectorModel: LanceVectorModel;
    let activityLogService: ActivityLogService;

    beforeEach(async () => {
        // Create in-memory database
        db = new Database(':memory:');
        await runMigrations(db);
        
        // Initialize models
        activityLogModel = new ActivityLogModel(db);
        objectModelCore = new ObjectModelCore(db);
        lanceVectorModel = new LanceVectorModel();
        
        // Create service with dependency injection
        activityLogService = new ActivityLogService({
            db,
            activityLogModel,
            objectModelCore,
            lanceVectorModel
        });
        
        // Initialize service
        await activityLogService.initialize();
    });

    afterEach(async () => {
        // Clean up
        await activityLogService.cleanup();
        if (db && db.open) {
            db.close();
        }
        vi.clearAllMocks();
    });

    describe('logActivity', () => {
        it('should log activities with proper userId handling', async () => {
            // Log with default userId
            await activityLogService.logActivity({
                activityType: 'notebook_visit',
                details: { notebookId: 'test-notebook', title: 'Test' }
            });
            
            // Log with custom userId
            await activityLogService.logActivity({
                userId: 'custom_user',
                activityType: 'search_performed',
                details: { query: 'test query', resultsCount: 5 }
            });
            
            // Force flush to verify
            await activityLogService.cleanup();
            
            const defaultUserActivities = activityLogModel.getActivities('default_user');
            expect(defaultUserActivities).toHaveLength(1);
            expect(defaultUserActivities[0].activityType).toBe('notebook_visit');
            
            const customUserActivities = activityLogModel.getActivities('custom_user');
            expect(customUserActivities).toHaveLength(1);
            expect(customUserActivities[0].activityType).toBe('search_performed');
        });

        it('should batch activities and handle flush on queue size limit', async () => {
            // The MAX_QUEUE_SIZE is 100 according to the service
            const promises: Promise<void>[] = [];
            for (let i = 0; i < 100; i++) {
                promises.push(activityLogService.logActivity({
                    activityType: 'notebook_visit',
                    details: { notebookId: `notebook-${i}` }
                }));
            }
            
            await Promise.all(promises);
            
            // Should have flushed automatically when queue reached limit
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(100);
        });
    });

    describe('getActivities', () => {
        beforeEach(async () => {
            // Add test activities directly
            activityLogModel.addActivity('notebook_visit', { notebookId: '1' }, 'user1');
            activityLogModel.addActivity('search_performed', { query: 'test' }, 'user1');
            activityLogModel.addActivity('intent_selected', { intentText: 'create' }, 'user2');
        });

        it('should retrieve activities with filtering options', async () => {
            // Test basic retrieval
            const allActivities = await activityLogService.getActivities('user1');
            expect(allActivities).toHaveLength(2);
            
            // Test filtering by activity type
            const filteredActivities = await activityLogService.getActivities('user1', {
                activityTypes: ['notebook_visit']
            });
            expect(filteredActivities).toHaveLength(1);
            expect(filteredActivities[0].activityType).toBe('notebook_visit');
            
            // Test limit parameter
            const limitedActivities = await activityLogService.getActivities('user1', {
                limit: 1
            });
            expect(limitedActivities).toHaveLength(1);
        });

        it('should flush pending activities before returning results', async () => {
            // Add an activity through the service (will be queued)
            await activityLogService.logActivity({
                userId: 'user1',
                activityType: 'browser_navigation',
                details: { url: 'https://example.com' }
            });

            // Get activities - should include the queued activity
            const activities = await activityLogService.getActivities('user1');
            expect(activities).toHaveLength(3); // 2 existing + 1 flushed
            expect(activities.some(a => a.activityType === 'browser_navigation')).toBe(true);
        });
    });

    describe('getRecentActivities', () => {
        it('should filter activities by time window', async () => {
            // Add an old activity
            const stmt = db.prepare(`
                INSERT INTO user_activities (id, timestamp, activity_type, details_json, user_id)
                VALUES ($id, $timestamp, $activityType, $detailsJson, $userId)
            `);
            stmt.run({
                id: 'old-activity',
                timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
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
    });

    describe('getActivityStats', () => {
        it('should calculate activity statistics correctly', async () => {
            // Add various activities
            activityLogModel.addActivity('notebook_visit', { id: '1' });
            activityLogModel.addActivity('notebook_visit', { id: '2' });
            activityLogModel.addActivity('search_performed', { query: 'test' });
            activityLogModel.addActivity('intent_selected', { intent: 'create' });
            activityLogModel.addActivity('intent_selected', { intent: 'delete' });
            activityLogModel.addActivity('intent_selected', { intent: 'update' });

            const stats = await activityLogService.getActivityStats();
            
            expect(stats.totalCount).toBe(6);
            expect(stats.countByType['notebook_visit']).toBe(2);
            expect(stats.countByType['search_performed']).toBe(1);
            expect(stats.countByType['intent_selected']).toBe(3);
            expect(stats.mostFrequentType).toBe('intent_selected');
        });
    });

    describe('helper methods', () => {
        it('should provide convenient methods for common activity types', async () => {
            // Test various helper methods
            await activityLogService.logNotebookVisit('notebook-123', 'My Notebook');
            await activityLogService.logIntentSelected('create notebook Test', 'chat', 'notebook-123');
            await activityLogService.logChatSessionStarted('session-123', 'notebook-123');
            await activityLogService.logSearchPerformed('TypeScript tutorial', 10, 'notebook-123');
            await activityLogService.logBrowserNavigation('https://example.com', 'Example Site', 'notebook-123');
            await activityLogService.logInfoSliceSelected(123, 'object-456', 'notebook-789');
            
            // Flush and verify
            await activityLogService.cleanup();
            
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(6);
            
            // Verify activity types
            const activityTypes = activities.map(a => a.activityType);
            expect(activityTypes).toContain('notebook_visit');
            expect(activityTypes).toContain('intent_selected');
            expect(activityTypes).toContain('chat_session_started');
            expect(activityTypes).toContain('search_performed');
            expect(activityTypes).toContain('browser_navigation');
            expect(activityTypes).toContain('info_slice_selected');
        });

        it('should log goal-related activities', async () => {
            await activityLogService.logStatedGoalAdded('goal-1', 'Learn TypeScript', 1);
            await activityLogService.logStatedGoalUpdated('goal-1', 'Learn TypeScript', 'in_progress');
            await activityLogService.logStatedGoalCompleted('goal-1', 'Learn TypeScript');
            
            await activityLogService.cleanup();
            
            const activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(3);
            expect(activities[0].activityType).toBe('stated_goal_added');
            expect(activities[1].activityType).toBe('stated_goal_updated');
            expect(activities[2].activityType).toBe('stated_goal_completed');
        });
    });

    describe('cleanupOldActivities', () => {
        it('should delete activities older than specified days', async () => {
            // Add old and recent activities
            const stmt = db.prepare(`
                INSERT INTO user_activities (id, timestamp, activity_type, details_json, user_id)
                VALUES ($id, $timestamp, $activityType, $detailsJson, $userId)
            `);
            
            const now = Date.now();
            const oldTimestamp = new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString(); // 100 days ago
            
            stmt.run({
                id: 'old-1',
                timestamp: oldTimestamp,
                activityType: 'notebook_visit',
                detailsJson: JSON.stringify({ id: 'old' }),
                userId: 'test_user',
            });
            
            activityLogModel.addActivity('notebook_visit', { id: 'recent' }, 'test_user');
            
            const deletedCount = await activityLogService.cleanupOldActivities('test_user', 90);
            
            expect(deletedCount).toBe(1);
            
            const remainingActivities = activityLogModel.getActivities('test_user');
            expect(remainingActivities).toHaveLength(1);
            expect(JSON.parse(remainingActivities[0].detailsJson).id).toBe('recent');
        });
    });

    describe('lifecycle management', () => {
        it('should properly handle cleanup with pending activities', async () => {
            // Add activities to queue
            await activityLogService.logActivity({
                activityType: 'notebook_visit',
                details: { id: '1' }
            });
            await activityLogService.logActivity({
                activityType: 'search_performed',
                details: { query: 'test' }
            });
            
            // Activities should be queued, not yet persisted
            let activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(0);
            
            // Cleanup should flush all pending activities
            await activityLogService.cleanup();
            
            activities = activityLogModel.getActivities();
            expect(activities).toHaveLength(2);
            expect(logger.info).toHaveBeenCalledWith('[ActivityLogService] Cleanup complete.');
        });

        it('should handle errors during flush operations', async () => {
            // Add an activity to queue
            await activityLogService.logActivity({
                activityType: 'notebook_visit',
                details: { id: '1' }
            });
            
            // Mock addActivity to throw error
            vi.spyOn(activityLogModel, 'addActivity').mockImplementation(() => {
                throw new Error('Database error');
            });
            
            // Cleanup should handle the error gracefully (not propagate)
            await activityLogService.cleanup();
            
            expect(logger.error).toHaveBeenCalledWith(
                '[ActivityLogService] Error during cleanup:',
                expect.any(Error)
            );
        });
    });
});