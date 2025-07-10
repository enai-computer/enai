import { z } from 'zod';

/**
 * Schema for individual biography events
 */
export const BiographyEventSchema = z.object({
  when: z.string().describe('ISO timestamp of the event'),
  why: z.string().optional().describe('Intent/reason (e.g., "researching fitness")'),
  withWhom: z.array(z.string()).optional().describe('Related object IDs'),
  what: z.string().optional().describe('Event type (e.g., "viewed", "annotated")'),
  resulted: z.string().optional().describe('Outcome (e.g., "added to notebook")')
}).passthrough();

export type BiographyEvent = z.infer<typeof BiographyEventSchema>;

/**
 * Schema for object biography
 */
export const ObjectBioSchema = z.object({
  createdAt: z.string().describe('ISO timestamp of creation'),
  events: z.array(BiographyEventSchema).describe('Chronological events')
}).passthrough();

export type ObjectBio = z.infer<typeof ObjectBioSchema>;

/**
 * Schema for individual relationships
 */
export const RelationshipSchema = z.object({
  to: z.string().describe('Target object/notebook ID'),
  strength: z.number().min(0).max(1).describe('Connection strength (0-1)'),
  nature: z.string().describe('Relationship type (e.g., "child", "similar", "topic-related")'),
  formed: z.string().describe('ISO timestamp when formed'),
  reinforcedBy: z.array(z.string()).optional().describe('Event IDs that strengthened it'),
  topicAffinity: z.number().min(0).max(1).optional().describe('Relevance to notebook topic (0-1)')
}).passthrough();

export type Relationship = z.infer<typeof RelationshipSchema>;

/**
 * Schema for object relationships
 */
export const ObjectRelationshipsSchema = z.object({
  related: z.array(RelationshipSchema).describe('Array of relationships')
}).passthrough();

export type ObjectRelationships = z.infer<typeof ObjectRelationshipsSchema>;

/**
 * Parse and validate object biography JSON string
 */
export function parseObjectBio(jsonString: string): ObjectBio {
  return ObjectBioSchema.parse(JSON.parse(jsonString));
}

/**
 * Safe parse that returns null on invalid input
 */
export function safeParseObjectBio(jsonString: string): ObjectBio | null {
  try {
    return parseObjectBio(jsonString);
  } catch {
    return null;
  }
}

/**
 * Parse and validate object relationships JSON string
 */
export function parseObjectRelationships(jsonString: string): ObjectRelationships {
  return ObjectRelationshipsSchema.parse(JSON.parse(jsonString));
}

/**
 * Safe parse that returns null on invalid input
 */
export function safeParseObjectRelationships(jsonString: string): ObjectRelationships | null {
  try {
    return parseObjectRelationships(jsonString);
  } catch {
    return null;
  }
}

/**
 * Create default object biography
 */
export function createDefaultObjectBio(createdAt: Date = new Date()): ObjectBio {
  return {
    createdAt: createdAt.toISOString(),
    events: []
  };
}

/**
 * Create default object relationships
 */
export function createDefaultObjectRelationships(): ObjectRelationships {
  return {
    related: []
  };
}