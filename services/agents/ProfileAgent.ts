import Database from 'better-sqlite3';
import { getActivityLogService, ActivityLogService } from '../ActivityLogService';
import { createChatModel } from '../../utils/llm';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getToDoService, ToDoService } from '../ToDoService';
import { getProfileService, ProfileService } from '../ProfileService';
import { UserProfile, UserGoalItem, InferredUserGoalItem, UserActivity, ToDoItem } from '../../shared/types';
import { logger } from '../../utils/logger';
import { ObjectModel } from '../../models/ObjectModel';
import { ChunkSqlModel } from '../../models/ChunkModel';
import { 
  SynthesizedProfileDataSchema,
  ContentSynthesisDataSchema,
  parseLLMResponse,
  type SynthesizedProfileData,
  type ContentSynthesisData
} from '../../shared/schemas/profileSchemas';

interface SynthesisState {
  lastActivityCount: number;
  lastTodoCount: number;
  lastContentCount: number;
  lastSynthesisTime: Date;
  lastSuccessfulActivitySynthesis: Date;
  lastSuccessfulContentSynthesis: Date;
}

export class ProfileAgent {
  private activityLogService: ActivityLogService;
  private toDoService: ToDoService;
  private profileService: ProfileService;
  private objectModel: ObjectModel;
  private chunkSqlModel: ChunkSqlModel;
  
  private synthesisState: Map<string, SynthesisState> = new Map();
  private lastApiCallTime = 0;
  private minApiCallInterval = 1000; // 1 second between API calls

  constructor(
    db: Database.Database,
    activityLogServiceInstance?: ActivityLogService,
    toDoServiceInstance?: ToDoService,
    profileServiceInstance?: ProfileService,
    objectModelInstance?: ObjectModel,
    chunkSqlModelInstance?: ChunkSqlModel
  ) {
    this.activityLogService = activityLogServiceInstance || getActivityLogService();
    this.toDoService = toDoServiceInstance || getToDoService();
    this.profileService = profileServiceInstance || getProfileService();

    this.objectModel = objectModelInstance || new ObjectModel(db);
    this.chunkSqlModel = chunkSqlModelInstance || new ChunkSqlModel(db);
    
    logger.info(`[ProfileAgent] Initialized.`);
  }

