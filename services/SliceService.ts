import { ChunkSqlModel } from "../models/ChunkModel";
import { ObjectModel, SourceMetadata } from "../models/ObjectModel";
import { logger } from "../utils/logger";
import { ObjectChunk, SliceDetail } from "../shared/types.d";

/**
 * Service responsible for fetching and combining chunk data with source object
 * metadata to create detailed 'slices' for UI display.
 */
export class SliceService {
    private chunkSqlModel: ChunkSqlModel;
    private objectModel: ObjectModel;

    /**
     * Creates an instance of SliceService.
     * @param chunkSqlModel Instance of ChunkSqlModel for accessing chunk data.
     * @param objectModel Instance of ObjectModel for accessing source object data.
     */
    constructor(chunkSqlModel: ChunkSqlModel, objectModel: ObjectModel) {
        this.chunkSqlModel = chunkSqlModel;
        this.objectModel = objectModel;
        logger.info("[SliceService] Initialized.");
    }

    /**
     * Retrieves detailed information (including source object context) for a list of chunk IDs.
     * @param chunkIds An array of chunk primary key IDs (numbers).
     * @returns A Promise resolving to an array of SliceDetail objects.
     */
    async getDetailsForSlices(chunkIds: number[]): Promise<SliceDetail[]> {
        if (!chunkIds || chunkIds.length === 0) {
            logger.debug("[SliceService] getDetailsForSlices called with empty ID array.");
            return [];
        }

        logger.debug(`[SliceService] Fetching details for ${chunkIds.length} chunk IDs: [${chunkIds.slice(0, 5).join(', ')}]...`);

        try {
            // 1. Fetch chunk data from SQL model
            // Convert number[] to string[] as ChunkSqlModel.getChunksByIds currently expects strings
            const chunkIdStrings = chunkIds.map(id => String(id));
            const chunks: ObjectChunk[] = await this.chunkSqlModel.getChunksByIds(chunkIdStrings);

            if (chunks.length === 0) {
                logger.debug("[SliceService] No chunks found for the provided IDs.");
                return [];
            }

            // 2. Extract unique source object IDs
            const objectIds = [...new Set(chunks.map(chunk => chunk.objectId))];

            if (objectIds.length === 0) {
                // This is unexpected if chunks were found
                logger.warn("[SliceService] Chunks found but no associated object IDs extracted.");
                return []; // Return empty or potentially just map chunks without source info?
            }

            // 3. Fetch source object metadata
            const sourceMetadataMap: Map<string, SourceMetadata> = await this.objectModel.getSourceContentDetailsByIds(objectIds);
            logger.debug(`[SliceService] Fetched source metadata for ${sourceMetadataMap.size} unique object IDs.`);

            // 4. Combine chunk data with source metadata
            const sliceDetails: SliceDetail[] = chunks.map(chunk => {
                const sourceMeta = sourceMetadataMap.get(chunk.objectId);

                return {
                    chunkId: chunk.id,
                    content: chunk.content,
                    sourceObjectId: chunk.objectId,
                    sourceObjectTitle: sourceMeta?.title ?? null, // Use null if metadata or title is missing
                    sourceObjectUri: sourceMeta?.sourceUri ?? null, // Use null if metadata or URI is missing
                };
            });

            logger.info(`[SliceService] Successfully prepared ${sliceDetails.length} slice details.`);
            return sliceDetails;

        } catch (error) {
            logger.error(`[SliceService] Error fetching details for chunk IDs [${chunkIds.slice(0, 5).join(', ')}]...:`, error);
            // Re-throw the error to be handled by the IPC handler
            throw error;
        }
    }
}
