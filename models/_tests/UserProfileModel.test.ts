import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { UserProfileModel } from '../UserProfileModel';
import { setupTestDb, cleanTestDb } from './testUtils';

describe('UserProfileModel', () => {
  let db: Database.Database;
  let model: UserProfileModel;

  beforeAll(() => {
    db = setupTestDb();
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    cleanTestDb(db);
    model = new UserProfileModel(db);
  });

  describe('getProfile', () => {
    it('should return null for non-existent profile', () => {
      const profile = model.getProfile('non-existent-user');
      expect(profile).toBeNull();
    });

    it('should return default profile after migration', () => {
      const profile = model.getProfile('default_user');
      expect(profile).toBeDefined();
      expect(profile?.userId).toBe('default_user');
      expect(profile?.name).toBe('Default User');
      expect(profile?.aboutMe).toBeNull();
      expect(profile?.customInstructions).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('should update explicit fields', () => {
      const updates = {
        name: 'John Doe',
        aboutMe: 'Software engineer interested in AI',
        customInstructions: 'Be concise and technical',
      };

      const updated = model.updateProfile('default_user', updates);

      expect(updated.name).toBe(updates.name);
      expect(updated.aboutMe).toBe(updates.aboutMe);
      expect(updated.customInstructions).toBe(updates.customInstructions);
    });

    it('should update goal and synthesized fields', () => {
      const statedGoals = [
        { id: '1', text: 'Learn about ML', createdAt: Date.now(), status: 'active' as const },
        { id: '2', text: 'Build AI apps', createdAt: Date.now(), status: 'active' as const },
      ];
      
      const inferredGoals = [
        { id: '3', text: 'Master TypeScript', probability: 0.85, lastInferredAt: Date.now() },
        { id: '4', text: 'Contribute to open source', probability: 0.72, lastInferredAt: Date.now() },
      ];

      const updates = {
        statedUserGoals: statedGoals,
        inferredUserGoals: inferredGoals,
        synthesizedInterests: ['Machine Learning', 'TypeScript'],
        synthesizedPreferredSources: ['arxiv.org', 'github.com'],
        synthesizedRecentIntents: ['understand transformers', 'implement RAG'],
      };

      const updated = model.updateProfile('default_user', updates);

      expect(updated.statedUserGoals).toEqual(statedGoals);
      expect(updated.inferredUserGoals).toEqual(inferredGoals);
      expect(updated.synthesizedInterests).toEqual(updates.synthesizedInterests);
      expect(updated.synthesizedPreferredSources).toEqual(updates.synthesizedPreferredSources);
      expect(updated.synthesizedRecentIntents).toEqual(updates.synthesizedRecentIntents);
    });

    it('should handle partial updates', () => {
      // First update
      const goal = { id: '1', text: 'Goal 1', createdAt: Date.now(), status: 'active' as const };
      model.updateProfile('default_user', {
        name: 'John Doe',
        statedUserGoals: [goal],
      });

      // Second update - should preserve previous values
      const updated = model.updateProfile('default_user', {
        aboutMe: 'New about me',
        synthesizedInterests: ['Interest 1'],
      });

      expect(updated.name).toBe('John Doe');
      expect(updated.aboutMe).toBe('New about me');
      expect(updated.statedUserGoals).toEqual([goal]);
      expect(updated.synthesizedInterests).toEqual(['Interest 1']);
    });

    it('should clear fields when set to null', () => {
      // First set some values
      const goal = { id: '1', text: 'Goal 1', createdAt: Date.now(), status: 'active' as const };
      model.updateProfile('default_user', {
        name: 'John Doe',
        statedUserGoals: [goal],
      });

      // Then clear them
      const updated = model.updateProfile('default_user', {
        name: null,
        statedUserGoals: null,
      });

      expect(updated.name).toBeNull();
      expect(updated.statedUserGoals).toBeNull();
    });

    it('should create profile if it does not exist', () => {
      const newUserId = 'new_user';
      
      // Verify profile doesn't exist
      expect(model.getProfile(newUserId)).toBeNull();

      // Update should create it
      const created = model.updateProfile(newUserId, {
        name: 'New User',
      });

      expect(created.userId).toBe(newUserId);
      expect(created.name).toBe('New User');
    });

    it('should update timestamp on every change', async () => {
      const profile1 = model.getProfile('default_user');
      const timestamp1 = profile1?.updatedAt.getTime() || 0;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const profile2 = model.updateProfile('default_user', { name: 'Updated' });
      const timestamp2 = profile2.updatedAt.getTime();

      expect(timestamp2).toBeGreaterThan(timestamp1);
    });
  });

  describe('deleteProfile', () => {
    it('should delete existing profile', () => {
      // Ensure profile exists
      model.updateProfile('default_user', { name: 'To Delete' });
      expect(model.getProfile('default_user')).toBeDefined();

      // Delete it
      const deleted = model.deleteProfile('default_user');
      expect(deleted).toBe(true);

      // Verify it's gone
      expect(model.getProfile('default_user')).toBeNull();
    });

    it('should return false when deleting non-existent profile', () => {
      const deleted = model.deleteProfile('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty arrays in synthesized fields', () => {
      const updated = model.updateProfile('default_user', {
        statedUserGoals: [],
        inferredUserGoals: [],
        synthesizedInterests: [],
      });

      expect(updated.statedUserGoals).toEqual([]);
      expect(updated.inferredUserGoals).toEqual([]);
      expect(updated.synthesizedInterests).toEqual([]);
    });

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(1000);
      const updated = model.updateProfile('default_user', {
        aboutMe: longString,
        customInstructions: longString,
      });

      expect(updated.aboutMe).toBe(longString);
      expect(updated.customInstructions).toBe(longString);
    });

    it('should handle special characters in text fields', () => {
      const specialText = `Special chars: "quotes", 'apostrophes', \n newlines, \t tabs`;
      const updated = model.updateProfile('default_user', {
        aboutMe: specialText,
      });

      expect(updated.aboutMe).toBe(specialText);
    });
  });
});