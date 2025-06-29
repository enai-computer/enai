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
    await super.initialize();
    const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI } = process.env;
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REDIRECT_URI) {
      this.logError('Missing Gmail OAuth environment variables');
      throw new GmailAuthError('Missing env vars');
    }
    this.oauth2Client = new OAuth2Client(
      GMAIL_CLIENT_ID,
      GMAIL_CLIENT_SECRET,
      GMAIL_REDIRECT_URI
    );
  }

  getAuthUrl(): string {
    const scopes = ['https://www.googleapis.com/auth/gmail.readonly'];
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes
    });
  }

  async handleAuthCallback(code: string, userId: string): Promise<void> {
    return this.execute('handleAuthCallback', async () => {
      const { tokens } = await this.oauth2Client.getToken(code);
      if (!tokens.refresh_token) {
        throw new GmailAuthError('No refresh token received');
      }
      // TODO: secure storage - placeholder using profileService for now
      await this.deps.profileService.updateProfile(userId, {
        gmailTokens: tokens
      } as any);
    });
  }

  async getAuthenticatedClient(userId: string): Promise<OAuth2Client> {
    const profile = await this.deps.profileService.getProfile(userId);
    const tokens = (profile as any).gmailTokens;
    if (!tokens) {
      throw new GmailAuthError('No stored tokens');
    }
    this.oauth2Client.setCredentials(tokens);
    return this.oauth2Client;
  }
}
