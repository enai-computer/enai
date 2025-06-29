export interface Email {
  id: string; // Gmail's unique message ID
  threadId: string;
  from: { name?: string; email: string };
  to: Array<{ name?: string; email: string }>;
  cc?: Array<{ name?: string; email: string }>;
  bcc?: Array<{ name?: string; email: string }>;
  subject: string;
  snippet: string;
  body: string; // Main content for embedding
  receivedAt: Date;
  labels?: string[];
  attachments?: Array<{ filename: string; mimeType: string; size: number }>;
  headers: Record<string, string>;
}
