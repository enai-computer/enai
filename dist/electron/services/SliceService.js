"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SliceService = void 0;
const logger_1 = require("../utils/logger");
/**
 * Service responsible for fetching and combining chunk data with source object
 * metadata to create detailed 'slices' for UI display.
 */
class SliceService {
    /**
     * Creates an instance of SliceService.
     * @param chunkSqlModel Instance of ChunkSqlModel for accessing chunk data.
     * @param objectModel Instance of ObjectModel for accessing source object data.
     */
    constructor(chunkSqlModel, objectModel) {
        this.chunkSqlModel = chunkSqlModel;
        this.objectModel = objectModel;
        logger_1.logger.info("[SliceService] Initialized.");
    }
    /**
     * Retrieves detailed information (including source object context) for a list of chunk IDs.
     * @param chunkIds An array of chunk primary key IDs (numbers).
     * @returns A Promise resolving to an array of SliceDetail objects.
     */
    async getDetailsForSlices(chunkIds) {
        if (!chunkIds || chunkIds.length === 0) {
            logger_1.logger.debug("[SliceService] getDetailsForSlices called with empty ID array.");
            return [];
        }
        logger_1.logger.info(`[SliceService] getDetailsForSlices called with ${chunkIds.length} chunk IDs`);
        logger_1.logger.debug(`[SliceService] Chunk IDs: [${chunkIds.join(', ')}]`);
        try {
            // 1. Fetch chunk data from SQL model
            // Convert number[] to string[] as ChunkSqlModel.getChunksByIds currently expects strings
            const chunkIdStrings = chunkIds.map(id => String(id));
            logger_1.logger.debug(`[SliceService] Converted to string IDs: [${chunkIdStrings.join(', ')}]`);
            const chunks = await this.chunkSqlModel.getChunksByIds(chunkIdStrings);
            logger_1.logger.info(`[SliceService] ChunkSqlModel returned ${chunks.length} chunks`);
            if (chunks.length === 0) {
                logger_1.logger.warn("[SliceService] No chunks found for the provided IDs. This suggests the chunks don't exist in the database.");
                return [];
            }
            // Log chunk details
            logger_1.logger.debug('[SliceService] Retrieved chunks:', chunks.map(c => ({
                id: c.id,
                objectId: c.objectId,
                contentLength: c.content?.length || 0,
                chunkIdx: c.chunkIdx,
                notebookId: c.notebookId
            })));
            // 2. Extract unique source object IDs
            const objectIds = [...new Set(chunks.map(chunk => chunk.objectId))];
            logger_1.logger.debug(`[SliceService] Extracted ${objectIds.length} unique object IDs: [${objectIds.slice(0, 5).join(', ')}]${objectIds.length > 5 ? '...' : ''}`);
            if (objectIds.length === 0) {
                // This is unexpected if chunks were found
                logger_1.logger.error("[SliceService] Chunks found but no associated object IDs extracted. Chunk data may be corrupted.");
                return [];
            }
            // 3. Fetch source object metadata
            const sourceMetadataMap = await this.objectModel.getSourceContentDetailsByIds(objectIds);
            logger_1.logger.info(`[SliceService] ObjectModel returned metadata for ${sourceMetadataMap.size} objects`);
            // Log metadata details
            logger_1.logger.debug('[SliceService] Source metadata:', Array.from(sourceMetadataMap.entries()).map(([id, meta]) => ({
                objectId: id,
                title: meta.title,
                sourceUri: meta.sourceUri,
                hasTitle: !!meta.title,
                hasUri: !!meta.sourceUri
            })));
            // 4. Combine chunk data with source metadata
            const sliceDetails = chunks.map(chunk => {
                const sourceMeta = sourceMetadataMap.get(chunk.objectId);
                if (!sourceMeta) {
                    logger_1.logger.warn(`[SliceService] No metadata found for object ID: ${chunk.objectId}`);
                }
                const sliceDetail = {
                    chunkId: chunk.id,
                    content: chunk.content,
                    sourceObjectId: chunk.objectId,
                    sourceObjectTitle: sourceMeta?.title ?? null,
                    sourceObjectUri: sourceMeta?.sourceUri ?? null,
                };
                logger_1.logger.debug(`[SliceService] Created slice detail for chunk ${chunk.id}:`, {
                    chunkId: sliceDetail.chunkId,
                    contentLength: sliceDetail.content?.length || 0,
                    sourceObjectId: sliceDetail.sourceObjectId,
                    sourceObjectTitle: sliceDetail.sourceObjectTitle,
                    sourceObjectUri: sliceDetail.sourceObjectUri
                });
                return sliceDetail;
            });
            logger_1.logger.info(`[SliceService] Successfully prepared ${sliceDetails.length} slice details.`);
            return sliceDetails;
        }
        catch (error) {
            logger_1.logger.error(`[SliceService] Error fetching details for chunk IDs:`, error);
            // Re-throw the error to be handled by the IPC handler
            throw error;
        }
    }
}
exports.SliceService = SliceService;
//# sourceMappingURL=SliceService.js.map