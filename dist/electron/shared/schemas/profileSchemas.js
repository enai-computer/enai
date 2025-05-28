"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreferenceExtractionSchema = exports.ProfileAnalysisSchema = void 0;
exports.parseLLMResponse = parseLLMResponse;
const zod_1 = require("zod");
/**
 * Schema for profile analysis from AI
 */
exports.ProfileAnalysisSchema = zod_1.z.object({
    interests: zod_1.z.array(zod_1.z.string()).default([]),
    goals: zod_1.z.array(zod_1.z.string()).default([]),
    expertiseAreas: zod_1.z.array(zod_1.z.string()).default([]),
    summary: zod_1.z.string().optional(),
    insights: zod_1.z.array(zod_1.z.string()).optional()
}).passthrough(); // Allow additional fields for extensibility
/**
 * Schema for preference extraction
 */
exports.PreferenceExtractionSchema = zod_1.z.object({
    preferences: zod_1.z.record(zod_1.z.string(), zod_1.z.any()).optional(),
    themes: zod_1.z.array(zod_1.z.string()).optional(),
    patterns: zod_1.z.array(zod_1.z.string()).optional()
}).passthrough();
/**
 * Parse JSON response from LLM with markdown code block support
 */
function parseLLMResponse(response, schema, context) {
    // First try direct parsing
    try {
        const parsed = JSON.parse(response.trim());
        const result = schema.safeParse(parsed);
        if (result.success) {
            return result.data;
        }
    }
    catch {
        // Not valid JSON, continue
    }
    // Try to extract from markdown code blocks
    const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
        try {
            const parsed = JSON.parse(codeBlockMatch[1].trim());
            const result = schema.safeParse(parsed);
            if (result.success) {
                return result.data;
            }
        }
        catch {
            // Code block didn't contain valid JSON
        }
    }
    return null;
}
//# sourceMappingURL=profileSchemas.js.map