import { z } from 'zod';

export const EmailAddressSchema = z.object({
  name: z.string().optional(),
  email: z.string().email()
});

export const AttachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number()
});

export const EmailSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  from: EmailAddressSchema,
  to: z.array(EmailAddressSchema),
  cc: z.array(EmailAddressSchema).optional(),
  bcc: z.array(EmailAddressSchema).optional(),
  subject: z.string(),
  snippet: z.string(),
  body: z.string(),
  receivedAt: z.coerce.date(),
  labels: z.array(z.string()).optional(),
  attachments: z.array(AttachmentSchema).optional(),
  headers: z.record(z.string())
});

export type Email = z.infer<typeof EmailSchema>;
