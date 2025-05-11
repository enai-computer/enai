import { ipcMain } from 'electron';
import { PROFILE_GET } from '../../shared/ipcChannels';
import { profileService } from '../../services/ProfileService';

/**
 * Registers the IPC handler for getting the user profile.
 * Delegates the actual fetching to the ProfileService.
 */
export function registerGetProfileHandler() {
  ipcMain.handle(PROFILE_GET, async (_event) => {
    try {
      const profile = await profileService.getProfile();
      return profile;
    } catch (error) {
      console.error(`[IPC Handler Error][${PROFILE_GET}]`, error);
      // Throw the error so it rejects the promise in the renderer
      throw new Error('Failed to retrieve profile.');
    }
  });
  console.log(`[IPC Main] Handler registered for ${PROFILE_GET}`);
} 