"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatMessageSourceMetadataSchema = void 0;
exports.parseChatMetadata = parseChatMetadata;
const zod_1 = require("zod");
/**
 * Schema for chat message source metadata
 */
exports.ChatMessageSourceMetadataSchema = zod_1.z.object({
    sourceChunkIds: zod_1.z.array(zod_1.z.number()).optional().nullable(),
    relevantOriginalQueries: zod_1.z.array(zod_1.z.string()).optional().nullable(),
    confidenceScore: zod_1.z.number().min(0).max(1).optional().nullable(),
    sourceObjectIds: zod_1.z.array(zod_1.z.string()).optional().nullable(),
    retrievalMethod: zod_1.z.string().optional().nullable()
}).passthrough(); // Allow additional fields for extensibility
/**
 * Safely parse and validate chat metadata from JSON string
 */
function parseChatMetadata(metadataJson) {
    try {
        const parsed = JSON.parse(metadataJson);
        const result = exports.ChatMessageSourceMetadataSchema.safeParse(parsed);
        if (result.success) {
            // Additional validation: ensure sourceChunkIds contains valid numbers
            if (result.data.sourceChunkIds && !Array.isArray(result.data.sourceChunkIds)) {
                return null;
            }
            if (result.data.sourceChunkIds?.some(id => typeof id !== 'number' || !Number.isInteger(id))) {
                // Filter out invalid IDs
                result.data.sourceChunkIds = result.data.sourceChunkIds.filter(id => typeof id === 'number' && Number.isInteger(id));
            }
            return result.data;
        }
        return null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=chatSchemas.js.map