import { UserProfileModel } from '../models/UserProfileModel';
import { UserProfile, UserProfileUpdatePayload } from '../shared/types';
import { BaseService } from './base/BaseService';
import Database from 'better-sqlite3';

interface ProfileServiceDeps {
  db: Database.Database;
  userProfileModel: UserProfileModel;
}

export class ProfileService extends BaseService<ProfileServiceDeps> {
  constructor(deps: ProfileServiceDeps) {
    super('ProfileService', deps);
    this.logger.info("[ProfileService] Initialized.");
  }

  // Getter for accessing the underlying model (for debugging)
  get profileModel(): UserProfileModel {
    return this.deps.userProfileModel;
  }

  /**
   * Get the user profile. Creates a default profile if none exists.
   */
  async getProfile(userId: string = 'default_user'): Promise<UserProfile> {
    return this.execute('getProfile', async () => {
      let profile = this.deps.userProfileModel.getProfile(userId);
      
      if (!profile) {
        // Create default profile
        this.logger.info("[ProfileService] Creating default profile for:", { userId });
        profile = this.deps.userProfileModel.updateProfile(userId, {
          name: 'friend', // Default name for backward compatibility
        });
      }

      return profile;
    }, { userId });
  }

  /**
   * Update the user profile with new data.
   */
  async updateProfile(payload: UserProfileUpdatePayload): Promise<UserProfile> {
    try {
      const userId = payload.userId || 'default_user';
      
      this.logger.debug("[ProfileService] Updating profile:", { userId, payload });

      // Extract updates (exclude userId from the updates object)
      const { userId: _, ...updates } = payload;

      const updatedProfile = this.deps.userProfileModel.updateProfile(userId, updates);

      this.logger.info("[ProfileService] Profile updated successfully:", { userId });

      return updatedProfile;
    } catch (error) {
      this.logger.error("[ProfileService] Error updating profile:", error);
      throw error;
    }
  }

  /**
   * Update only the explicit user-provided fields.
   */
  async updateExplicitFields(
    userId: string = 'default_user',
    updates: {
      name?: string | null;
      aboutMe?: string | null;
      customInstructions?: string | null;
    }
  ): Promise<UserProfile> {
    try {
      this.logger.debug("[ProfileService] Updating explicit fields:", { userId, updates });

      return this.deps.userProfileModel.updateProfile(userId, updates);
    } catch (error) {
      this.logger.error("[ProfileService] Error updating explicit fields:", error);
      throw error;
    }
  }

  /**
   * Update only the synthesized AI-generated fields.
   */
  async updateSynthesizedFields(
    userId: string = 'default_user',
    updates: {
      synthesizedGoals?: string[] | null;
      synthesizedInterests?: string[] | null;
      synthesizedPreferredSources?: string[] | null;
      synthesizedRecentIntents?: string[] | null;
    }
  ): Promise<UserProfile> {
    try {
      this.logger.debug("[ProfileService] Updating synthesized fields:", { userId });

      return this.deps.userProfileModel.updateProfile(userId, updates);
    } catch (error) {
      this.logger.error("[ProfileService] Error updating synthesized fields:", error);
      throw error;
    }
  }

  /**
   * Get enriched profile data for AI context.
   * This method formats the profile data for inclusion in AI prompts.
   */
  async getEnrichedProfileForAI(userId: string = 'default_user'): Promise<string> {
    try {
      const profile = await this.getProfile(userId);

      const sections: string[] = [];

      // User name
      if (profile.name) {
        sections.push(`User Name: ${profile.name}`);
      }

      // About section
      if (profile.aboutMe) {
        sections.push(`About User: ${profile.aboutMe}`);
      }

      // Custom instructions
      if (profile.customInstructions) {
        sections.push(`Custom Instructions: ${profile.customInstructions}`);
      }

      // Stated goals
      if (profile.statedUserGoals && profile.statedUserGoals.length > 0) {
        const activeGoals = profile.statedUserGoals
          .filter(goal => goal.status === 'active')
          .map(goal => goal.text);
        if (activeGoals.length > 0) {
          sections.push(`Stated Goals: ${activeGoals.join(', ')}`);
        }
      }

      // Inferred goals
      if (profile.inferredUserGoals && profile.inferredUserGoals.length > 0) {
        const goalStrings = profile.inferredUserGoals
          .map(goal => goal.confidence 
            ? `${goal.text} (${Math.round(goal.confidence * 100)}% confidence)`
            : goal.text
          );
        if (goalStrings.length > 0) {
          sections.push(`Inferred Goals: ${goalStrings.join(', ')}`);
        }
      }

      // Synthesized interests
      if (profile.synthesizedInterests && profile.synthesizedInterests.length > 0) {
        sections.push(`User Interests: ${profile.synthesizedInterests.join(', ')}`);
      }

      // Expertise areas
      if (profile.inferredExpertiseAreas && profile.inferredExpertiseAreas.length > 0) {
        sections.push(`Areas of Expertise: ${profile.inferredExpertiseAreas.join(', ')}`);
      }

      // Preferred sources
      if (profile.synthesizedPreferredSources && profile.synthesizedPreferredSources.length > 0) {
        sections.push(`Preferred Sources: ${profile.synthesizedPreferredSources.join(', ')}`);
      }

      // Preferred source types
      if (profile.preferredSourceTypes && profile.preferredSourceTypes.length > 0) {
        sections.push(`Preferred Source Types: ${profile.preferredSourceTypes.join(', ')}`);
      }

      // Recent intents
      if (profile.synthesizedRecentIntents && profile.synthesizedRecentIntents.length > 0) {
        sections.push(`Recent Focus Areas: ${profile.synthesizedRecentIntents.join(', ')}`);
      }

      // Time-bound goals
      if (profile.timeBoundGoals && profile.timeBoundGoals.length > 0) {
        const goalStrings = profile.timeBoundGoals.map(goal => {
          const timeframe = goal.timeHorizon.type;
          return `${goal.text} (${timeframe} goal: ${goal.timeHorizon.startDate} to ${goal.timeHorizon.endDate})`;
        });
        sections.push(`Time-Bound Goals: ${goalStrings.join('; ')}`);
      }

      return sections.length > 0 
        ? sections.join('\n') 
        : 'No user profile information available.';
    } catch (error) {
      this.logger.error("[ProfileService] Error getting enriched profile:", error);
      // Return empty context rather than throwing in AI flows
      return 'No user profile information available.';
    }
  }

