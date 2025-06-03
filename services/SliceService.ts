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

        logger.info(`[SliceService] getDetailsForSlices called with ${chunkIds.length} chunk IDs`);
        logger.debug(`[SliceService] Chunk IDs: [${chunkIds.join(', ')}]`);

        try {
            // 1. Fetch chunk data from SQL model
            // Convert number[] to string[] as ChunkSqlModel.getChunksByIds currently expects strings
            const chunkIdStrings = chunkIds.map(id => String(id));
            logger.debug(`[SliceService] Converted to string IDs: [${chunkIdStrings.join(', ')}]`);
            
            const chunks: ObjectChunk[] = await this.chunkSqlModel.getChunksByIds(chunkIdStrings);
            logger.info(`[SliceService] ChunkSqlModel returned ${chunks.length} chunks`);

            if (chunks.length === 0) {
                logger.warn("[SliceService] No chunks found for the provided IDs. This suggests the chunks don't exist in the database.");
                return [];
            }

            // Log chunk details
            logger.debug('[SliceService] Retrieved chunks:', chunks.map(c => ({
                id: c.id,
                objectId: c.objectId,
                contentLength: c.content?.length || 0,
                chunkIdx: c.chunkIdx,
                notebookId: c.notebookId
            })));

            // 2. Extract unique source object IDs
            const objectIds = [...new Set(chunks.map(chunk => chunk.objectId))];
            logger.debug(`[SliceService] Extracted ${objectIds.length} unique object IDs: [${objectIds.slice(0, 5).join(', ')}]${objectIds.length > 5 ? '...' : ''}`);

            if (objectIds.length === 0) {
                // This is unexpected if chunks were found
                logger.error("[SliceService] Chunks found but no associated object IDs extracted. Chunk data may be corrupted.");
                return [];
            }

            // 3. Fetch source object metadata
            const sourceMetadataMap: Map<string, SourceMetadata> = await this.objectModel.getSourceContentDetailsByIds(objectIds);
            logger.info(`[SliceService] ObjectModel returned metadata for ${sourceMetadataMap.size} objects`);
            
            // Log metadata details
            logger.debug('[SliceService] Source metadata:', Array.from(sourceMetadataMap.entries()).map(([id, meta]) => ({
                objectId: id,
                title: meta.title,
                sourceUri: meta.sourceUri,
                hasTitle: !!meta.title,
                hasUri: !!meta.sourceUri
            })));

            // 4. Combine chunk data with source metadata
            const sliceDetails: SliceDetail[] = chunks.map(chunk => {
                const sourceMeta = sourceMetadataMap.get(chunk.objectId);
                
                if (!sourceMeta) {
                    logger.warn(`[SliceService] No metadata found for object ID: ${chunk.objectId}`);
                }

                const sliceDetail: SliceDetail = {
                    chunkId: chunk.id,
                    content: chunk.content,
                    summary: chunk.summary ?? null,
                    sourceObjectId: chunk.objectId,
                    sourceObjectTitle: sourceMeta?.title ?? null,
                    sourceObjectUri: sourceMeta?.sourceUri ?? null,
                };
                
                logger.debug(`[SliceService] Created slice detail for chunk ${chunk.id}:`, {
                    chunkId: sliceDetail.chunkId,
                    contentLength: sliceDetail.content?.length || 0,
                    sourceObjectId: sliceDetail.sourceObjectId,
                    sourceObjectTitle: sliceDetail.sourceObjectTitle,
                    sourceObjectUri: sliceDetail.sourceObjectUri
                });
                
                return sliceDetail;
            });

            logger.info(`[SliceService] Successfully prepared ${sliceDetails.length} slice details.`);
            return sliceDetails;

        } catch (error) {
            logger.error(`[SliceService] Error fetching details for chunk IDs:`, error);
            // Re-throw the error to be handled by the IPC handler
            throw error;
        }
    }
}
