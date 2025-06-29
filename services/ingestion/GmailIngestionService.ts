import { google } from 'googleapis';
import { BaseService } from '../base/BaseService';
import { GmailAuthService } from '../GmailAuthService';
import { Email } from '../../shared/types';
import { ObjectModel } from '../../models/ObjectModel';

interface GmailIngestionServiceDeps {
  gmailAuthService: GmailAuthService;
  objectModel: ObjectModel;
}

export class GmailIngestionService extends BaseService<GmailIngestionServiceDeps> {
  async fetchRecentEmails(userId: string, maxResults = 50): Promise<Email[]> {
    return this.execute('fetchRecentEmails', async () => {
      const client = await this.deps.gmailAuthService.getAuthenticatedClient(userId);
      const gmail = google.gmail({ version: 'v1', auth: client });
      const res = await gmail.users.messages.list({ userId: 'me', maxResults });
      const emails: Email[] = [];
      if (res.data.messages) {
        for (const msg of res.data.messages) {
          const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id! });
          emails.push(this.transformMessage(detail.data));
        }
      }
      return emails;
    });
  }

  async fetchEmailsSince(userId: string, since: Date): Promise<Email[]> {
    return this.execute('fetchEmailsSince', async () => {
      const client = await this.deps.gmailAuthService.getAuthenticatedClient(userId);
      const gmail = google.gmail({ version: 'v1', auth: client });
      const q = `after:${Math.floor(since.getTime() / 1000)}`;
      const res = await gmail.users.messages.list({ userId: 'me', q });
      const emails: Email[] = [];
      if (res.data.messages) {
        for (const msg of res.data.messages) {
          const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id! });
          emails.push(this.transformMessage(detail.data));
        }
      }
      return emails;
    });
  }

  private transformMessage(data: any): Email {
    const headers: Record<string, string> = {};
    data.payload?.headers?.forEach((h: any) => {
      headers[h.name] = h.value;
    });
    const body = this.parseEmailBody(data.payload);
    return {
      id: data.id!,
      threadId: data.threadId!,
      from: this.parseAddress(headers['From'] || ''),
      to: this.parseAddressList(headers['To']),
      cc: this.parseAddressList(headers['Cc']),
      bcc: this.parseAddressList(headers['Bcc']),
      subject: headers['Subject'] || '',
      snippet: data.snippet || '',
      body,
      receivedAt: new Date(Number(data.internalDate)),
      labels: data.labelIds,
      attachments: [],
      headers
    };
  }

  private parseAddressList(value?: string): Array<{ name?: string; email: string }> {
    if (!value) return [];
    return value.split(',').map(v => this.parseAddress(v.trim()));
  }

  private parseAddress(value: string): { name?: string; email: string } {
    const match = /^(?:"?([^"<]*)"?\s*)?<(.+)>$/.exec(value);
    if (match) {
      const name = match[1]?.trim();
      return { name: name || undefined, email: match[2] };
    }
    return { email: value };
  }

  private parseEmailBody(payload: any): string {
    if (!payload) return '';
    if (payload.parts) {
      for (const part of payload.parts) {
        const result = this.parseEmailBody(part);
        if (result) return result;
      }
    }
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    if (payload.mimeType === 'text/html' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    return '';
  }
}