  private async shouldSynthesizeActivities(userId: string): Promise<boolean> {
    const state = this.synthesisState.get(userId) || {
      lastActivityCount: 0,
      lastTodoCount: 0,
      lastContentCount: 0,
      lastSynthesisTime: new Date(0),
      lastSuccessfulActivitySynthesis: new Date(0),
      lastSuccessfulContentSynthesis: new Date(0)
    };

    try {
      // Efficiently count recent activities without fetching all data
      const currentActivityCount = await this.activityLogService.countRecentActivities(userId, 24);
      
      // Efficiently count active todos
      const pendingCount = await this.toDoService.countToDos(userId, 'pending');
      const inProgressCount = await this.toDoService.countToDos(userId, 'in_progress');
      const currentTodoCount = pendingCount + inProgressCount;
      
      const hasSignificantChanges = 
        Math.abs(currentActivityCount - state.lastActivityCount) >= 5 ||
        Math.abs(currentTodoCount - state.lastTodoCount) >= 3;
      
      if (hasSignificantChanges) {
        // Don't update counts here - wait for successful synthesis
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error(`[ProfileAgent] Error checking synthesis need for ${userId}:`, error);
      return false;
    }
  }

  private async shouldSynthesizeContent(userId: string): Promise<boolean> {
    const state = this.synthesisState.get(userId) || {
      lastActivityCount: 0,
      lastTodoCount: 0,
      lastContentCount: 0,
      lastSynthesisTime: new Date(0),
      lastSuccessfulActivitySynthesis: new Date(0),
      lastSuccessfulContentSynthesis: new Date(0)
    };

    try {
      // Efficiently count embedded objects without fetching all data
      const currentContentCount = await this.objectModel.countObjectsByStatus('embedded');
      
      const hasSignificantChanges = 
        Math.abs(currentContentCount - state.lastContentCount) >= 3;
      
      if (hasSignificantChanges) {
        // Don't update counts here - wait for successful synthesis
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error(`[ProfileAgent] Error checking content synthesis need for ${userId}:`, error);
      return false;
    }
  }

  private updateSynthesisState(userId: string, type: 'activity' | 'content', counts: { activities?: number; todos?: number; content?: number }) {
    const state = this.synthesisState.get(userId) || {
      lastActivityCount: 0,
      lastTodoCount: 0,
      lastContentCount: 0,
      lastSynthesisTime: new Date(0),
      lastSuccessfulActivitySynthesis: new Date(0),
      lastSuccessfulContentSynthesis: new Date(0)
    };

    const now = new Date();
    state.lastSynthesisTime = now;

    if (type === 'activity') {
      if (counts.activities !== undefined) state.lastActivityCount = counts.activities;
      if (counts.todos !== undefined) state.lastTodoCount = counts.todos;
      state.lastSuccessfulActivitySynthesis = now;
    } else if (type === 'content') {
      if (counts.content !== undefined) state.lastContentCount = counts.content;
      state.lastSuccessfulContentSynthesis = now;
    }

    this.synthesisState.set(userId, state);
    logger.debug(`[ProfileAgent] Updated synthesis state for ${userId}, type: ${type}`, { state });
  }


  private async rateLimitedLLMInvoke(prompt: string): Promise<any> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCallTime;
    
    if (timeSinceLastCall < this.minApiCallInterval) {
      await new Promise(resolve => 
        setTimeout(resolve, this.minApiCallInterval - timeSinceLastCall)
      );
    }
    
    this.lastApiCallTime = Date.now();
    
    const messages = [
      new SystemMessage(prompt)
    ];
    
    // Using gpt-4o for the complex task of synthesizing a user profile
    const model = createChatModel('gpt-4o', {
      temperature: 0.5,
      response_format: { type: 'json_object' }
    });
    
    return model.invoke(messages);
  }

  private formatActivitiesForLLM(activities: UserActivity[], limit = 20): string {
    if (!activities || activities.length === 0) return "No recent activities.";
    
    return "Recent Activities:\n" + activities.slice(0, limit).map((act, index) => {
      let details = '';
      try {
        if (act.detailsJson) {
          const parsed = JSON.parse(act.detailsJson);
          // Extract most relevant details, truncate long values
          details = Object.entries(parsed)
            .filter(([key]) => key !== 'timestamp' && key !== 'userId')
            .map(([key, value]) => {
              const strValue = String(value);
              return `${key}: ${strValue.length > 50 ? strValue.substring(0, 50) + '...' : strValue}`;
            })
            .join(', ');
        }
      } catch (e) { 
        details = act.detailsJson || '';
      }
      return `- [A${index + 1}] ${act.activityType}: ${details} (${act.timestamp.toLocaleDateString()})`;
    }).join("\n");
  }

  private formatToDosForLLM(todos: ToDoItem[], limit = 10): string {
    if (!todos || todos.length === 0) return "No active to-do items.";
    
    return "Active To-Do Items:\n" + todos.slice(0, limit).map((todo, index) =>
      `- [T${index + 1}] "${todo.title}" (Status: ${todo.status}, Priority: ${todo.priority || 'N/A'}, Due: ${
        todo.dueDate ? todo.dueDate.toLocaleDateString() : 'N/A'
      })`
    ).join("\n");
  }
  
  private formatStatedGoalsForLLM(goals?: UserGoalItem[] | null): string {
    if (!goals || goals.length === 0) return "No user-stated goals.";
    
    return "User's Stated Goals:\n" + goals
      .filter(g => g.status === 'active')
      .map(g => `- "${g.text}" (Priority: ${g.priority || 'N/A'})`)
      .join("\n");
  }

  async synthesizeProfileFromActivitiesAndTasks(userId: string = 'default_user'): Promise<void> {
    logger.info(`[ProfileAgent] Starting synthesis from activities and tasks for user: ${userId}`);
    
    try {
      // Check if synthesis is needed
      if (!await this.shouldSynthesizeActivities(userId)) {
        logger.info(`[ProfileAgent] Skipping synthesis - no significant changes for ${userId}`);
        return;
      }

      const recentActivities = await this.activityLogService.getRecentActivities(userId, 7 * 24, 50);
      
      // Get active todos
      const pendingTodos = await this.toDoService.getToDos(userId, 'pending');
      const inProgressTodos = await this.toDoService.getToDos(userId, 'in_progress');
      const activeToDos = [...pendingTodos, ...inProgressTodos].slice(0, 20);
      const userProfile = await this.profileService.getProfile(userId);
      const statedGoals = userProfile.statedUserGoals;

      const activityContext = this.formatActivitiesForLLM(recentActivities);
      const toDoContext = this.formatToDosForLLM(activeToDos);
      const statedGoalContext = this.formatStatedGoalsForLLM(statedGoals);

      const systemPrompt = `
You are an AI assistant that analyzes a user's recent activities, to-do items, and stated goals to infer their current focus, interests, and potential underlying goals.

Activities are labeled [A1], [A2], etc. To-dos are labeled [T1], [T2], etc. Use these labels when providing evidence.

Based on the provided data, generate a JSON object with the following keys:
- "inferredUserGoals": An array of objects, each with "text" (string, the inferred goal) and optionally "confidence" (number, 0.0-1.0) and "evidence" (array of strings with labels like ["A1", "T3"] pointing to supporting items). Max 5 goals.
- "synthesizedInterests": An array of strings listing topics the user seems interested in based on their actions. Max 5 interests.
- "synthesizedRecentIntents": An array of strings describing the user's recent high-level tasks or operational focus areas. Max 3-5 intents.

Be concise and focus on actionable insights. If data is sparse, it's okay to return empty arrays or fewer items.

Data:
${activityContext}

${toDoContext}

${statedGoalContext}

Respond ONLY with the JSON object.`;

      const response = await this.rateLimitedLLMInvoke(systemPrompt);
      let synthesizedData: SynthesizedProfileData | null = null;

      if (typeof response.content === 'string') {
        synthesizedData = parseLLMResponse(
          response.content,
          SynthesizedProfileDataSchema,
          `activity synthesis for ${userId}`
        );
        
        if (!synthesizedData) {
          logger.warn(`[ProfileAgent] Could not parse synthesis response for ${userId}, skipping update`);
          logger.debug(`[ProfileAgent] Raw content that failed to parse: ${response.content.substring(0, 500)}...`);
          return;
        }
        
        logger.info(`[ProfileAgent] Parsed LLM response for ${userId}:`, synthesizedData);
      } else {
        logger.warn(`[ProfileAgent] LLM response content was not a string for ${userId}.`);
        return;
      }

      await this.profileService.updateProfile({
        userId,
        inferredUserGoals: synthesizedData.inferredUserGoals || null,
        synthesizedInterests: synthesizedData.synthesizedInterests || null,
        synthesizedRecentIntents: synthesizedData.synthesizedRecentIntents || null,
      });

      logger.info(`[ProfileAgent] Successfully updated synthesized profile fields for user: ${userId}`);

      // Update state after successful synthesis
      const activityCount = await this.activityLogService.countRecentActivities(userId, 24);
      const pendingCount = await this.toDoService.countToDos(userId, 'pending');
      const inProgressCount = await this.toDoService.countToDos(userId, 'in_progress');
      this.updateSynthesisState(userId, 'activity', {
        activities: activityCount,
        todos: pendingCount + inProgressCount
      });

    } catch (error) {
      if (error instanceof Error && error.message?.includes('rate limit')) {
        logger.warn(`[ProfileAgent] Rate limited, will retry next interval`);
      } else {
        logger.error(`[ProfileAgent] Error during activity synthesis for user ${userId}:`, error);
      }
    }
  }

  async synthesizeProfileFromContent(userId: string = 'default_user'): Promise<void> {
    logger.info(`[ProfileAgent] Starting synthesis from content for user: ${userId}`);
    
    try {
      // Check if synthesis is needed
      if (!await this.shouldSynthesizeContent(userId)) {
        logger.info(`[ProfileAgent] Skipping content synthesis - no significant changes for ${userId}`);
        return;
      }

      // Get recent embedded objects
      const allEmbeddedObjects = await this.objectModel.findByStatus(['embedded']);
      const recentObjects = allEmbeddedObjects
        .map(obj => ({ ...obj, id: obj.id, title: null, objectType: 'unknown' }))
        .slice(0, 10); // Take 10 most recent
      
      if (recentObjects.length === 0) {
        logger.info(`[ProfileAgent] No content to synthesize for ${userId}`);
        return;
      }

      // Format content for LLM
      let contentSnippets = "Content Snippets:\n";
      
      for (let i = 0; i < Math.min(5, recentObjects.length); i++) {
        const obj = recentObjects[i];
        // Get full object details
        const fullObj = await this.objectModel.getById(obj.id);
        if (!fullObj) continue;
        
        // Get chunks for this object
        const chunks = await this.chunkSqlModel.getChunksByObjectId(obj.id);
        const topChunks = chunks.slice(0, 3);
        
        const chunkTexts = topChunks.map((c) => c.content.substring(0, 200)).join(" ");
        contentSnippets += `\nObject ${i + 1} (Title: "${fullObj.title || 'Untitled'}", Type: ${fullObj.objectType}):\n${chunkTexts}\n`;
      }

      const systemPrompt = `
You are an AI assistant analyzing a user's recently saved content (bookmarks, notes, documents) to infer their broader interests, potential areas of expertise, and preferred types of information sources.
Based on the following content snippets, update the user's profile.
Focus on identifying recurring themes, specialized vocabulary, and the nature of the content.

${contentSnippets}

Respond ONLY with a JSON object containing:
- "synthesizedInterests": An array of strings (refined or new interests based on content). Max 5.
- "inferredExpertiseAreas": An array of strings (potential areas where user shows deeper knowledge). Max 5.
- "preferredSourceTypes": An array of strings (e.g., "academic papers", "technical blogs", "news articles", "tutorials"). Max 3.`;

      const response = await this.rateLimitedLLMInvoke(systemPrompt);
      let synthesizedData: ContentSynthesisData | null = null;

      if (typeof response.content === 'string') {
        synthesizedData = parseLLMResponse(
          response.content,
          ContentSynthesisDataSchema,
          `content synthesis for ${userId}`
        );
        
        if (!synthesizedData) {
          logger.warn(`[ProfileAgent] Could not parse content synthesis response for ${userId}, skipping update`);
          logger.debug(`[ProfileAgent] Raw content that failed to parse: ${response.content.substring(0, 500)}...`);
          return;
        }
        
        logger.info(`[ProfileAgent] Parsed content synthesis response for ${userId}:`, synthesizedData);
      } else {
        logger.warn(`[ProfileAgent] Content synthesis response was not a string for ${userId}.`);
        return;
      }

      // Merge with existing profile data
      const currentProfile = await this.profileService.getProfile(userId);
      
      await this.profileService.updateProfile({
        userId,
        synthesizedInterests: synthesizedData.synthesizedInterests || currentProfile.synthesizedInterests,
        inferredExpertiseAreas: synthesizedData.inferredExpertiseAreas || null,
        preferredSourceTypes: synthesizedData.preferredSourceTypes || null,
      });

      logger.info(`[ProfileAgent] Successfully updated content-based profile fields for user: ${userId}`);

      // Update state after successful synthesis
      const contentCount = await this.objectModel.countObjectsByStatus('embedded');
      this.updateSynthesisState(userId, 'content', { content: contentCount });

    } catch (error) {
      if (error instanceof Error && error.message?.includes('rate limit')) {
        logger.warn(`[ProfileAgent] Rate limited during content synthesis, will retry next interval`);
      } else {
        logger.error(`[ProfileAgent] Error during content synthesis for user ${userId}:`, error);
      }
    }
  }
}