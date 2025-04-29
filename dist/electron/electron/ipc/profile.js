"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGetProfileHandler = registerGetProfileHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const ProfileService_1 = require("../../services/ProfileService");
/**
 * Registers the IPC handler for getting the user profile.
 * Delegates the actual fetching to the ProfileService.
 */
function registerGetProfileHandler() {
    electron_1.ipcMain.handle(ipcChannels_1.PROFILE_GET, async (_event) => {
        try {
            const profile = await ProfileService_1.profileService.getProfile();
            return profile;
        }
        catch (error) {
            console.error(`[IPC Handler Error][${ipcChannels_1.PROFILE_GET}]`, error);
            // Throw the error so it rejects the promise in the renderer
            throw new Error('Failed to retrieve profile.');
        }
    });
}
//# sourceMappingURL=profile.js.map