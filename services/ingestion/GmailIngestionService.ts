import { google } from 'googleapis';
import { BaseService } from '../base/BaseService';
import type { GmailAuthService } from '../GmailAuthService';
import { Email } from '../../shared/types/email.types';
import type { ObjectModel } from '../../models/ObjectModel';
import { GmailRateLimitError, GmailQuotaExceededError } from '../base/ServiceError';

interface GmailIngestionServiceDeps {
  gmailAuthService: GmailAuthService;
  objectModel: ObjectModel;
}

export class GmailIngestionService extends BaseService<GmailIngestionServiceDeps> {
  constructor(deps: GmailIngestionServiceDeps) {
    super('GmailIngestionService', deps);
  }

  async fetchRecentEmails(userId: string, maxResults = 50): Promise<Email[]> {
    return this.execute('fetchRecentEmails', async () => {
      const client = await this.deps.gmailAuthService.getAuthenticatedClient(userId);
      const gmail = google.gmail({ version: 'v1', auth: client });
      const res = await gmail.users.messages.list({ userId: 'me', maxResults });
      const ids = res.data.messages?.map(m => m.id) || [];
      const emails: Email[] = [];
      for (const id of ids) {
        const msg = await gmail.users.messages.get({ userId: 'me', id: id! });
        emails.push(this.transformMessage(msg.data));
      }
      return emails;
    });
  }

  async fetchEmailsSince(userId: string, since: Date): Promise<Email[]> {
    const query = `after:${Math.floor(since.getTime() / 1000)}`;
    const client = await this.deps.gmailAuthService.getAuthenticatedClient(userId);
    const gmail = google.gmail({ version: 'v1', auth: client });
    const res = await gmail.users.messages.list({ userId: 'me', q: query });
    const ids = res.data.messages?.map(m => m.id) || [];
    const emails: Email[] = [];
    for (const id of ids) {
      const msg = await gmail.users.messages.get({ userId: 'me', id: id! });
      emails.push(this.transformMessage(msg.data));
    }
    return emails;
  }

  private transformMessage(message: any): Email {
    const headers: Record<string, string> = {};
    for (const h of message.payload.headers || []) {
      headers[h.name.toLowerCase()] = h.value;
    }
    const getAddress = (value?: string) => {
      if (!value) return [] as Array<{ name?: string; email: string }>;
      return value.split(',').map(part => {
        const match = part.match(/(?:(.*) <)?([^>]+)>?/);
        return { name: match?.[1]?.trim(), email: match?.[2].trim() };
      });
    };
    const body = this.parseEmailBody(message.payload);
    return {
      id: message.id,
      threadId: message.threadId,
      from: getAddress(headers['from'])[0],
      to: getAddress(headers['to']),
      cc: getAddress(headers['cc']),
      bcc: getAddress(headers['bcc']),
      subject: headers['subject'] || '',
      snippet: message.snippet || '',
      body,
      receivedAt: new Date(parseInt(message.internalDate, 10)),
      labels: message.labelIds || [],
      attachments: message.payload.parts?.filter((p: any) => p.filename).map((p: any) => ({
        filename: p.filename,
        mimeType: p.mimeType,
        size: Number(p.body.size) || 0
      })),
      headers
    };
  }

  private parseEmailBody(payload: any): string {
    if (!payload) return '';
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    if (payload.parts && Array.isArray(payload.parts)) {
      for (const part of payload.parts) {
        const text = this.parseEmailBody(part);
        if (text) return text;
      }
    }
    return '';
  }
}
