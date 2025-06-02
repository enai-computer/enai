import { describe, it, expect, vi } from 'vitest';
import { ProfileAgent } from '../ProfileAgent';
import { 
  SynthesizedProfileDataSchema, 
  ContentSynthesisDataSchema,
  parseLLMResponse
} from '../../../shared/schemas/profileSchemas';

describe('ProfileAgent - Zod Validation', () => {
  describe('Profile Synthesis Validation', () => {
    it('should validate correct profile synthesis data', () => {
      const validResponse = JSON.stringify({
        inferredUserGoals: [
          { text: 'Learn TypeScript', confidence: 0.8, evidence: ['A1', 'T3'] },
          { text: 'Build a SaaS product', confidence: 0.6 }
        ],
        synthesizedInterests: ['web development', 'AI', 'productivity'],
        synthesizedRecentIntents: ['refactoring codebase', 'implementing tests']
      });

      const result = parseLLMResponse(validResponse, SynthesizedProfileDataSchema, 'test');
      expect(result).toBeDefined();
      expect(result?.inferredUserGoals).toHaveLength(2);
      expect(result?.inferredUserGoals?.[0].text).toBe('Learn TypeScript');
      expect(result?.synthesizedInterests).toHaveLength(3);
    });

    it('should handle markdown code blocks', () => {
      const markdownResponse = `Here's the analysis:
\`\`\`json
{
  "inferredUserGoals": [
    { "text": "Improve code quality", "confidence": 0.9 }
  ],
  "synthesizedInterests": ["testing", "best practices"]
}
\`\`\``;

      const result = parseLLMResponse(markdownResponse, SynthesizedProfileDataSchema, 'test');
      expect(result).toBeDefined();
      expect(result?.inferredUserGoals?.[0].text).toBe('Improve code quality');
    });

    it('should reject invalid goal data', () => {
      const invalidResponse = JSON.stringify({
        inferredUserGoals: [
          { text: '' }, // Empty text should fail validation
          { text: 'Valid goal' }
        ]
      });

      const result = parseLLMResponse(invalidResponse, SynthesizedProfileDataSchema, 'test');
      expect(result).toBeNull();
    });

    it('should reject goals exceeding max limit', () => {
      const tooManyGoals = JSON.stringify({
        inferredUserGoals: Array(6).fill({ text: 'Goal' }) // 6 goals, max is 5
      });

      const result = parseLLMResponse(tooManyGoals, SynthesizedProfileDataSchema, 'test');
      expect(result).toBeNull();
    });

    it('should reject invalid confidence values', () => {
      const invalidConfidence = JSON.stringify({
        inferredUserGoals: [
          { text: 'Goal', confidence: 1.5 } // Confidence must be 0-1
        ]
      });

      const result = parseLLMResponse(invalidConfidence, SynthesizedProfileDataSchema, 'test');
      expect(result).toBeNull();
    });
  });

  describe('Content Synthesis Validation', () => {
    it('should validate correct content synthesis data', () => {
      const validResponse = JSON.stringify({
        synthesizedInterests: ['machine learning', 'data science'],
        inferredExpertiseAreas: ['Python', 'TensorFlow', 'statistics'],
        preferredSourceTypes: ['academic papers', 'technical blogs']
      });

      const result = parseLLMResponse(validResponse, ContentSynthesisDataSchema, 'test');
      expect(result).toBeDefined();
      expect(result?.synthesizedInterests).toHaveLength(2);
      expect(result?.inferredExpertiseAreas).toHaveLength(3);
      expect(result?.preferredSourceTypes).toHaveLength(2);
    });

    it('should reject data exceeding limits', () => {
      const tooManyInterests = JSON.stringify({
        synthesizedInterests: Array(6).fill('interest'), // Max 5
        inferredExpertiseAreas: Array(6).fill('expertise'), // Max 5
        preferredSourceTypes: Array(4).fill('source') // Max 3
      });

      const result = parseLLMResponse(tooManyInterests, ContentSynthesisDataSchema, 'test');
      expect(result).toBeNull();
    });

    it('should allow optional fields', () => {
      const minimalResponse = JSON.stringify({
        synthesizedInterests: ['AI']
      });

      const result = parseLLMResponse(minimalResponse, ContentSynthesisDataSchema, 'test');
      expect(result).toBeDefined();
      expect(result?.synthesizedInterests).toHaveLength(1);
      expect(result?.inferredExpertiseAreas).toBeUndefined();
      expect(result?.preferredSourceTypes).toBeUndefined();
    });

    it('should handle empty object', () => {
      const emptyResponse = JSON.stringify({});

      const result = parseLLMResponse(emptyResponse, ContentSynthesisDataSchema, 'test');
      expect(result).toBeDefined();
      expect(result).toEqual({});
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON', () => {
      const malformed = 'This is not JSON at all';
      
      const result = parseLLMResponse(malformed, SynthesizedProfileDataSchema, 'test');
      expect(result).toBeNull();
    });

    it('should handle partially valid JSON', () => {
      const partial = '{ "inferredUserGoals": [ { "text": "Goal" ';
      
      const result = parseLLMResponse(partial, SynthesizedProfileDataSchema, 'test');
      expect(result).toBeNull();
    });
  });
});