import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ProfileAgent } from './ProfileAgent';
import { ProfileService } from '../ProfileService';
import { getActivityLogService } from '../ActivityLogService';
import { getToDoService } from '../ToDoService';
import { ObjectModel } from '../../models/ObjectModel';
import { ChunkSqlModel } from '../../models/ChunkModel';
import runMigrations from '../../models/runMigrations';
import { ActivityType, ObjectStatus } from '../../shared/types';

// Mock OpenAI
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{
            message: {
              content: JSON.stringify({
                inferredGoals: [
                  { goal: "Build a web scraper", confidence: 0.8, evidenceIds: ["A1", "T1"] }
                ],
                inferredInterests: [
                  { interest: "Web development", confidence: 0.9, evidenceIds: ["A2", "A3"] }
                ],
                keyInsights: [
                  "User is focusing on automation tasks"
                ],
                inferredExpertiseAreas: [
                  { area: "JavaScript", level: "intermediate", evidenceIds: ["C1", "C2"] }
                ],
                preferredSourceTypes: ["documentation", "tutorials"]
              })
            }
          }]
        })
      }
    }
  }))
}));

describe('ProfileAgent', () => {
  let db: Database.Database;
  let profileAgent: ProfileAgent;
  let profileService: ProfileService;
  let activityLogService: ReturnType<typeof getActivityLogService>;
  let todoService: ReturnType<typeof getToDoService>;
  let objectModel: ObjectModel;
  let chunkModel: ChunkSqlModel;

  beforeEach(async () => {
    // Initialize in-memory database
    db = new Database(':memory:');
    await runMigrations(db);

    // Initialize services
    profileService = new ProfileService(db);
    activityLogService = getActivityLogService();
    todoService = getToDoService();
    objectModel = new ObjectModel(db);
    chunkModel = new ChunkSqlModel(db);

    // Initialize ProfileAgent
    profileAgent = new ProfileAgent();
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe('synthesizeProfileFromActivitiesAndTasks', () => {
    it('should skip synthesis when no recent activities or todos', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      
      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No recent activities or todos to synthesize')
      );
    });

    it('should perform synthesis with activities and todos', async () => {
      // Add test activities
      await activityLogService.logActivity({
        activityType: 'intent_selected' as ActivityType,
        details: { intentText: 'Build a web scraper' }
      }, 'test_user');

      await activityLogService.logActivity({
        activityType: 'notebook_opened' as ActivityType,
        details: { notebookId: 'nb1', title: 'Web Development Notes' }
      }, 'test_user');

      // Add test todos
      await todoService.addToDo('test_user', 'Implement data extraction', 'pending', 'high');

      // Run synthesis
      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');

      // Check profile was updated
      const profile = await profileService.getProfile('test_user');
      expect(profile?.inferredGoalsJson).toBeTruthy();
      expect(profile?.inferredInterestsJson).toBeTruthy();
      expect(profile?.lastActivitySynthesis).toBeTruthy();

      // Parse and verify content
      const goals = JSON.parse(profile!.inferredGoalsJson!);
      expect(goals).toHaveLength(1);
      expect(goals[0].goal).toBe("Build a web scraper");
    });

    it('should handle JSON parsing errors gracefully', async () => {
      // Mock OpenAI to return invalid JSON
      vi.mocked(profileAgent['openai'].chat.completions.create).mockResolvedValueOnce({
        choices: [{
          message: { content: 'Invalid JSON response' }
        }]
      } as any);

      // Add activity to trigger synthesis
      await activityLogService.logActivity({
        activityType: 'intent_selected' as ActivityType,
        details: { intentText: 'Test' }
      }, 'test_user');

      const consoleSpy = vi.spyOn(console, 'error');
      
      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse synthesis result')
      );
    });
  });

  describe('synthesizeProfileFromContent', () => {
    it('should skip synthesis when no parsed objects', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      
      await profileAgent.synthesizeProfileFromContent('test_user');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No parsed objects to synthesize')
      );
    });

    it('should perform content synthesis', async () => {
      // Create test object and chunks
      const objectId = await objectModel.create('https://example.com', 'Example Site');
      await objectModel.updateStatus(objectId, 'parsed' as ObjectStatus);
      
      await chunkModel.createChunk({
        objectId,
        chunkIndex: 0,
        content: 'JavaScript tutorial on async/await patterns',
        metadata: {}
      });

      // Run synthesis
      await profileAgent.synthesizeProfileFromContent('test_user');

      // Check profile was updated
      const profile = await profileService.getProfile('test_user');
      expect(profile?.inferredExpertiseAreasJson).toBeTruthy();
      expect(profile?.preferredSourceTypesJson).toBeTruthy();
      expect(profile?.lastContentSynthesis).toBeTruthy();

      // Parse and verify content
      const expertise = JSON.parse(profile!.inferredExpertiseAreasJson!);
      expect(expertise).toHaveLength(1);
      expect(expertise[0].area).toBe("JavaScript");
    });

    it('should handle multiple parsed objects efficiently', async () => {
      // Create multiple test objects
      for (let i = 0; i < 5; i++) {
        const objectId = await objectModel.create(`https://example.com/${i}`, `Example ${i}`);
        await objectModel.updateStatus(objectId, 'parsed' as ObjectStatus);
        
        await chunkModel.createChunk({
          objectId,
          chunkIndex: 0,
          content: `Content about topic ${i}`,
          metadata: {}
        });
      }

      const openAiSpy = vi.spyOn(profileAgent['openai'].chat.completions, 'create');

      await profileAgent.synthesizeProfileFromContent('test_user');

      // Should have made exactly one API call
      expect(openAiSpy).toHaveBeenCalledTimes(1);
      
      // Check that all objects were marked as synthesized
      const parsedObjects = await objectModel.findByStatus(['parsed']);
      expect(parsedObjects).toHaveLength(0); // All should be synthesized now
    });
  });

  describe('evidence tracking', () => {
    it('should format activities with reference labels', async () => {
      // Add multiple activities
      await activityLogService.logActivity({
        activityType: 'chat_topic_discussed' as ActivityType,
        details: { topic: 'Machine Learning basics' }
      }, 'test_user');

      await activityLogService.logActivity({
        activityType: 'content_saved' as ActivityType,
        details: { url: 'https://ml-tutorial.com' }
      }, 'test_user');

      const openAiSpy = vi.spyOn(profileAgent['openai'].chat.completions, 'create');

      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');

      // Check that activities were formatted with labels
      const call = openAiSpy.mock.calls[0];
      const systemPrompt = call[0].messages[0].content as string;
      
      expect(systemPrompt).toContain('[A1]');
      expect(systemPrompt).toContain('[A2]');
      expect(systemPrompt).toContain('chat_topic_discussed');
      expect(systemPrompt).toContain('content_saved');
    });

    it('should format todos with reference labels', async () => {
      // Add multiple todos
      await todoService.addToDo('test_user', 'Learn TensorFlow', 'pending', 'high');
      await todoService.addToDo('test_user', 'Build ML model', 'in_progress', 'medium');

      const openAiSpy = vi.spyOn(profileAgent['openai'].chat.completions, 'create');

      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');

      // Check that todos were formatted with labels
      const call = openAiSpy.mock.calls[0];
      const systemPrompt = call[0].messages[0].content as string;
      
      expect(systemPrompt).toContain('[T1]');
      expect(systemPrompt).toContain('[T2]');
      expect(systemPrompt).toContain('Learn TensorFlow');
      expect(systemPrompt).toContain('Build ML model');
    });
  });
});