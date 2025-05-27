import { IpcMain } from 'electron';
import { ProfileService } from '../../services/ProfileService';
import { ActivityLogService } from '../../services/ActivityLogService';
import { ProfileAgent } from '../../services/agents/ProfileAgent';
import { logger } from '../../utils/logger';

export function registerDebugHandlers(
  ipcMain: IpcMain,
  profileService: ProfileService,
  activityLogService: ActivityLogService,
  profileAgent: ProfileAgent
) {
  // Get current profile with all fields
  ipcMain.handle('debug:getFullProfile', async (event, userId: string = 'default_user') => {
    try {
      logger.info('[DebugHandlers] Getting full profile for:', userId);
      const profile = await profileService.getProfile(userId);
      // Also get raw profile for synthesis fields
      const rawProfile = profileService.profileModel.getProfile(userId) as any;
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
    } catch (error) {
      logger.error('[DebugHandlers] Error getting profile:', error);
      throw error;
    }
  });

  // Get recent activities
  ipcMain.handle('debug:getRecentActivities', async (event, hoursAgo: number = 24) => {
    try {
      logger.info('[DebugHandlers] Getting activities from last', hoursAgo, 'hours');
      const activities = await activityLogService.getRecentActivities('default_user', hoursAgo);
      return activities;
    } catch (error) {
      logger.error('[DebugHandlers] Error getting activities:', error);
      throw error;
    }
  });

  // Force profile synthesis
  ipcMain.handle('debug:forceSynthesis', async (event, synthesisType: 'activities' | 'content' | 'both' = 'both') => {
    try {
      logger.info('[DebugHandlers] Forcing profile synthesis:', synthesisType);
      
      if (synthesisType === 'activities' || synthesisType === 'both') {
        await profileAgent.synthesizeProfileFromActivitiesAndTasks('default_user');
      }
      
      if (synthesisType === 'content' || synthesisType === 'both') {
        await profileAgent.synthesizeProfileFromContent('default_user');
      }
      
      return { success: true, message: `Synthesis completed for: ${synthesisType}` };
    } catch (error) {
      logger.error('[DebugHandlers] Error during synthesis:', error);
      throw error;
    }
  });

  // Get synthesis state
  ipcMain.handle('debug:getSynthesisState', async () => {
    try {
      const profile = await profileService.getProfile('default_user');
      const rawProfile = profileService.profileModel.getProfile('default_user') as any;
      return {
        lastActivitySynthesis: rawProfile?.last_activity_synthesis,
        lastContentSynthesis: rawProfile?.last_content_synthesis,
        hasGoals: !!rawProfile?.inferred_goals_json,
        hasInterests: !!rawProfile?.inferred_interests_json,
        hasExpertise: !!rawProfile?.inferred_expertise_areas_json,
        hasSources: !!rawProfile?.preferred_source_types_json
      };
    } catch (error) {
      logger.error('[DebugHandlers] Error getting synthesis state:', error);
      throw error;
    }
  });

  // Clear profile data (for testing fresh synthesis)
  ipcMain.handle('debug:clearProfile', async () => {
    try {
      logger.warn('[DebugHandlers] Clearing synthesized profile fields');
      await profileService.clearSynthesizedFields('default_user');
      return { success: true, message: 'Profile cleared' };
    } catch (error) {
      logger.error('[DebugHandlers] Error clearing profile:', error);
      throw error;
    }
  });

  logger.info('[DebugHandlers] Debug handlers registered');
}