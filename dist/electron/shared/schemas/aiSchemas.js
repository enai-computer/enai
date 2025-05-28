"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiResponseSchema = exports.AiGeneratedContentSchema = void 0;
exports.parseAiResponse = parseAiResponse;
const zod_1 = require("zod");
/**
 * Schema for AI-generated content from PDF processing
 */
exports.AiGeneratedContentSchema = zod_1.z.object({
    title: zod_1.z.string().min(1, "Title cannot be empty"),
    summary: zod_1.z.string().min(1, "Summary cannot be empty"),
    tags: zod_1.z.array(zod_1.z.string()).min(1, "At least one tag is required")
});
/**
 * Schema for parsed AI responses that might be wrapped in markdown code blocks
 */
exports.AiResponseSchema = zod_1.z.union([
    exports.AiGeneratedContentSchema,
    zod_1.z.string() // For cases where we need to extract from markdown
]);
/**
 * Parse and validate AI response, handling markdown code blocks
 */
function parseAiResponse(response) {
    // If it's already an object, try to validate directly
    if (typeof response === 'object' && response !== null) {
        const result = exports.AiGeneratedContentSchema.safeParse(response);
        if (result.success) {
            return result.data;
        }
    }
    // If it's a string, try to extract JSON from markdown
    if (typeof response === 'string') {
        // Try to extract JSON from markdown code blocks
        const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (codeBlockMatch) {
            try {
                const parsed = JSON.parse(codeBlockMatch[1].trim());
                const result = exports.AiGeneratedContentSchema.safeParse(parsed);
                if (result.success) {
                    return result.data;
                }
            }
            catch {
                // JSON parse failed
            }
        }
        // Try direct JSON parse
        try {
            const parsed = JSON.parse(response);
            const result = exports.AiGeneratedContentSchema.safeParse(parsed);
            if (result.success) {
                return result.data;
            }
        }
        catch {
            // Not valid JSON
        }
    }
    return null;
}
//# sourceMappingURL=aiSchemas.js.map