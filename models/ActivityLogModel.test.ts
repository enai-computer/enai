import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ActivityLogModel } from './ActivityLogModel';
import runMigrations from './runMigrations';
import { ActivityType } from '../shared/types';

describe('ActivityLogModel', () => {
  let db: Database.Database;
  let model: ActivityLogModel;

  beforeEach(async () => {
    // Create in-memory database
    db = new Database(':memory:');
    await runMigrations(db);
    model = new ActivityLogModel(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('addActivity', () => {
    it('should add a new activity', () => {
      const activityType: ActivityType = 'notebook_visit';
      const details = { notebookId: 'test-notebook', title: 'Test Notebook' };

      model.addActivity(activityType, details);

      const activities = model.getActivities();
      expect(activities).toHaveLength(1);
      expect(activities[0].activityType).toBe(activityType);
      expect(JSON.parse(activities[0].detailsJson)).toEqual(details);
      expect(activities[0].userId).toBe('default_user');
    });

    it('should add activity with custom userId', () => {
      const activityType: ActivityType = 'intent_selected';
      const details = { intentText: 'test intent' };
      const userId = 'custom_user';

      model.addActivity(activityType, details, userId);

      const activities = model.getActivities(userId);
      expect(activities).toHaveLength(1);
      expect(activities[0].userId).toBe(userId);
    });
  });

  describe('getActivities', () => {
    it('should return activities filtered by time range', () => {
      const now = Date.now();
      const hourAgo = now - 60 * 60 * 1000;
      const twoHoursAgo = now - 2 * 60 * 60 * 1000;

      // Add activities at different times
      model.addActivity('notebook_visit', { id: '1' });
      
      // Manually insert an older activity
      const stmt = db.prepare(`
        INSERT INTO user_activities (id, timestamp, activity_type, details_json, user_id)
        VALUES ($id, $timestamp, $activityType, $detailsJson, $userId)
      `);
      stmt.run({
        id: 'old-activity',
        timestamp: twoHoursAgo,
        activityType: 'search_performed',
        detailsJson: JSON.stringify({ query: 'old search' }),
        userId: 'default_user',
      });

      const recentActivities = model.getActivities('default_user', hourAgo);
      expect(recentActivities).toHaveLength(1);
      expect(recentActivities[0].activityType).toBe('notebook_visit');
    });

    it('should filter by activity types', () => {
      model.addActivity('notebook_visit', { id: '1' });
      model.addActivity('intent_selected', { intent: 'test' });
      model.addActivity('browser_navigation', { url: 'https://example.com' });

      const filtered = model.getActivities(
        'default_user',
        undefined,
        undefined,
        ['notebook_visit', 'browser_navigation']
      );

      expect(filtered).toHaveLength(2);
      expect(filtered.every(a => 
        a.activityType === 'notebook_visit' || 
        a.activityType === 'browser_navigation'
      )).toBe(true);
    });

    it('should respect limit parameter', () => {
      // Add 5 activities
      for (let i = 0; i < 5; i++) {
        model.addActivity('notebook_visit', { id: `notebook-${i}` });
      }

      const limited = model.getActivities('default_user', undefined, undefined, undefined, 3);
      expect(limited).toHaveLength(3);
    });
  });

  describe('getRecentActivities', () => {
    it('should return activities from last N hours', () => {
      const now = Date.now();
      const threeHoursAgo = now - 3 * 60 * 60 * 1000;

      // Add recent activity
      model.addActivity('notebook_visit', { id: 'recent' });

      // Add old activity
      const stmt = db.prepare(`
        INSERT INTO user_activities (id, timestamp, activity_type, details_json, user_id)
        VALUES ($id, $timestamp, $activityType, $detailsJson, $userId)
      `);
      stmt.run({
        id: 'old-activity',
        timestamp: threeHoursAgo,
        activityType: 'search_performed',
        detailsJson: JSON.stringify({ query: 'old' }),
        userId: 'default_user',
      });

      const recent = model.getRecentActivities('default_user', 2);
      expect(recent).toHaveLength(1);
      expect(recent[0].activityType).toBe('notebook_visit');
    });
  });

  describe('getActivityCounts', () => {
    it('should return counts by activity type', () => {
      model.addActivity('notebook_visit', { id: '1' });
      model.addActivity('notebook_visit', { id: '2' });
      model.addActivity('intent_selected', { intent: 'test' });
      model.addActivity('browser_navigation', { url: 'test' });

      const counts = model.getActivityCounts();
      expect(counts['notebook_visit']).toBe(2);
      expect(counts['intent_selected']).toBe(1);
      expect(counts['browser_navigation']).toBe(1);
    });
  });

  describe('deleteOldActivities', () => {
    it('should delete activities older than specified days', () => {
      const now = Date.now();
      const oldTimestamp = now - 100 * 24 * 60 * 60 * 1000; // 100 days ago

      // Add recent activity
      model.addActivity('notebook_visit', { id: 'recent' });

      // Add old activity
      const stmt = db.prepare(`
        INSERT INTO user_activities (id, timestamp, activity_type, details_json, user_id)
        VALUES ($id, $timestamp, $activityType, $detailsJson, $userId)
      `);
      stmt.run({
        id: 'old-activity',
        timestamp: oldTimestamp,
        activityType: 'search_performed',
        detailsJson: JSON.stringify({ query: 'old' }),
        userId: 'default_user',
      });

      const deletedCount = model.deleteOldActivities('default_user', 90);
      expect(deletedCount).toBe(1);

      const remaining = model.getActivities();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].activityType).toBe('notebook_visit');
    });
  });
});