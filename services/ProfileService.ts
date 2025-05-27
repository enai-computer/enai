import { UserProfileModel } from '../models/UserProfileModel';
import { UserProfile, UserProfileUpdatePayload } from '../shared/types';
import { logger } from '../utils/logger';
import { getDb } from '../models/db';

export class ProfileService {
  private userProfileModel: UserProfileModel;

  constructor(userProfileModel?: UserProfileModel) {
    const db = getDb();
    this.userProfileModel = userProfileModel || new UserProfileModel(db);
    logger.info("[ProfileService] Initialized.");
  }

  /**
   * Get the user profile. Creates a default profile if none exists.
   */
  async getProfile(userId: string = 'default_user'): Promise<UserProfile> {
    try {
      logger.debug("[ProfileService] Getting profile for:", { userId });

      let profile = this.userProfileModel.getProfile(userId);
      
      if (!profile) {
        // Create default profile
        logger.info("[ProfileService] Creating default profile for:", { userId });
        profile = this.userProfileModel.updateProfile(userId, {
          name: 'friend', // Default name for backward compatibility
        });
      }

      return profile;
    } catch (error) {
      logger.error("[ProfileService] Error getting profile:", error);
      throw error;
    }
  }

  /**
   * Update the user profile with new data.
   */
  async updateProfile(payload: UserProfileUpdatePayload): Promise<UserProfile> {
    try {
      const userId = payload.userId || 'default_user';
      
      logger.debug("[ProfileService] Updating profile:", { userId, payload });

      // Extract updates (exclude userId from the updates object)
      const { userId: _, ...updates } = payload;

      const updatedProfile = this.userProfileModel.updateProfile(userId, updates);

      logger.info("[ProfileService] Profile updated successfully:", { userId });

      return updatedProfile;
    } catch (error) {
      logger.error("[ProfileService] Error updating profile:", error);
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
      logger.debug("[ProfileService] Updating explicit fields:", { userId, updates });

      return this.userProfileModel.updateProfile(userId, updates);
    } catch (error) {
      logger.error("[ProfileService] Error updating explicit fields:", error);
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
      logger.debug("[ProfileService] Updating synthesized fields:", { userId });

      return this.userProfileModel.updateProfile(userId, updates);
    } catch (error) {
      logger.error("[ProfileService] Error updating synthesized fields:", error);
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
        const highConfidenceGoals = profile.inferredUserGoals
          .filter(goal => goal.probability >= 0.7)
          .map(goal => `${goal.text} (${Math.round(goal.probability * 100)}% confidence)`);
        if (highConfidenceGoals.length > 0) {
          sections.push(`Inferred Goals: ${highConfidenceGoals.join(', ')}`);
        }
      }

      // Synthesized interests
      if (profile.synthesizedInterests && profile.synthesizedInterests.length > 0) {
        sections.push(`User Interests: ${profile.synthesizedInterests.join(', ')}`);
      }

      // Preferred sources
      if (profile.synthesizedPreferredSources && profile.synthesizedPreferredSources.length > 0) {
        sections.push(`Preferred Sources: ${profile.synthesizedPreferredSources.join(', ')}`);
      }

      // Recent intents
      if (profile.synthesizedRecentIntents && profile.synthesizedRecentIntents.length > 0) {
        sections.push(`Recent Focus Areas: ${profile.synthesizedRecentIntents.join(', ')}`);
      }

      return sections.length > 0 
        ? sections.join('\n') 
        : 'No user profile information available.';
    } catch (error) {
      logger.error("[ProfileService] Error getting enriched profile:", error);
      // Return empty context rather than throwing in AI flows
      return 'No user profile information available.';
    }
  }

  /**
   * Clear synthesized fields (useful for resetting AI inferences).
   */
  async clearSynthesizedFields(userId: string = 'default_user'): Promise<UserProfile> {
    try {
      logger.info("[ProfileService] Clearing synthesized fields for:", { userId });

      return this.userProfileModel.updateProfile(userId, {
        inferredUserGoals: null,
        synthesizedInterests: null,
        synthesizedPreferredSources: null,
        synthesizedRecentIntents: null,
      });
    } catch (error) {
      logger.error("[ProfileService] Error clearing synthesized fields:", error);
      throw error;
    }
  }
}

// Export a singleton instance with lazy initialization
let _profileService: ProfileService | null = null;

export function getProfileService(): ProfileService {
  if (!_profileService) {
    _profileService = new ProfileService();
  }
  return _profileService;
}

// For backward compatibility
export const profileService = {
  get(): ProfileService {
    return getProfileService();
  }
}; 