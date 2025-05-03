"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGetSliceDetailsHandler = registerGetSliceDetailsHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger_1 = require("../../utils/logger");
/**
 * Registers the IPC handler for fetching slice details.
 * @param sliceServiceInstance An instance of SliceService.
 */
function registerGetSliceDetailsHandler(sliceServiceInstance) {
    electron_1.ipcMain.handle(ipcChannels_1.GET_SLICE_DETAILS, async (_event, chunkIds) => {
        logger_1.logger.debug(`[IPC Handler][${ipcChannels_1.GET_SLICE_DETAILS}] Received request for chunk IDs: ${JSON.stringify(chunkIds)}`);
        // 1. Validate Input
        if (!Array.isArray(chunkIds) || chunkIds.some(id => typeof id !== 'number')) {
            const errorMsg = 'Invalid input: chunkIds must be an array of numbers.';
            logger_1.logger.error(`[IPC Handler][${ipcChannels_1.GET_SLICE_DETAILS}] ${errorMsg}`);
            throw new Error(errorMsg);
        }
        // Type assertion after validation
        const validChunkIds = chunkIds;
        if (validChunkIds.length === 0) {
            logger_1.logger.debug(`[IPC Handler][${ipcChannels_1.GET_SLICE_DETAILS}] Received empty chunkId array, returning empty result.`);
            return []; // No need to call service for empty array
        }
        try {
            // 2. Delegate to Service
            const sliceDetails = await sliceServiceInstance.getDetailsForSlices(validChunkIds);
            logger_1.logger.info(`[IPC Handler][${ipcChannels_1.GET_SLICE_DETAILS}] Successfully retrieved ${sliceDetails.length} slice details.`);
            // 3. Return success result
            return sliceDetails;
        }
        catch (serviceError) {
            // 3. Handle errors from service layer
            logger_1.logger.error(`[IPC Handler Error][${ipcChannels_1.GET_SLICE_DETAILS}] Failed to get slice details:`, serviceError);
            // Rethrow a user-friendly or sanitized error
            const message = serviceError instanceof Error ? serviceError.message : 'An unknown error occurred while fetching slice details.';
            throw new Error(`Failed to get slice details: ${message}`);
        }
    });
}
//# sourceMappingURL=getSliceDetails.js.map