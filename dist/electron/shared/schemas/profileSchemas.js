"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentSynthesisDataSchema = exports.SynthesizedProfileDataSchema = exports.InferredUserGoalSchema = exports.PreferenceExtractionSchema = exports.ProfileAnalysisSchema = void 0;
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
 * Schema for inferred user goals from ProfileAgent
 */
exports.InferredUserGoalSchema = zod_1.z.object({
    text: zod_1.z.string().min(1, "Goal text cannot be empty"),
    confidence: zod_1.z.number().min(0).max(1).optional(),
    evidence: zod_1.z.array(zod_1.z.string()).optional()
});
/**
 * Schema for synthesized profile data from activities
 */
exports.SynthesizedProfileDataSchema = zod_1.z.object({
    inferredUserGoals: zod_1.z.array(exports.InferredUserGoalSchema).max(5).optional(),
    synthesizedInterests: zod_1.z.array(zod_1.z.string()).max(5).optional(),
    synthesizedRecentIntents: zod_1.z.array(zod_1.z.string()).max(5).optional()
});
/**
 * Schema for content synthesis data
 */
exports.ContentSynthesisDataSchema = zod_1.z.object({
    synthesizedInterests: zod_1.z.array(zod_1.z.string()).max(5).optional(),
    inferredExpertiseAreas: zod_1.z.array(zod_1.z.string()).max(5).optional(),
    preferredSourceTypes: zod_1.z.array(zod_1.z.string()).max(3).optional()
});
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