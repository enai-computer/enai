import { OAuth2Client } from 'google-auth-library';
import type Database from 'better-sqlite3';
import { BaseService } from './base/BaseService';
import { GmailAuthError } from './base/ServiceError';
import { ProfileService } from './ProfileService';

interface GmailAuthServiceDeps {
  db: Database.Database;
  profileService: ProfileService;
}

export class GmailAuthService extends BaseService<GmailAuthServiceDeps> {
  private oauth2Client!: OAuth2Client;

  async initialize(): Promise<void> {
    const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI } = process.env;
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REDIRECT_URI) {
      throw new GmailAuthError('Missing Gmail OAuth environment variables');
    }
    this.oauth2Client = new OAuth2Client({
      clientId: GMAIL_CLIENT_ID,
      clientSecret: GMAIL_CLIENT_SECRET,
      redirectUri: GMAIL_REDIRECT_URI
    });
  }

  getAuthUrl(): string {
    const scopes = ['https://www.googleapis.com/auth/gmail.readonly'];
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  async handleAuthCallback(code: string, userId: string): Promise<void> {
    return this.execute('handleAuthCallback', async () => {
      try {
        const { tokens } = await this.oauth2Client.getToken(code);
        // TODO: store tokens securely per userId
        await this.saveTokens(userId, tokens);
      } catch (error) {
        this.logError('OAuth callback failed', error);
        throw new GmailAuthError('Failed to exchange auth code');
      }
    });
  }

  private async saveTokens(userId: string, tokens: any): Promise<void> {
    // Placeholder: use secure storage solution
    const key = `gmail_tokens_${userId}`;
    const stmt = this.deps.db.prepare(
      `INSERT OR REPLACE INTO key_value_store (key, value) VALUES (?, ?)`
    );
    stmt.run(key, JSON.stringify(tokens));
  }

  private getTokens(userId: string): any | null {
    const key = `gmail_tokens_${userId}`;
    const stmt = this.deps.db.prepare(
      `SELECT value FROM key_value_store WHERE key = ?`
    );
    const row = stmt.get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }

  async getAuthenticatedClient(userId: string): Promise<OAuth2Client> {
    const tokens = this.getTokens(userId);
    if (!tokens) {
      throw new GmailAuthError('No stored tokens for user');
    }
    this.oauth2Client.setCredentials(tokens);
    return this.oauth2Client;
  }
}
