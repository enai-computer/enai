import { ipcMain, IpcMain } from 'electron';
import { PROFILE_GET, PROFILE_UPDATE } from '../../shared/ipcChannels';
import { ProfileService } from '../../services/ProfileService';
import { UserProfileUpdatePayload } from '../../shared/types';
import { logger } from '../../utils/logger';

/**
 * Registers the IPC handler for getting the user profile.
 * Delegates the actual fetching to the ProfileService.
 */
export function registerGetProfileHandler(ipcMain: IpcMain, profileService: ProfileService) {
  ipcMain.handle(PROFILE_GET, async (_event) => {
    try {
      logger.debug("[ProfileHandler] Getting profile");
      const profile = await profileService.getProfile();
      return profile;
    } catch (error) {
      logger.error(`[ProfileHandler] Error getting profile:`, error);
      throw new Error('Failed to retrieve profile.');
    }
  });
}

/**
 * Registers the IPC handler for updating the user profile.
 */
export function registerUpdateProfileHandler(ipcMain: IpcMain, profileService: ProfileService) {
  ipcMain.handle(PROFILE_UPDATE, async (_event, payload: UserProfileUpdatePayload) => {
    try {
      logger.debug("[ProfileHandler] Updating profile:", payload);
      const updatedProfile = await profileService.updateProfile(payload);
      return updatedProfile;
    } catch (error) {
      logger.error(`[ProfileHandler] Error updating profile:`, error);
      throw new Error('Failed to update profile.');
    }
  });
}

/**
 * Register all profile-related IPC handlers.
 */
export function registerProfileHandlers(ipcMain: IpcMain, profileService: ProfileService) {
  registerGetProfileHandler(ipcMain, profileService);
  registerUpdateProfileHandler(ipcMain, profileService);
  logger.info("[ProfileHandler] All profile handlers registered.");
} 