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
import { ObjectModel } from '../../../models/ObjectModel';
import { ChunkSqlModel } from '../../../models/ChunkModel';
import runMigrations from '../../../models/runMigrations';
import { ActivityType, ObjectStatus } from '../../../shared/types';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';

// Mock createChatModel
vi.mock('../../../utils/llm', () => ({
  createChatModel: vi.fn(() => ({
    invoke: vi.fn().mockImplementation(async (messages) => {
      return new HumanMessage(JSON.stringify({
        inferredUserGoals: [
          { text: "Build a web scraper", confidence: 0.8, evidence: ["A1", "T1"] }
        ],
        synthesizedInterests: ["Web development", "Automation"],
        synthesizedRecentIntents: ["Implementing data extraction features"]
      }));
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
    // Reset all mocks before each test
    vi.clearAllMocks();
    
    // Reset mock createChatModel
    const { createChatModel } = await import('../../../utils/llm');
    (createChatModel as any).mockReturnValue({
      invoke: vi.fn().mockImplementation(async (messages) => {
        return new HumanMessage(JSON.stringify({
          inferredUserGoals: [
            { text: "Build a web scraper", confidence: 0.8, evidence: ["A1", "T1"] }
          ],
          synthesizedInterests: ["Web development", "Automation"],
          synthesizedRecentIntents: ["Implementing data extraction features"]
        }));
      })
    });
    
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
          details: { intentText: `Activity ${i}` },
          userId: 'test_user'
        });
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
      expect(profile?.inferredUserGoals?.[0].text).toBe("Build a web scraper");
    });

    it('should handle JSON parsing errors gracefully', async () => {
      // Mock the LLM to return invalid JSON
      const mockInvoke = vi.fn().mockImplementation(async () => {
        return new HumanMessage('Invalid JSON response');
      });

      // Add activities to trigger synthesis (need at least 5)
      for (let i = 0; i < 5; i++) {
        await activityLogService.logActivity({
          activityType: 'intent_selected' as ActivityType,
          details: { intentText: `Test ${i}` },
          userId: 'test_user'
        });
      }

      // ProfileAgent logs parse errors as warnings, not errors
      const consoleSpy = vi.spyOn(console, 'warn');
      
      // Update the mock to simulate error
      const { createChatModel } = await import('../../../utils/llm');
      (createChatModel as any).mockReturnValue({
        invoke: mockInvoke
      });
      
      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');
      
      // Verify parse error was logged as warning
      // The logger adds timestamp and level prefix, so we check if any call contains our message
      const warnCalls = consoleSpy.mock.calls;
      const hasExpectedWarning = warnCalls.some(call => 
        call.some(arg => 
          typeof arg === 'string' && 
          arg.includes('[ProfileAgent]') && 
          arg.includes('Could not parse synthesis response')
        )
      );
      expect(hasExpectedWarning).toBe(true);
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
      // Mock should return content synthesis data
      const mockContentInvoke = vi.fn().mockResolvedValueOnce({
        content: JSON.stringify({
          synthesizedInterests: ["JavaScript", "Web Development"],
          inferredExpertiseAreas: ["JavaScript", "TypeScript"],
          preferredSourceTypes: ["documentation", "tutorials"]
        })
      });
      
      // Update the mock for content synthesis
      const { createChatModel } = await import('../../../utils/llm');
      (createChatModel as any).mockReturnValue({
        invoke: vi.fn().mockImplementation(async (messages) => {
          return new HumanMessage(JSON.stringify({
            synthesizedInterests: ["JavaScript", "Web Development"],
            inferredExpertiseAreas: ["JavaScript", "TypeScript"],
            preferredSourceTypes: ["documentation", "tutorials"]
          }));
        })
      });

      // Create multiple test objects with 'embedded' status (need at least 3 to trigger synthesis)
      for (let i = 0; i < 3; i++) {
        const createdObject = await objectModel.create({
          objectType: 'bookmark',
          sourceUri: `https://example.com/${i}`,
          title: `Example Site ${i}`,
          status: 'new' as ObjectStatus,
          rawContentRef: null,
          parsedContentJson: null,
          errorInfo: null,
          parsedAt: null
        });
        
        // Update to embedded status to trigger synthesis
        await objectModel.updateStatus(createdObject.id, 'embedded' as ObjectStatus);
        
        await chunkModel.addChunk({
          objectId: createdObject.id,
          chunkIdx: 0,
          content: `JavaScript tutorial part ${i}`,
          metadata: {}
        });
      }

      // Run synthesis
      await profileAgent.synthesizeProfileFromContent('test_user');

      // Check profile was updated
      const profile = await profileService.getProfile('test_user');
      expect(profile?.inferredExpertiseAreas).toBeTruthy();
      expect(profile?.preferredSourceTypes).toBeTruthy();

      // Verify content
      expect(profile?.inferredExpertiseAreas).toHaveLength(2);
      expect(profile?.inferredExpertiseAreas?.[0]).toBe("JavaScript");
    });

    it('should handle multiple parsed objects efficiently', async () => {
      // Create multiple test objects with 'embedded' status to trigger synthesis
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
        await objectModel.updateStatus(createdObject.id, 'embedded' as ObjectStatus);
        
        await chunkModel.addChunk({
          objectId: createdObject.id,
          chunkIdx: 0,
          content: `Content about topic ${i}`,
          metadata: {}
        });
      }

      const { createChatModel } = await import('../../../utils/llm');
      const mockInvoke = vi.fn();
      (createChatModel as any).mockReturnValue({
        invoke: mockInvoke
      });
      const llmSpy = mockInvoke;

      await profileAgent.synthesizeProfileFromContent('test_user');

      // Should have made exactly one API call
      expect(llmSpy).toHaveBeenCalledTimes(1);
      
      // Check that embedded objects remain embedded (they don't change status)
      const embeddedObjects = await objectModel.findByStatus(['embedded']);
      expect(embeddedObjects).toHaveLength(5);
    });
  });

  describe('evidence tracking', () => {
    it('should format activities with reference labels', async () => {
      // Add multiple activities (need at least 5 to trigger synthesis)
      for (let i = 0; i < 5; i++) {
        await activityLogService.logActivity({
          activityType: i % 2 === 0 ? 'chat_session_started' : 'object_ingested' as ActivityType,
          details: { info: `Activity ${i}` },
          userId: 'test_user'
        });
      }

      const { createChatModel } = await import('../../../utils/llm');
      const mockInvoke = vi.fn();
      (createChatModel as any).mockReturnValue({
        invoke: mockInvoke
      });
      const llmSpy = mockInvoke;

      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');

      // Check that the LLM was called
      expect(llmSpy).toHaveBeenCalled();
      
      // Get the messages that were passed to the LLM
      const messages = llmSpy.mock.calls[0][0] as BaseMessage[];
      // ProfileAgent uses SystemMessage, not HumanMessage
      const systemMessage = messages.find(m => m._getType() === 'system');
      const prompt = systemMessage?.content as string;
      
      // Check that prompt is defined
      expect(prompt).toBeDefined();
      expect(prompt).toContain('[A1]');
      expect(prompt).toContain('[A2]');
      expect(prompt).toContain('chat_session_started');
      expect(prompt).toContain('object_ingested');
    });

    it('should format todos with reference labels', async () => {
      // Add activities to meet the threshold (need at least 5 activities or 3 todos)
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
      await todoService.createToDo('test_user', {
        title: 'Deploy model',
        description: 'Deploy to production',
        priority: 2
      });

      const { createChatModel } = await import('../../../utils/llm');
      const mockInvoke = vi.fn();
      (createChatModel as any).mockReturnValue({
        invoke: mockInvoke
      });
      const llmSpy = mockInvoke;

      await profileAgent.synthesizeProfileFromActivitiesAndTasks('test_user');

      // Check that the LLM was called
      expect(llmSpy).toHaveBeenCalled();
      
      // Get the messages that were passed to the LLM
      const messages = llmSpy.mock.calls[0][0] as BaseMessage[];
      // ProfileAgent uses SystemMessage, not HumanMessage
      const systemMessage = messages.find(m => m._getType() === 'system');
      const prompt = systemMessage?.content as string;
      
      // Check that prompt is defined
      expect(prompt).toBeDefined();
      expect(prompt).toContain('[T1]');
      expect(prompt).toContain('[T2]');
      expect(prompt).toContain('[T3]');
      expect(prompt).toContain('Learn TensorFlow');
      expect(prompt).toContain('Build ML model');
      expect(prompt).toContain('Deploy model');
    });
  });
});