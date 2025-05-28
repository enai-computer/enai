import { z } from 'zod';

export const SetIntentPayloadSchema = z.object({
  intentText: z.string(),
  context: z.object({
    sessionId: z.string(),
    notebookId: z.string()
  })
});

export const StartStreamPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  question: z.string().min(1),
  notebookId: z.string().uuid()
});

