import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initDb, closeDb } from '../../../models/db';
import { ProfileAgent } from '../ProfileAgent';
import { ProfileService } from '../../ProfileService';
import { ActivityLogService } from '../../ActivityLogService';
import { ToDoService } from '../../ToDoService';
import { UserProfileModel } from '../../../models/UserProfileModel';
import { ActivityLogModel } from '../../../models/ActivityLogModel';
import { ToDoModel } from '../../../models/ToDoModel';
import { ObjectModelCore } from '../../../models/ObjectModelCore';
import { ChunkModel } from '../../../models/ChunkModel';
import runMigrations from '../../../models/runMigrations';
import { ActivityType, ObjectStatus } from '../../../shared/types';
import { BaseMessage } from '@langchain/core/messages';

// Mock createChatModel
vi.mock('../../../utils/llm', () => ({
  createChatModel: vi.fn(() => ({
    invoke: vi.fn().mockImplementation(async () => ({
      content: JSON.stringify({
        inferredUserGoals: [
          { text: "Build a web scraper", confidence: 0.8, evidence: ["A1", "T1"] }
        ],
        synthesizedInterests: ["Web development", "Automation"],
        synthesizedRecentIntents: ["Implementing data extraction features"]
      })
    }))
  }))
}));

describe('ProfileAgent', () => {
  let db: Database.Database;
  let profileAgent: ProfileAgent;
  let profileService: ProfileService;
  let activityLogService: ActivityLogService;
  let todoService: ToDoService;
  let objectModelCore: ObjectModelCore;
  let chunkModel: ChunkModel;

  beforeEach(async () => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    
    // Use an in-memory database
    vi.stubEnv('JEFFERS_DB_PATH', ':memory:');
    db = initDb();
    runMigrations(db);
    
    // Ensure default user profile exists
    db.prepare(`
      INSERT INTO user_profiles (user_id, updated_at) 
      VALUES ('test_user', ?)
      ON CONFLICT(user_id) DO NOTHING
    `).run(new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z'));

    // Initialize models
    const userProfileModel = new UserProfileModel(db);
    const activityLogModel = new ActivityLogModel(db);
    const todoModel = new ToDoModel(db);
    objectModelCore = new ObjectModelCore(db);
    chunkModel = new ChunkModel(db);
    
    // Initialize services
    profileService = new ProfileService({ db, userProfileModel });
    
    const mockLanceVectorModel = {
      initialize: vi.fn(),
      deleteByObjectId: vi.fn(),
      cleanup: vi.fn()
    };
    
    activityLogService = new ActivityLogService({
      db,
      activityLogModel,
      objectModel: objectModelCore,
      lanceVectorModel: mockLanceVectorModel as any
    });
    
    todoService = new ToDoService({
      db,
      toDoModel: todoModel,
      activityLogService
    });

    profileAgent = new ProfileAgent({
      db,
      activityLogService,
      toDoService: todoService,
      profileService,
      objectModelCore,
      chunkModel: chunkModel
    });
  });

  afterEach(() => {
    closeDb();
    vi.unstubAllEnvs();
  });

  describe('synthesizeProfileFromActivitiesAndTasks', () => {
    it('should skip synthesis when no recent activities or todos', async () => {
      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');
      
      const profile = await profileService.getProfile('test_user');
      expect(profile?.inferredUserGoals).toBeNull();
      expect(profile?.synthesizedInterests).toBeNull();
    });

    it('should perform synthesis with sufficient activities', async () => {
      // Add minimum activities to trigger synthesis (5)
      for (let i = 0; i < 5; i++) {
        await activityLogService.logActivity({
          activityType: 'intent_selected' as ActivityType,
          details: { intentText: `Activity ${i}` },
          userId: 'test_user'
        });
      }

      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');

      const profile = await profileService.getProfile('test_user');
      expect(profile?.inferredUserGoals).toHaveLength(1);
      expect(profile?.inferredUserGoals?.[0].text).toBe("Build a web scraper");
      expect(profile?.synthesizedInterests).toContain("Web development");
    });

    it('should perform synthesis with sufficient todos', async () => {
      // Add minimum todos to trigger synthesis (3)
      const todos = [
        { title: 'Learn TensorFlow', description: 'Study TensorFlow basics', priority: 1 },
        { title: 'Build ML model', description: 'Create initial ML model', priority: 3 },
        { title: 'Deploy model', description: 'Deploy to production', priority: 2 }
      ];

      for (const todo of todos) {
        await todoService.createToDo('test_user', todo);
      }

      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');

      const profile = await profileService.getProfile('test_user');
      expect(profile?.inferredUserGoals).toBeTruthy();
      expect(profile?.synthesizedInterests).toBeTruthy();
    });

    it('should handle JSON parsing errors gracefully', async () => {
      // Mock invalid JSON response
      const { createChatModel } = await import('../../../utils/llm');
      (createChatModel as any).mockReturnValue({
        invoke: vi.fn().mockResolvedValue({ content: 'Invalid JSON response' })
      });

      // Add activities to trigger synthesis
      for (let i = 0; i < 5; i++) {
        await activityLogService.logActivity({
          activityType: 'intent_selected' as ActivityType,
          details: { intentText: `Test ${i}` },
          userId: 'test_user'
        });
      }

      const logWarnSpy = vi.spyOn(profileAgent as any, 'logWarn');
      
      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');
      
      expect(logWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not parse synthesis response')
      );
      
      const profile = await profileService.getProfile('test_user');
      expect(profile?.inferredUserGoals).toBeNull();
    });
  });

  describe('synthesizeProfileFromContent', () => {
    it('should skip synthesis when no parsed objects', async () => {
      await profileAgent.synthesizeProfileFromContent('test_user');
      
      const profile = await profileService.getProfile('test_user');
      expect(profile?.inferredExpertiseAreas).toBeNull();
      expect(profile?.preferredSourceTypes).toBeNull();
    });

    it('should perform content synthesis with embedded objects', async () => {
      // Mock content synthesis response
      const { createChatModel } = await import('../../../utils/llm');
      (createChatModel as any).mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            synthesizedInterests: ["JavaScript", "Web Development"],
            inferredExpertiseAreas: ["JavaScript", "TypeScript"],
            preferredSourceTypes: ["documentation", "tutorials"]
          })
        })
      });

      // Create minimum embedded objects to trigger synthesis (3)
      for (let i = 0; i < 3; i++) {
        const createdObject = await objectModelCore.create({
          objectType: 'webpage',
          sourceUri: `https://example.com/${i}`,
          title: `Example Site ${i}`,
          status: 'new' as ObjectStatus,
          rawContentRef: null,
          parsedContentJson: null,
          errorInfo: null,
          parsedAt: undefined
        });
        
        await objectModelCore.updateStatus(createdObject.id, 'embedded' as ObjectStatus);
        
        await chunkModel.addChunk({
          objectId: createdObject.id,
          chunkIdx: 0,
          content: `JavaScript tutorial part ${i}`,
          tokenCount: null
        });
      }

      await profileAgent.synthesizeProfileFromContent('test_user');

      const profile = await profileService.getProfile('test_user');
      expect(profile?.inferredExpertiseAreas).toContain("JavaScript");
      expect(profile?.preferredSourceTypes).toContain("documentation");
    });
  });

  describe('evidence tracking', () => {
    it('should format activities and todos with reference labels', async () => {
      // Add activities and todos
      for (let i = 0; i < 5; i++) {
        await activityLogService.logActivity({
          activityType: i % 2 === 0 ? 'chat_session_started' : 'object_ingested' as ActivityType,
          details: { info: `Activity ${i}` },
          userId: 'test_user'
        });
      }

      await todoService.createToDo('test_user', {
        title: 'Learn TensorFlow',
        description: 'Study TensorFlow basics',
        priority: 1
      });

      const { createChatModel } = await import('../../../utils/llm');
      const mockInvoke = vi.fn().mockResolvedValue({
        content: JSON.stringify({
          inferredUserGoals: [
            { text: "Learn about activities", confidence: 0.7, evidence: ["A1", "A2", "T1"] }
          ],
          synthesizedInterests: ["Activity tracking"],
          synthesizedRecentIntents: ["Monitoring system activities"]
        })
      });
      (createChatModel as any).mockReturnValue({ invoke: mockInvoke });

      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');

      const messages = mockInvoke.mock.calls[0][0] as BaseMessage[];
      const systemMessage = messages.find(m => m._getType() === 'system');
      const prompt = systemMessage?.content as string;
      
      expect(prompt).toContain('[A1]');
      expect(prompt).toContain('[T1]');
      expect(prompt).toContain('chat_session_started');
      expect(prompt).toContain('Learn TensorFlow');
    });
  });
});