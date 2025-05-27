"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerActivityLogHandler = registerActivityLogHandler;
const ipcChannels_1 = require("../../shared/ipcChannels");
const ActivityLogService_1 = require("../../services/ActivityLogService");
const logger_1 = require("../../utils/logger");
/**
 * Registers the IPC handler for logging user activities.
 */
function registerActivityLogHandler(ipcMain) {
    ipcMain.handle(ipcChannels_1.ACTIVITY_LOG_ADD, async (_event, payload) => {
        try {
            logger_1.logger.debug("[ActivityLogHandler] Logging activity:", {
                type: payload.activityType,
                userId: payload.userId
            });
            await (0, ActivityLogService_1.getActivityLogService)().logActivity(payload);
            // No need to return anything for logging
            return { success: true };
        }
        catch (error) {
            logger_1.logger.error("[ActivityLogHandler] Error logging activity:", error);
            // Don't throw for activity logging - we don't want to break the UI
            // Just log the error and continue
            // Type assertion or type checking for error.message
            const errorMessage = error instanceof Error ? error.message : String(error);
            return { success: false, error: errorMessage };
        }
    });
    logger_1.logger.info("[ActivityLogHandler] Activity log handler registered.");
}
//# sourceMappingURL=activityLogHandlers.js.map