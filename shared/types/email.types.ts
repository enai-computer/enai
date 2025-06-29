export interface Email {
  id: string;
  threadId: string;
  from: { name?: string; email: string };
  to: Array<{ name?: string; email: string }>;
  cc?: Array<{ name?: string; email: string }>;
  bcc?: Array<{ name?: string; email: string }>;
  subject: string;
  snippet: string;
  body: string;
  receivedAt: Date;
  labels?: string[];
  attachments?: Array<{ filename: string; mimeType: string; size: number }>;
  headers: Record<string, string>;
}
