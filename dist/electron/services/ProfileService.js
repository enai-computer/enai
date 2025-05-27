"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileService = exports.ProfileService = void 0;
exports.getProfileService = getProfileService;
const UserProfileModel_1 = require("../models/UserProfileModel");
const logger_1 = require("../utils/logger");
const db_1 = require("../models/db");
class ProfileService {
    constructor(userProfileModel) {
        const db = (0, db_1.getDb)();
        this.userProfileModel = userProfileModel || new UserProfileModel_1.UserProfileModel(db);
        logger_1.logger.info("[ProfileService] Initialized.");
    }
    /**
     * Get the user profile. Creates a default profile if none exists.
     */
    async getProfile(userId = 'default_user') {
        try {
            logger_1.logger.debug("[ProfileService] Getting profile for:", { userId });
            let profile = this.userProfileModel.getProfile(userId);
            if (!profile) {
                // Create default profile
                logger_1.logger.info("[ProfileService] Creating default profile for:", { userId });
                profile = this.userProfileModel.updateProfile(userId, {
                    name: 'friend', // Default name for backward compatibility
                });
            }
            return profile;
        }
        catch (error) {
            logger_1.logger.error("[ProfileService] Error getting profile:", error);
            throw error;
        }
    }
    /**
     * Update the user profile with new data.
     */
    async updateProfile(payload) {
        try {
            const userId = payload.userId || 'default_user';
            logger_1.logger.debug("[ProfileService] Updating profile:", { userId, payload });
            // Extract updates (exclude userId from the updates object)
            const { userId: _, ...updates } = payload;
            const updatedProfile = this.userProfileModel.updateProfile(userId, updates);
            logger_1.logger.info("[ProfileService] Profile updated successfully:", { userId });
            return updatedProfile;
        }
        catch (error) {
            logger_1.logger.error("[ProfileService] Error updating profile:", error);
            throw error;
        }
    }
    /**
     * Update only the explicit user-provided fields.
     */
    async updateExplicitFields(userId = 'default_user', updates) {
        try {
            logger_1.logger.debug("[ProfileService] Updating explicit fields:", { userId, updates });
            return this.userProfileModel.updateProfile(userId, updates);
        }
        catch (error) {
            logger_1.logger.error("[ProfileService] Error updating explicit fields:", error);
            throw error;
        }
    }
    /**
     * Update only the synthesized AI-generated fields.
     */
    async updateSynthesizedFields(userId = 'default_user', updates) {
        try {
            logger_1.logger.debug("[ProfileService] Updating synthesized fields:", { userId });
            return this.userProfileModel.updateProfile(userId, updates);
        }
        catch (error) {
            logger_1.logger.error("[ProfileService] Error updating synthesized fields:", error);
            throw error;
        }
    }
    /**
     * Get enriched profile data for AI context.
     * This method formats the profile data for inclusion in AI prompts.
     */
    async getEnrichedProfileForAI(userId = 'default_user') {
        try {
            const profile = await this.getProfile(userId);
            const sections = [];
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
                    : goal.text);
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
            return sections.length > 0
                ? sections.join('\n')
                : 'No user profile information available.';
        }
        catch (error) {
            logger_1.logger.error("[ProfileService] Error getting enriched profile:", error);
            // Return empty context rather than throwing in AI flows
            return 'No user profile information available.';
        }
    }
    /**
     * Clear synthesized fields (useful for resetting AI inferences).
     */
    async clearSynthesizedFields(userId = 'default_user') {
        try {
            logger_1.logger.info("[ProfileService] Clearing synthesized fields for:", { userId });
            return this.userProfileModel.updateProfile(userId, {
                inferredUserGoals: null,
                synthesizedInterests: null,
                synthesizedPreferredSources: null,
                synthesizedRecentIntents: null,
                inferredExpertiseAreas: null,
                preferredSourceTypes: null,
            });
        }
        catch (error) {
            logger_1.logger.error("[ProfileService] Error clearing synthesized fields:", error);
            throw error;
        }
    }
}
exports.ProfileService = ProfileService;
// Export a singleton instance with lazy initialization
let _profileService = null;
function getProfileService() {
    if (!_profileService) {
        _profileService = new ProfileService();
    }
    return _profileService;
}
// For backward compatibility
exports.profileService = {
    get() {
        return getProfileService();
    }
};
//# sourceMappingURL=ProfileService.js.map