  /**
   * Clear synthesized fields (useful for resetting AI inferences).
   */
  async clearSynthesizedFields(userId: string = 'default_user'): Promise<UserProfile> {
    try {
      this.logger.info("[ProfileService] Clearing synthesized fields for:", { userId });

      return this.deps.userProfileModel.updateProfile(userId, {
        inferredUserGoals: null,
        synthesizedInterests: null,
        synthesizedPreferredSources: null,
        synthesizedRecentIntents: null,
        inferredExpertiseAreas: null,
        preferredSourceTypes: null,
      });
    } catch (error) {
      this.logger.error("[ProfileService] Error clearing synthesized fields:", error);
      throw error;
    }
  }

  /**
   * Add time-bound goals to the user's profile.
   */
  async addTimeBoundGoals(
    userId: string = 'default_user',
    goals: Array<{
      text: string;
      timeframeType: 'day' | 'week' | 'month' | 'quarter' | 'year';
      startDate?: string; // If not provided, will be calculated
      endDate?: string; // If not provided, will be calculated
    }>
  ): Promise<UserProfile> {
    try {
      const { v4: uuidv4 } = await import('uuid');
      const profile = await this.getProfile(userId);
      const existingGoals = profile.timeBoundGoals || [];
      
      const newGoals = goals.map(goal => {
        const now = new Date();
        let startDate = goal.startDate || now.toISOString().split('T')[0];
        let endDate = goal.endDate;
        
        if (!endDate) {
          // Calculate end date based on timeframe type
          const endDateObj = new Date(startDate);
          switch (goal.timeframeType) {
            case 'day':
              endDateObj.setDate(endDateObj.getDate() + 1);
              break;
            case 'week':
              endDateObj.setDate(endDateObj.getDate() + 7);
              break;
            case 'month':
              endDateObj.setMonth(endDateObj.getMonth() + 1);
              break;
            case 'quarter':
              endDateObj.setMonth(endDateObj.getMonth() + 3);
              break;
            case 'year':
              endDateObj.setFullYear(endDateObj.getFullYear() + 1);
              break;
          }
          endDate = endDateObj.toISOString().split('T')[0];
        }
        
        return {
          id: uuidv4(),
          text: goal.text,
          createdAt: now.toISOString(),
          timeHorizon: {
            type: goal.timeframeType,
            startDate,
            endDate
          }
        };
      });
      
      this.logger.info("[ProfileService] Adding time-bound goals:", { userId, count: newGoals.length });
      
      return this.deps.userProfileModel.updateProfile(userId, {
        timeBoundGoals: [...existingGoals, ...newGoals]
      });
    } catch (error) {
      this.logger.error("[ProfileService] Error adding time-bound goals:", error);
      throw error;
    }
  }

  /**
   * Remove time-bound goals by their IDs.
   */
  async removeTimeBoundGoals(
    userId: string = 'default_user',
    goalIds: string[]
  ): Promise<UserProfile> {
    try {
      const profile = await this.getProfile(userId);
      const existingGoals = profile.timeBoundGoals || [];
      
      const remainingGoals = existingGoals.filter(goal => !goalIds.includes(goal.id));
      
      this.logger.info("[ProfileService] Removing time-bound goals:", { userId, removedCount: goalIds.length });
      
      return this.deps.userProfileModel.updateProfile(userId, {
        timeBoundGoals: remainingGoals
      });
    } catch (error) {
      this.logger.error("[ProfileService] Error removing time-bound goals:", error);
      throw error;
    }
  }
}

 