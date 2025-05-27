"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserProfileModel = void 0;
const logger_1 = require("../utils/logger");
function mapRecordToProfile(record) {
    return {
        userId: record.user_id,
        name: record.name,
        aboutMe: record.about_me,
        customInstructions: record.custom_instructions,
        statedUserGoals: record.stated_user_goals_json
            ? JSON.parse(record.stated_user_goals_json)
            : null,
        inferredUserGoals: record.inferred_user_goals_json
            ? JSON.parse(record.inferred_user_goals_json)
            : null,
        synthesizedInterests: record.synthesized_interests_json
            ? JSON.parse(record.synthesized_interests_json)
            : null,
        synthesizedPreferredSources: record.synthesized_preferred_sources_json
            ? JSON.parse(record.synthesized_preferred_sources_json)
            : null,
        synthesizedRecentIntents: record.synthesized_recent_intents_json
            ? JSON.parse(record.synthesized_recent_intents_json)
            : null,
        inferredExpertiseAreas: record.inferred_expertise_areas_json
            ? JSON.parse(record.inferred_expertise_areas_json)
            : null,
        preferredSourceTypes: record.preferred_source_types_json
            ? JSON.parse(record.preferred_source_types_json)
            : null,
        updatedAt: new Date(record.updated_at),
    };
}
class UserProfileModel {
    constructor(db) {
        this.db = db;
        logger_1.logger.info("[UserProfileModel] Initialized.");
    }
    /**
     * Get a user profile by ID.
     */
    getProfile(userId = 'default_user') {
        try {
            const stmt = this.db.prepare(`
        SELECT * FROM user_profiles WHERE user_id = $userId
      `);
            const record = stmt.get({ userId });
            if (!record) {
                logger_1.logger.debug("[UserProfileModel] Profile not found:", { userId });
                return null;
            }
            return mapRecordToProfile(record);
        }
        catch (error) {
            logger_1.logger.error("[UserProfileModel] Error getting profile:", error);
            throw error;
        }
    }
    /**
     * Update a user profile (partial update).
     */
    updateProfile(userId = 'default_user', updates) {
        try {
            const updateFields = [];
            const params = {
                userId,
                updatedAt: Date.now(),
            };
            // Handle explicit fields
            if (updates.name !== undefined) {
                updateFields.push('name = $name');
                params.name = updates.name;
            }
            if (updates.aboutMe !== undefined) {
                updateFields.push('about_me = $aboutMe');
                params.aboutMe = updates.aboutMe;
            }
            if (updates.customInstructions !== undefined) {
                updateFields.push('custom_instructions = $customInstructions');
                params.customInstructions = updates.customInstructions;
            }
            // Handle goal fields (convert arrays to JSON)
            if (updates.statedUserGoals !== undefined) {
                updateFields.push('stated_user_goals_json = $statedUserGoalsJson');
                params.statedUserGoalsJson = updates.statedUserGoals
                    ? JSON.stringify(updates.statedUserGoals)
                    : null;
            }
            if (updates.inferredUserGoals !== undefined) {
                updateFields.push('inferred_user_goals_json = $inferredUserGoalsJson');
                params.inferredUserGoalsJson = updates.inferredUserGoals
                    ? JSON.stringify(updates.inferredUserGoals)
                    : null;
            }
            if (updates.synthesizedInterests !== undefined) {
                updateFields.push('synthesized_interests_json = $synthesizedInterestsJson');
                params.synthesizedInterestsJson = updates.synthesizedInterests
                    ? JSON.stringify(updates.synthesizedInterests)
                    : null;
            }
            if (updates.synthesizedPreferredSources !== undefined) {
                updateFields.push('synthesized_preferred_sources_json = $synthesizedPreferredSourcesJson');
                params.synthesizedPreferredSourcesJson = updates.synthesizedPreferredSources
                    ? JSON.stringify(updates.synthesizedPreferredSources)
                    : null;
            }
            if (updates.synthesizedRecentIntents !== undefined) {
                updateFields.push('synthesized_recent_intents_json = $synthesizedRecentIntentsJson');
                params.synthesizedRecentIntentsJson = updates.synthesizedRecentIntents
                    ? JSON.stringify(updates.synthesizedRecentIntents)
                    : null;
            }
            if (updates.inferredExpertiseAreas !== undefined) {
                updateFields.push('inferred_expertise_areas_json = $inferredExpertiseAreasJson');
                params.inferredExpertiseAreasJson = updates.inferredExpertiseAreas
                    ? JSON.stringify(updates.inferredExpertiseAreas)
                    : null;
            }
            if (updates.preferredSourceTypes !== undefined) {
                updateFields.push('preferred_source_types_json = $preferredSourceTypesJson');
                params.preferredSourceTypesJson = updates.preferredSourceTypes
                    ? JSON.stringify(updates.preferredSourceTypes)
                    : null;
            }
            // Always update the timestamp
            updateFields.push('updated_at = $updatedAt');
            if (updateFields.length === 1) {
                // Only timestamp update, no actual changes
                const existingProfile = this.getProfile(userId);
                if (!existingProfile) {
                    // Create new profile
                    return this.createProfile(userId);
                }
                return existingProfile;
            }
            const updateQuery = `
        UPDATE user_profiles 
        SET ${updateFields.join(', ')}
        WHERE user_id = $userId
      `;
            const updateStmt = this.db.prepare(updateQuery);
            const result = updateStmt.run(params);
            if (result.changes === 0) {
                // Profile doesn't exist, create it
                const profile = this.createProfile(userId);
                // Recursively update with the same updates
                return this.updateProfile(userId, updates);
            }
            logger_1.logger.debug("[UserProfileModel] Profile updated:", { userId, updates });
            // Return the updated profile
            const updatedProfile = this.getProfile(userId);
            if (!updatedProfile) {
                throw new Error(`Failed to retrieve updated profile for user: ${userId}`);
            }
            return updatedProfile;
        }
        catch (error) {
            logger_1.logger.error("[UserProfileModel] Error updating profile:", error);
            throw error;
        }
    }
    /**
     * Create a new user profile with defaults.
     */
    createProfile(userId) {
        try {
            const stmt = this.db.prepare(`
        INSERT INTO user_profiles (user_id, updated_at)
        VALUES ($userId, $updatedAt)
      `);
            stmt.run({
                userId,
                updatedAt: Date.now(),
            });
            logger_1.logger.info("[UserProfileModel] Created new profile:", { userId });
            const newProfile = this.getProfile(userId);
            if (!newProfile) {
                throw new Error(`Failed to create profile for user: ${userId}`);
            }
            return newProfile;
        }
        catch (error) {
            logger_1.logger.error("[UserProfileModel] Error creating profile:", error);
            throw error;
        }
    }
    /**
     * Delete a user profile (for cleanup/testing).
     */
    deleteProfile(userId) {
        try {
            const stmt = this.db.prepare(`
        DELETE FROM user_profiles WHERE user_id = $userId
      `);
            const result = stmt.run({ userId });
            logger_1.logger.info("[UserProfileModel] Profile deleted:", {
                userId,
                deleted: result.changes > 0,
            });
            return result.changes > 0;
        }
        catch (error) {
            logger_1.logger.error("[UserProfileModel] Error deleting profile:", error);
            throw error;
        }
    }
}
exports.UserProfileModel = UserProfileModel;
//# sourceMappingURL=UserProfileModel.js.map