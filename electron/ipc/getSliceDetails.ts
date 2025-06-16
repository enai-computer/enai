import { ipcMain } from 'electron';
import { GET_SLICE_DETAILS } from '../../shared/ipcChannels';
import { SliceService } from '../../services/SliceService'; // Assuming SliceService is exported correctly
import { logger } from '../../utils/logger';
import { SliceDetail } from '../../shared/types'; // Import the return type

/**
 * Registers the IPC handler for fetching slice details.
 * @param sliceServiceInstance An instance of SliceService.
 */
export function registerGetSliceDetailsHandler(sliceServiceInstance: SliceService) {
    ipcMain.handle(GET_SLICE_DETAILS, async (_event, chunkIds: unknown): Promise<SliceDetail[]> => {
        logger.debug(`[IPC Handler][${GET_SLICE_DETAILS}] Received request for chunk IDs: ${JSON.stringify(chunkIds)}`);

        // 1. Validate Input
        if (!Array.isArray(chunkIds) || chunkIds.some(id => typeof id !== 'number')) {
            const errorMsg = 'Invalid input: chunkIds must be an array of numbers.';
            logger.error(`[IPC Handler][${GET_SLICE_DETAILS}] ${errorMsg}`);
            throw new Error(errorMsg);
        }

        // Type assertion after validation
        const validChunkIds = chunkIds as number[];

        if (validChunkIds.length === 0) {
             logger.debug(`[IPC Handler][${GET_SLICE_DETAILS}] Received empty chunkId array, returning empty result.`);
             return []; // No need to call service for empty array
        }

        try {
            // 2. Delegate to Service
            const sliceDetails = await sliceServiceInstance.getDetailsForSlices(validChunkIds);
            logger.info(`[IPC Handler][${GET_SLICE_DETAILS}] Successfully retrieved ${sliceDetails.length} slice details.`);
            // 3. Return success result
            return sliceDetails;
        } catch (serviceError) {
            // 3. Handle errors from service layer
            logger.error(`[IPC Handler Error][${GET_SLICE_DETAILS}] Failed to get slice details:`, serviceError);
            // Rethrow a user-friendly or sanitized error
            const message = serviceError instanceof Error ? serviceError.message : 'An unknown error occurred while fetching slice details.';
            throw new Error(`Failed to get slice details: ${message}`);
        }
    });
}
