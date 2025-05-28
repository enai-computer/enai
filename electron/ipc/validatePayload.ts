import { z } from 'zod';

export function validateIpcPayload<T>(schema: z.ZodSchema<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new Error(`Invalid payload: ${result.error.message}`);
  }
  return result.data;
}
