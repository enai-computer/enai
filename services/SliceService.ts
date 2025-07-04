import { ChunkModel } from "../models/ChunkModel";
import { ObjectModel, SourceMetadata } from "../models/ObjectModel";
import { ObjectChunk, SliceDetail } from "../shared/types";
import { BaseService } from './base/BaseService';
import { BaseServiceDependencies } from './interfaces';

interface SliceServiceDeps extends BaseServiceDependencies {
    chunkModel: ChunkModel;
    objectModel: ObjectModel;
}

/**
 * Service responsible for fetching and combining chunk data with source object
 * metadata to create detailed 'slices' for UI display.
 */
export class SliceService extends BaseService<SliceServiceDeps> {
    constructor(deps: SliceServiceDeps) {
        super('SliceService', deps);
    }

    /**
     * Retrieves detailed information (including source object context) for a list of chunk IDs.
     * @param chunkIds An array of chunk primary key IDs (numbers).
     * @returns A Promise resolving to an array of SliceDetail objects.
     */
    async getDetailsForSlices(chunkIds: number[]): Promise<SliceDetail[]> {
        return this.execute('getDetailsForSlices', async () => {
            if (!chunkIds || chunkIds.length === 0) {
                this.logDebug("getDetailsForSlices called with empty ID array.");
                return [];
            }

            this.logInfo(`getDetailsForSlices called with ${chunkIds.length} chunk IDs`);
            this.logDebug(`Chunk IDs: [${chunkIds.join(', ')}]`);
            // 1. Fetch chunk data from SQL model
            // Convert number[] to string[] as ChunkModel.getChunksByIds currently expects strings
            const chunkIdStrings = chunkIds.map(id => String(id));
            this.logDebug(`Converted to string IDs: [${chunkIdStrings.join(', ')}]`);
            
            const chunks: ObjectChunk[] = await this.deps.chunkModel.getChunksByIds(chunkIdStrings);
            this.logInfo(`ChunkModel returned ${chunks.length} chunks`);

            if (chunks.length === 0) {
                this.logWarn("No chunks found for the provided IDs. This suggests the chunks don't exist in the database.");
                return [];
            }

            // Log chunk details
            this.logDebug('Retrieved chunks:', chunks.map(c => ({
                id: c.id,
                objectId: c.objectId,
                contentLength: c.content?.length || 0,
                chunkIdx: c.chunkIdx,
                notebookId: c.notebookId
            })));

            // 2. Extract unique source object IDs
            const objectIds = [...new Set(chunks.map(chunk => chunk.objectId))];
            this.logDebug(`Extracted ${objectIds.length} unique object IDs: [${objectIds.slice(0, 5).join(', ')}]${objectIds.length > 5 ? '...' : ''}`);

            if (objectIds.length === 0) {
                // This is unexpected if chunks were found
                this.logError("Chunks found but no associated object IDs extracted. Chunk data may be corrupted.");
                return [];
            }

            // 3. Fetch source object metadata
            const sourceMetadataMap: Map<string, SourceMetadata> = await this.deps.objectModel.getSourceContentDetailsByIds(objectIds);
            this.logInfo(`ObjectModel returned metadata for ${sourceMetadataMap.size} objects`);
            
            // Log metadata details
            this.logDebug('Source metadata:', Array.from(sourceMetadataMap.entries()).map(([id, meta]) => ({
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
                    this.logWarn(`No metadata found for object ID: ${chunk.objectId}`);
                }

                const sliceDetail: SliceDetail = {
                    chunkId: chunk.id,
                    content: chunk.content,
                    summary: chunk.summary ?? null,
                    sourceObjectId: chunk.objectId,
                    sourceObjectTitle: sourceMeta?.title ?? null,
                    sourceObjectUri: sourceMeta?.sourceUri ?? null,
                };
                
                this.logDebug(`Created slice detail for chunk ${chunk.id}:`, {
                    chunkId: sliceDetail.chunkId,
                    contentLength: sliceDetail.content?.length || 0,
                    sourceObjectId: sliceDetail.sourceObjectId,
                    sourceObjectTitle: sliceDetail.sourceObjectTitle,
                    sourceObjectUri: sliceDetail.sourceObjectUri
                });
                
                return sliceDetail;
            });

            this.logInfo(`Successfully prepared ${sliceDetails.length} slice details.`);
            return sliceDetails;
        });
    }
}
