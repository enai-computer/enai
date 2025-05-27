"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDebugHandlers = registerDebugHandlers;
const logger_1 = require("../../utils/logger");
function registerDebugHandlers(ipcMain, profileService, activityLogService, profileAgent) {
    // Get current profile with all fields
    ipcMain.handle('debug:getFullProfile', async (event, userId = 'default_user') => {
        try {
            logger_1.logger.info('[DebugHandlers] Getting full profile for:', userId);
            const profile = await profileService.getProfile(userId);
            // Also get raw profile for synthesis fields
            const rawProfile = profileService.profileModel.getProfile(userId);
            return {
                ...profile,
                // Add synthesis metadata fields
                lastActivitySynthesis: rawProfile?.last_activity_synthesis,
                lastContentSynthesis: rawProfile?.last_content_synthesis,
                inferredGoalsJson: rawProfile?.inferred_goals_json,
                inferredInterestsJson: rawProfile?.inferred_interests_json,
                inferredExpertiseAreasJson: rawProfile?.inferred_expertise_areas_json,
                preferredSourceTypesJson: rawProfile?.preferred_source_types_json
            };
        }
        catch (error) {
            logger_1.logger.error('[DebugHandlers] Error getting profile:', error);
            throw error;
        }
    });
    // Get recent activities
    ipcMain.handle('debug:getRecentActivities', async (event, hoursAgo = 24) => {
        try {
            logger_1.logger.info('[DebugHandlers] Getting activities from last', hoursAgo, 'hours');
            const activities = await activityLogService.getRecentActivities('default_user', hoursAgo);
            return activities;
        }
        catch (error) {
            logger_1.logger.error('[DebugHandlers] Error getting activities:', error);
            throw error;
        }
    });
    // Force profile synthesis
    ipcMain.handle('debug:forceSynthesis', async (event, synthesisType = 'both') => {
        try {
            logger_1.logger.info('[DebugHandlers] Forcing profile synthesis:', synthesisType);
            if (synthesisType === 'activities' || synthesisType === 'both') {
                await profileAgent.synthesizeProfileFromActivitiesAndTasks('default_user');
            }
            if (synthesisType === 'content' || synthesisType === 'both') {
                await profileAgent.synthesizeProfileFromContent('default_user');
            }
            return { success: true, message: `Synthesis completed for: ${synthesisType}` };
        }
        catch (error) {
            logger_1.logger.error('[DebugHandlers] Error during synthesis:', error);
            throw error;
        }
    });
    // Get synthesis state
    ipcMain.handle('debug:getSynthesisState', async () => {
        try {
            const profile = await profileService.getProfile('default_user');
            const rawProfile = profileService.profileModel.getProfile('default_user');
            return {
                lastActivitySynthesis: rawProfile?.last_activity_synthesis,
                lastContentSynthesis: rawProfile?.last_content_synthesis,
                hasGoals: !!rawProfile?.inferred_goals_json,
                hasInterests: !!rawProfile?.inferred_interests_json,
                hasExpertise: !!rawProfile?.inferred_expertise_areas_json,
                hasSources: !!rawProfile?.preferred_source_types_json
            };
        }
        catch (error) {
            logger_1.logger.error('[DebugHandlers] Error getting synthesis state:', error);
            throw error;
        }
    });
    // Clear profile data (for testing fresh synthesis)
    ipcMain.handle('debug:clearProfile', async () => {
        try {
            logger_1.logger.warn('[DebugHandlers] Clearing synthesized profile fields');
            await profileService.clearSynthesizedFields('default_user');
            return { success: true, message: 'Profile cleared' };
        }
        catch (error) {
            logger_1.logger.error('[DebugHandlers] Error clearing profile:', error);
            throw error;
        }
    });
    logger_1.logger.info('[DebugHandlers] Debug handlers registered');
}
//# sourceMappingURL=debugHandlers.js.map