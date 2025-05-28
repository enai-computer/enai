import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initDb, closeDb } from '../../models/db';
import { ProfileAgent } from './ProfileAgent';
import { ProfileService } from '../ProfileService';
import { ActivityLogService } from '../ActivityLogService';
import { ToDoService } from '../ToDoService';
import { UserProfileModel } from '../../models/UserProfileModel';
import { ActivityLogModel } from '../../models/ActivityLogModel';
import { ToDoModel } from '../../models/ToDoModel';
import { ObjectModel } from '../../models/ObjectModel';
import { ChunkSqlModel } from '../../models/ChunkModel';
import runMigrations from '../../models/runMigrations';
import { ActivityType, ObjectStatus } from '../../shared/types';

// Mock LangChain ChatOpenAI
vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn().mockResolvedValue({
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
    })
  }))
}));

describe('ProfileAgent', () => {
  let db: Database.Database;
  let profileAgent: ProfileAgent;
  let profileService: ProfileService;
  let activityLogService: ActivityLogService;
  let todoService: ToDoService;
  let objectModel: ObjectModel;
  let chunkModel: ChunkSqlModel;

  beforeEach(async () => {
    // Use an in-memory database and set it as the global instance
    vi.stubEnv('JEFFERS_DB_PATH', ':memory:');
    db = initDb();
    runMigrations(db);
    
    // Ensure default user profile exists for foreign key constraints
    const stmt = db.prepare(`
      INSERT INTO user_profiles (user_id, updated_at) 
      VALUES ('test_user', ?)
      ON CONFLICT(user_id) DO NOTHING
    `);
    stmt.run(Date.now());

    // Initialize models with the in-memory DB
    const userProfileModel = new UserProfileModel(db);
    const activityLogModel = new ActivityLogModel(db);
    const todoModel = new ToDoModel(db);
    objectModel = new ObjectModel(db);
    chunkModel = new ChunkSqlModel(db);
    
    // Initialize services with injected models
    profileService = new ProfileService(userProfileModel);
    activityLogService = new ActivityLogService(activityLogModel);
    todoService = new ToDoService(todoModel);

    // Initialize ProfileAgent with explicit dependencies
    profileAgent = new ProfileAgent(
      db,
      activityLogService,
      todoService,
      profileService,
      objectModel,
      chunkModel
    );
  });

  afterEach(() => {
    closeDb();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('synthesizeProfileFromActivitiesAndTasks', () => {
    it('should skip synthesis when no recent activities or todos', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      
      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');
      
      // Verify no synthesis was performed - check that profile has no inferred data
      const profile = await profileService.getProfile('test_user');
      expect(profile?.inferredUserGoals).toBeNull();
      expect(profile?.synthesizedInterests).toBeNull();
    });

    it('should perform synthesis with activities and todos', async () => {
      // Add test activities (need at least 5 to trigger synthesis)
      for (let i = 0; i < 5; i++) {
        await activityLogService.logActivity({
          activityType: 'intent_selected' as ActivityType,
          details: { intentText: `Activity ${i}` }
        }, 'test_user');
      }

      // Add test todos
      await todoService.createToDo('test_user', {
        title: 'Implement data extraction',
        description: 'Extract data from web pages',
        priority: 1
      });

      // Run synthesis
      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');

      // Check profile was updated
      const profile = await profileService.getProfile('test_user');
      expect(profile?.inferredUserGoals).toBeTruthy();
      expect(profile?.synthesizedInterests).toBeTruthy();

      // Verify content
      expect(profile?.inferredUserGoals).toHaveLength(1);
      expect(profile?.inferredUserGoals?.[0].goal).toBe("Build a web scraper");
    });

    it('should handle JSON parsing errors gracefully', async () => {
      // Mock OpenAI to return invalid JSON
      // Mock the LLM to return invalid JSON
      const mockInvoke = vi.fn().mockResolvedValueOnce({
        content: 'Invalid JSON response'
      });

      // Add activity to trigger synthesis
      await activityLogService.logActivity({
        activityType: 'intent_selected' as ActivityType,
        details: { intentText: 'Test' }
      }, 'test_user');

      // ProfileAgent logs parse errors as warnings, not errors
      const consoleSpy = vi.spyOn(console, 'warn');
      
      // Temporarily replace the LLM's invoke method
      const originalInvoke = profileAgent['llm'].invoke;
      profileAgent['llm'].invoke = mockInvoke;
      
      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');
      
      // Restore original method
      profileAgent['llm'].invoke = originalInvoke;
      
      // Verify parse error was logged as warning
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ProfileAgent]'),
        expect.stringContaining('Could not parse synthesis response')
      );
    });
  });

  describe('synthesizeProfileFromContent', () => {
    it('should skip synthesis when no parsed objects', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      
      await profileAgent.synthesizeProfileFromContent('test_user');
      
      // Verify no synthesis was performed - check that profile has no content-based data
      const profile = await profileService.getProfile('test_user');
      expect(profile?.inferredExpertiseAreas).toBeNull();
      expect(profile?.preferredSourceTypes).toBeNull();
    });

    it('should perform content synthesis', async () => {
      // Create test object and chunks
      const createdObject = await objectModel.create({
        objectType: 'bookmark',
        sourceUri: 'https://example.com',
        title: 'Example Site',
        status: 'new' as ObjectStatus,
        rawContentRef: null,
        parsedContentJson: null,
        errorInfo: null,
        parsedAt: null
      });
      await objectModel.updateStatus(createdObject.id, 'parsed' as ObjectStatus);
      
      await chunkModel.addChunk({
        objectId: createdObject.id,
        chunkIdx: 0,
        content: 'JavaScript tutorial on async/await patterns',
        metadata: {}
      });

      // Run synthesis
      await profileAgent.synthesizeProfileFromContent('test_user');

      // Check profile was updated
      const profile = await profileService.getProfile('test_user');
      expect(profile?.inferredExpertiseAreas).toBeTruthy();
      expect(profile?.preferredSourceTypes).toBeTruthy();

      // Verify content
      expect(profile?.inferredExpertiseAreas).toHaveLength(1);
      expect(profile?.inferredExpertiseAreas?.[0].area).toBe("JavaScript");
    });

    it('should handle multiple parsed objects efficiently', async () => {
      // Create multiple test objects
      for (let i = 0; i < 5; i++) {
        const createdObject = await objectModel.create({
          objectType: 'bookmark',
          sourceUri: `https://example.com/${i}`,
          title: `Example ${i}`,
          status: 'new' as ObjectStatus,
          rawContentRef: null,
          parsedContentJson: null,
          errorInfo: null,
          parsedAt: null
        });
        await objectModel.updateStatus(createdObject.id, 'parsed' as ObjectStatus);
        
        await chunkModel.addChunk({
          objectId: createdObject.id,
          chunkIdx: 0,
          content: `Content about topic ${i}`,
          metadata: {}
        });
      }

      const openAiSpy = vi.spyOn(profileAgent['llm'], 'invoke');

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
      // Add multiple activities (need at least 5 to trigger synthesis)
      for (let i = 0; i < 5; i++) {
        await activityLogService.logActivity({
          activityType: i % 2 === 0 ? 'chat_session_started' : 'object_ingested' as ActivityType,
          details: { info: `Activity ${i}` }
        }, 'test_user');
      }

      const openAiSpy = vi.spyOn(profileAgent['llm'], 'invoke');

      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');

      // Check that the LLM was called
      expect(openAiSpy).toHaveBeenCalled();
      
      // Get the prompt that was passed to the LLM
      const prompt = openAiSpy.mock.calls[0][0] as string;
      
      expect(prompt).toContain('[A1]');
      expect(prompt).toContain('[A2]');
      expect(prompt).toContain('chat_session_started');
      expect(prompt).toContain('object_ingested');
    });

    it('should format todos with reference labels', async () => {
      // Add multiple todos
      await todoService.createToDo('test_user', {
        title: 'Learn TensorFlow',
        description: 'Study TensorFlow basics',
        priority: 1
      });
      await todoService.createToDo('test_user', {
        title: 'Build ML model',
        description: 'Create initial ML model',
        priority: 3
      });

      const openAiSpy = vi.spyOn(profileAgent['llm'], 'invoke');

      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');

      // Check that the LLM was called
      expect(openAiSpy).toHaveBeenCalled();
      
      // Get the prompt that was passed to the LLM
      const prompt = openAiSpy.mock.calls[0][0] as string;
      
      expect(prompt).toContain('[T1]');
      expect(prompt).toContain('[T2]');
      expect(prompt).toContain('Learn TensorFlow');
      expect(prompt).toContain('Build ML model');
    });
  });
});