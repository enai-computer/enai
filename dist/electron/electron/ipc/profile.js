"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGetProfileHandler = registerGetProfileHandler;
exports.registerUpdateProfileHandler = registerUpdateProfileHandler;
exports.registerProfileHandlers = registerProfileHandlers;
const ipcChannels_1 = require("../../shared/ipcChannels");
const ProfileService_1 = require("../../services/ProfileService");
const logger_1 = require("../../utils/logger");
/**
 * Registers the IPC handler for getting the user profile.
 * Delegates the actual fetching to the ProfileService.
 */
function registerGetProfileHandler(ipcMain) {
    ipcMain.handle(ipcChannels_1.PROFILE_GET, async (_event) => {
        try {
            logger_1.logger.debug("[ProfileHandler] Getting profile");
            const profile = await (0, ProfileService_1.getProfileService)().getProfile();
            return profile;
        }
        catch (error) {
            logger_1.logger.error(`[ProfileHandler] Error getting profile:`, error);
            throw new Error('Failed to retrieve profile.');
        }
    });
}
/**
 * Registers the IPC handler for updating the user profile.
 */
function registerUpdateProfileHandler(ipcMain) {
    ipcMain.handle(ipcChannels_1.PROFILE_UPDATE, async (_event, payload) => {
        try {
            logger_1.logger.debug("[ProfileHandler] Updating profile:", payload);
            const updatedProfile = await (0, ProfileService_1.getProfileService)().updateProfile(payload);
            return updatedProfile;
        }
        catch (error) {
            logger_1.logger.error(`[ProfileHandler] Error updating profile:`, error);
            throw new Error('Failed to update profile.');
        }
    });
}
/**
 * Register all profile-related IPC handlers.
 */
function registerProfileHandlers(ipcMain) {
    registerGetProfileHandler(ipcMain);
    registerUpdateProfileHandler(ipcMain);
    logger_1.logger.info("[ProfileHandler] All profile handlers registered.");
}
//# sourceMappingURL=profile.js.map