import { z } from 'zod';

/**
 * Schema for chat message source metadata
 */
export const ChatMessageSourceMetadataSchema = z.object({
  sourceChunkIds: z.array(z.number()).optional().nullable(),
  relevantOriginalQueries: z.array(z.string()).optional().nullable(),
  confidenceScore: z.number().min(0).max(1).optional().nullable(),
  sourceObjectIds: z.array(z.string()).optional().nullable(),
  retrievalMethod: z.string().optional().nullable()
}).passthrough(); // Allow additional fields for extensibility

export type ChatMessageSourceMetadata = z.infer<typeof ChatMessageSourceMetadataSchema>;

/**
 * Safely parse and validate chat metadata from JSON string
 */
export function parseChatMetadata(metadataJson: string): ChatMessageSourceMetadata | null {
  try {
    const parsed = JSON.parse(metadataJson);
    const result = ChatMessageSourceMetadataSchema.safeParse(parsed);
    
    if (result.success) {
      // Additional validation: ensure sourceChunkIds contains valid numbers
      if (result.data.sourceChunkIds && !Array.isArray(result.data.sourceChunkIds)) {
        return null;
      }
      
      if (result.data.sourceChunkIds?.some(id => typeof id !== 'number' || !Number.isInteger(id))) {
        // Filter out invalid IDs
        result.data.sourceChunkIds = result.data.sourceChunkIds.filter(
          id => typeof id === 'number' && Number.isInteger(id)
        );
      }
      
      return result.data;
    }
    
    return null;
  } catch {
    return null;
  }
}