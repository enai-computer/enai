import { google, gmail_v1 } from 'googleapis';
import { BaseService } from '../base/BaseService';
import { GmailAuthService } from '../GmailAuthService';
import { Email } from '../../shared/types';

interface GmailIngestionServiceDeps {
  gmailAuthService: GmailAuthService;
}

export class GmailIngestionService extends BaseService<GmailIngestionServiceDeps> {
  async fetchRecentEmails(userId: string, maxResults = 50): Promise<Email[]> {
    return this.execute('fetchRecentEmails', async () => {
      const auth = await this.deps.gmailAuthService.getAuthenticatedClient(userId);
      const gmail = google.gmail({ version: 'v1', auth });

      const res = await gmail.users.messages.list({ userId: 'me', maxResults });
      const messages = res.data.messages || [];

      const emails: Email[] = [];
      for (const msg of messages) {
        if (!msg.id) continue;
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id });
        const email = this.transformMessage(detail.data);
        emails.push(email);
      }
      return emails;
    });
  }

  async fetchEmailsSince(userId: string, since: Date): Promise<Email[]> {
    const q = `after:${Math.floor(since.getTime() / 1000)}`;
    return this.execute('fetchEmailsSince', async () => {
      const auth = await this.deps.gmailAuthService.getAuthenticatedClient(userId);
      const gmail = google.gmail({ version: 'v1', auth });
      const res = await gmail.users.messages.list({ userId: 'me', q });
      const msgs = res.data.messages || [];
      const emails: Email[] = [];
      for (const msg of msgs) {
        if (!msg.id) continue;
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id });
        emails.push(this.transformMessage(detail.data));
      }
      return emails;
    });
  }

  private transformMessage(msg: gmail_v1.Schema$Message): Email {
    const payload = msg.payload;
    const headers: Record<string, string> = {};
    payload?.headers?.forEach(h => {
      if (h.name && h.value) headers[h.name] = h.value;
    });

    const body = this.parseEmailBody(payload);
    const getAddress = (raw?: string): { name?: string; email: string } | null => {
      if (!raw) return null;
      const [namePart, emailPart] = raw.split('<');
      const email = emailPart ? emailPart.replace('>', '').trim() : namePart.trim();
      const name = emailPart ? namePart.trim().replace(/"/g, '') : undefined;
      return { name, email };
    };

    const parseList = (raw?: string) =>
      raw ? raw.split(',').map(a => getAddress(a.trim())).filter(Boolean) as Array<{name?:string;email:string}> : [];

    return {
      id: msg.id!,
      threadId: msg.threadId || '',
      from: getAddress(headers['From'] || '')!,
      to: parseList(headers['To'])[0] ? parseList(headers['To']) : [],
      cc: parseList(headers['Cc']),
      bcc: parseList(headers['Bcc']),
      subject: headers['Subject'] || '',
      snippet: msg.snippet || '',
      body,
      receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
      labels: msg.labelIds || [],
      attachments: payload?.parts?.filter(p => p.filename).map(p => ({ filename: p.filename!, mimeType: p.mimeType || '', size: Number(p.body?.size) || 0 })) || [],
      headers
    };
  }

  private parseEmailBody(payload?: gmail_v1.Schema$MessagePart): string {
    if (!payload) return '';
    if (payload.body && payload.body.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        const result = this.parseEmailBody(part);
        if (result) return result;
      }
    }
    return '';
  }
}
