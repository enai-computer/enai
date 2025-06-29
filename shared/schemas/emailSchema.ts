import { z } from 'zod';

export const emailSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  from: z.object({ name: z.string().optional(), email: z.string().email() }),
  to: z.array(z.object({ name: z.string().optional(), email: z.string().email() })),
  cc: z.array(z.object({ name: z.string().optional(), email: z.string().email() })).optional(),
  bcc: z.array(z.object({ name: z.string().optional(), email: z.string().email() })).optional(),
  subject: z.string(),
  snippet: z.string(),
  body: z.string(),
  receivedAt: z.coerce.date(),
  labels: z.array(z.string()).optional(),
  attachments: z.array(z.object({
    filename: z.string(),
    mimeType: z.string(),
    size: z.number()
  })).optional(),
  headers: z.record(z.string())
});

export type Email = z.infer<typeof emailSchema>;
