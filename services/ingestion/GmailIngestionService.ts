import { google, gmail_v1 } from 'googleapis';
import { BaseService } from '../base/BaseService';
import { GmailAuthService } from '../GmailAuthService';
import { Email } from '../../shared/types';
import { ObjectModel } from '../../models/ObjectModel';

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
      const ids = res.data.messages?.map(m => m.id!) || [];
      const emails: Email[] = [];
      for (const id of ids) {
        const msg = await gmail.users.messages.get({ userId: 'me', id });
        const email = this.transformMessage(msg.data);
        if (email) emails.push(email);
      }
      return emails;
    });
  }

  async fetchEmailsSince(userId: string, since: Date): Promise<Email[]> {
    return this.execute('fetchEmailsSince', async () => {
      const client = await this.deps.gmailAuthService.getAuthenticatedClient(userId);
      const gmail = google.gmail({ version: 'v1', auth: client });
      const query = `after:${Math.floor(since.getTime() / 1000)}`;
      const res = await gmail.users.messages.list({ userId: 'me', q: query });
      const ids = res.data.messages?.map(m => m.id!) || [];
      const emails: Email[] = [];
      for (const id of ids) {
        const msg = await gmail.users.messages.get({ userId: 'me', id });
        const email = this.transformMessage(msg.data);
        if (email) emails.push(email);
      }
      return emails;
    });
  }

  private transformMessage(msg: gmail_v1.Schema$Message): Email | null {
    if (!msg.payload) return null;
    const headers = (msg.payload.headers || []).reduce<Record<string, string>>((acc, h) => {
      if (h.name && h.value) acc[h.name] = h.value;
      return acc;
    }, {});

    const parseAddresses = (value: string | undefined) => {
      if (!value) return [] as Array<{ name?: string; email: string }>;
      return value.split(',').map(addr => {
        const [name, email] = addr.split('<');
        if (email) {
          return { name: name?.trim().replace(/"/g, ''), email: email.replace('>', '').trim() };
        }
        return { email: name.trim() };
      });
    };

    const body = this.parseEmailBody(msg.payload);

    return {
      id: msg.id!,
      threadId: msg.threadId!,
      from: parseAddresses(headers['From'])[0],
      to: parseAddresses(headers['To']),
      cc: parseAddresses(headers['Cc']),
      bcc: parseAddresses(headers['Bcc']),
      subject: headers['Subject'] || '',
      snippet: msg.snippet || '',
      body,
      receivedAt: msg.internalDate ? new Date(parseInt(msg.internalDate)) : new Date(),
      labels: msg.labelIds || [],
      attachments: [],
      headers
    };
  }

  private parseEmailBody(payload: gmail_v1.Schema$MessagePart): string {
    const getPart = (part: gmail_v1.Schema$MessagePart): string => {
      if (part.parts) {
        for (const p of part.parts) {
          const res = getPart(p);
          if (res) return res;
        }
      }
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf8');
      }
      return '';
    };
    return getPart(payload);
  }
}
