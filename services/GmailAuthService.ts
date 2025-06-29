import { OAuth2Client } from 'google-auth-library';
import Database from 'better-sqlite3';
import { BaseService } from './base/BaseService';
import { GmailAuthError } from './base/ServiceError';
import { ProfileService } from './ProfileService';

interface GmailAuthServiceDeps {
  db: Database.Database;
  profileService: ProfileService;
}

export class GmailAuthService extends BaseService<GmailAuthServiceDeps> {
  private oauth2Client!: OAuth2Client;
  private tokenStore = new Map<string, any>();

  constructor(deps: GmailAuthServiceDeps) {
    super('GmailAuthService', deps);
  }

  async initialize(): Promise<void> {
    return this.execute('initialize', async () => {
      const clientId = process.env.GMAIL_CLIENT_ID;
      const clientSecret = process.env.GMAIL_CLIENT_SECRET;
      const redirectUri = process.env.GMAIL_REDIRECT_URI;

      if (!clientId || !clientSecret || !redirectUri) {
        throw new GmailAuthError('Missing Gmail OAuth environment variables');
      }

      this.oauth2Client = new OAuth2Client({
        clientId,
        clientSecret,
        redirectUri
      });
    });
  }

  getAuthUrl(): string {
    const scopes = ['https://www.googleapis.com/auth/gmail.readonly'];
    return this.oauth2Client.generateAuthUrl({ scope: scopes, access_type: 'offline', prompt: 'consent' });
  }

  async handleAuthCallback(code: string, userId: string): Promise<void> {
    return this.execute('handleAuthCallback', async () => {
      const { tokens } = await this.oauth2Client.getToken(code);
      if (!tokens.refresh_token) {
        throw new GmailAuthError('No refresh token received');
      }
      // TODO: securely store tokens using keytar or similar
      this.tokenStore.set(userId, tokens);
    }, { userId });
  }

  async getAuthenticatedClient(userId: string): Promise<OAuth2Client> {
    return this.execute('getAuthenticatedClient', async () => {
      const tokens = this.tokenStore.get(userId);
      if (!tokens) {
        throw new GmailAuthError('User not authenticated');
      }
      const client = new OAuth2Client({
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        redirectUri: process.env.GMAIL_REDIRECT_URI
      });
      client.setCredentials(tokens);
      return client;
    }, { userId });
  }
}
