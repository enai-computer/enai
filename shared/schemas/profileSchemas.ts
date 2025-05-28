import { z } from 'zod';

/**
 * Schema for profile analysis from AI
 */
export const ProfileAnalysisSchema = z.object({
  interests: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  expertiseAreas: z.array(z.string()).default([]),
  summary: z.string().optional(),
  insights: z.array(z.string()).optional()
}).passthrough(); // Allow additional fields for extensibility

/**
 * Schema for preference extraction
 */
export const PreferenceExtractionSchema = z.object({
  preferences: z.record(z.string(), z.any()).optional(),
  themes: z.array(z.string()).optional(),
  patterns: z.array(z.string()).optional()
}).passthrough();

/**
 * Schema for inferred user goals from ProfileAgent
 */
export const InferredUserGoalSchema = z.object({
  text: z.string().min(1, "Goal text cannot be empty"),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.array(z.string()).optional()
});

/**
 * Schema for synthesized profile data from activities
 */
export const SynthesizedProfileDataSchema = z.object({
  inferredUserGoals: z.array(InferredUserGoalSchema).max(5).optional(),
  synthesizedInterests: z.array(z.string()).max(5).optional(),
  synthesizedRecentIntents: z.array(z.string()).max(5).optional()
});

/**
 * Schema for content synthesis data
 */
export const ContentSynthesisDataSchema = z.object({
  synthesizedInterests: z.array(z.string()).max(5).optional(),
  inferredExpertiseAreas: z.array(z.string()).max(5).optional(),
  preferredSourceTypes: z.array(z.string()).max(3).optional()
});

export type ProfileAnalysis = z.infer<typeof ProfileAnalysisSchema>;
export type PreferenceExtraction = z.infer<typeof PreferenceExtractionSchema>;
export type SynthesizedProfileData = z.infer<typeof SynthesizedProfileDataSchema>;
export type ContentSynthesisData = z.infer<typeof ContentSynthesisDataSchema>;

/**
 * Parse JSON response from LLM with markdown code block support
 */
export function parseLLMResponse<T>(
  response: string, 
  schema: z.ZodSchema<T>,
  context: string
): T | null {
  // First try direct parsing
  try {
    const parsed = JSON.parse(response.trim());
    const result = schema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
  } catch {
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
    } catch {
      // Code block didn't contain valid JSON
    }
  }

  return null;
}