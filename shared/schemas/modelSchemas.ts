import { z } from 'zod';

export const UserGoalItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.number(),
  status: z.enum(['active', 'completed', 'archived']),
  priority: z.number().optional(),
});

export const ChunkTagsSchema = z.array(z.string());
export const ChunkPropositionsSchema = z.array(z.string());
export const UserProfileGoalsSchema = z.array(UserGoalItemSchema);
